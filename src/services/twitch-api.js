const API_ROOT = 'https://api.twitch.tv/helix';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TIMEOUT_MAX_SECONDS = 1_209_600;

function statusError(status, context) {
  let error;
  if (status === 401) error = new Error(`Twitch rejected authorization while ${context}. Check the access token and Client ID.`);
  else if (status === 403) error = new Error(`Twitch denied permission while ${context}. Check moderator status and OAuth scopes.`);
  else if (status === 404) error = new Error(`Twitch resource was not found while ${context}.`);
  else if (status === 429) error = new Error(`Twitch API rate limit reached while ${context}. Try again later.`);
  else if (status === 400) error = new Error(`Twitch rejected the request while ${context}. Check the channel, user, and timeout values.`);
  else error = new Error(`Twitch API returned HTTP ${status} while ${context}.`);
  error.status = status;
  return error;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Twitch API request timed out while ${context}.`, { cause: error });
    throw new Error(`Twitch API is unavailable while ${context}. Check the network and try again.`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function validateAccessToken({ accessToken, username, clientId, automod }, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const response = await fetchWithTimeout(fetchImpl, VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  }, timeoutMs, 'validating the access token');

  if (!response.ok) throw statusError(response.status, 'validating the access token');
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Twitch returned an invalid token validation response.');
  }
  if (!data || typeof data.login !== 'string' || data.login.toLowerCase() !== username.toLowerCase()) {
    throw new Error('TWITCH_BOT_USERNAME does not match the Twitch account that owns TWITCH_ACCESS_TOKEN.');
  }
  if (data.client_id !== clientId) throw new Error('TWITCH_CLIENT_ID does not match the application that issued TWITCH_ACCESS_TOKEN.');
  if (!data.user_id) throw new Error('Twitch token validation response did not include the bot user ID.');

  const requiredScopes = ['chat:read', 'chat:edit'];
  if (automod?.enabled) requiredScopes.push('moderator:manage:banned_users');
  requiredScopes.push('user:write:chat', 'moderator:manage:chat_messages', 'moderator:read:chat_messages');
  const scopes = new Set(data.scopes ?? []);
  const missing = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missing.length) throw new Error(`Twitch token is missing required scopes: ${missing.join(', ')}.`);
  return { login: data.login, userId: data.user_id, clientId: data.client_id, scopes: [...scopes] };
}

export function createTwitchApi({ clientId, accessToken, tokenManager, moderatorId, fetchImpl = fetch, timeoutMs = 10_000, streamInfoCacheSeconds = 30, now = Date.now }) {
  const userIds = new Map();
  let channelInfoCache = null;
  let channelInfoUntil = 0;
  let channelInfoRequest = null;
  let channelInfoGeneration = 0;

  async function request(url, { method = 'GET', body, context }, canRetry = true) {
    const usedToken = tokenManager?.getAccessToken() ?? accessToken;
    const response = await fetchWithTimeout(fetchImpl, url, {
      method,
      headers: {
        Authorization: `Bearer ${usedToken}`,
        'Client-Id': clientId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, timeoutMs, context);
    if (response.status === 401 && canRetry && tokenManager?.canRefresh) {
      await tokenManager.refreshIfCurrent(usedToken);
      return request(url, { method, body, context }, false);
    }
    if (!response.ok) throw statusError(response.status, context);
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new Error(`Twitch API returned an invalid response while ${context}.`);
    }
  }

  async function getUserId(login) {
    const normalized = login.toLowerCase();
    if (userIds.has(normalized)) return userIds.get(normalized);
    const url = new URL(`${API_ROOT}/users`);
    url.searchParams.set('login', normalized);
    const data = await request(url, { context: `looking up @${normalized}` });
    const id = data?.data?.[0]?.id;
    if (!id) throw new Error(`Twitch user @${normalized} was not found.`);
    userIds.set(normalized, id);
    return id;
  }

  async function timeoutUser({ broadcasterId, username, userId, durationSeconds, reason }) {
    const targetId = userId || await getUserId(username);
    if (userId) userIds.set(username.toLowerCase(), userId);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > TIMEOUT_MAX_SECONDS) {
      throw new Error(`Timeout duration must be between 1 and ${TIMEOUT_MAX_SECONDS} seconds.`);
    }
    const url = new URL(`${API_ROOT}/moderation/bans`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    await request(url, {
      method: 'POST',
      body: { data: { user_id: targetId, duration: durationSeconds, reason: reason.slice(0, 500) } },
      context: `putting @${username} in timeout`,
    });
    return targetId;
  }

  async function sendChatMessage({ broadcasterId, senderId = moderatorId, message }) {
    const data = await request(`${API_ROOT}/chat/messages`, {
      method: 'POST', body: { broadcaster_id: broadcasterId, sender_id: senderId, message },
      context: 'sending a chat message for the pinned message',
    });
    const result = data?.data?.[0];
    if (!result?.is_sent || !result.message_id) {
      throw new Error(`Twitch did not send the message: ${result?.drop_reason?.message ?? 'unknown reason'}.`);
    }
    return result.message_id;
  }

  async function pinChatMessage({ broadcasterId, messageId, durationSeconds }) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 1800) {
      throw new Error('Pin duration must be between 30 and 1800 seconds.');
    }
    const url = new URL(`${API_ROOT}/chat/pins`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    url.searchParams.set('message_id', messageId);
    url.searchParams.set('duration_seconds', String(durationSeconds));
    await request(url, { method: 'PUT', context: 'pinning a chat message' });
  }

  async function getPinnedChatMessage({ broadcasterId }) {
    const url = new URL(`${API_ROOT}/chat/pins`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    const data = await request(url, { context: 'checking the pinned chat message' });
    return data?.data?.[0] ?? null;
  }

  async function unpinChatMessage({ broadcasterId, messageId }) {
    const url = new URL(`${API_ROOT}/chat/pins`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    url.searchParams.set('message_id', messageId);
    await request(url, { method: 'DELETE', context: 'unpinning a chat message' });
  }

  async function createPoll({ broadcasterId, title, choices, duration }) {
    return request(`${API_ROOT}/polls`, {
      method: 'POST', body: { broadcaster_id: broadcasterId, title, choices: choices.map((choice) => ({ title: choice })), duration },
      context: 'starting a poll',
    });
  }

  async function getChannelInformation({ broadcasterId }) {
    if (channelInfoCache && now() < channelInfoUntil) return channelInfoCache;
    if (channelInfoRequest) return channelInfoRequest;
    const url = new URL(`${API_ROOT}/channels`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    const generation = channelInfoGeneration;
    const pending = request(url, { context: 'reading channel information' }).then((data) => {
      const info = data?.data?.[0] ?? null;
      if (generation === channelInfoGeneration) {
        channelInfoCache = info;
        channelInfoUntil = now() + streamInfoCacheSeconds * 1000;
      }
      return info;
    }).finally(() => { if (channelInfoRequest === pending) channelInfoRequest = null; });
    channelInfoRequest = pending;
    return pending;
  }

  async function updateChannelInformation({ broadcasterId, title, gameId }) {
    const url = new URL(`${API_ROOT}/channels`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    const body = { ...(title !== undefined ? { title } : {}), ...(gameId !== undefined ? { game_id: gameId } : {}) };
    await request(url, { method: 'PATCH', body, context: 'updating channel information' });
    channelInfoGeneration += 1;
    channelInfoCache = null;
    channelInfoUntil = 0;
    channelInfoRequest = null;
  }

  async function getGameByName(name) {
    const url = new URL(`${API_ROOT}/games`);
    url.searchParams.set('name', name);
    const data = await request(url, { context: 'looking up a Twitch category' });
    return data?.data?.[0] ?? null;
  }

  async function updateChatSettings({ broadcasterId, settings }) {
    const url = new URL(`${API_ROOT}/chat/settings`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    return request(url, { method: 'PATCH', body: settings, context: 'updating chat settings' });
  }

  async function clearChat({ broadcasterId }) {
    const url = new URL(`${API_ROOT}/moderation/chat`);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('moderator_id', moderatorId);
    await request(url, { method: 'DELETE', context: 'clearing chat' });
  }

  async function createEventSubSubscription({ type, version, condition, sessionId }) {
    return request(`${API_ROOT}/eventsub/subscriptions`, {
      method: 'POST', body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } },
      context: `subscribing to ${type}`,
    });
  }

  return { getUserId, timeoutUser, sendChatMessage, pinChatMessage, getPinnedChatMessage, unpinChatMessage, createPoll, getChannelInformation, updateChannelInformation, getGameByName, updateChatSettings, clearChat, createEventSubSubscription };
}
