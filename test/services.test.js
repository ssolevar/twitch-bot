import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeather } from '../src/services/weather.js';
import { createTwitchApi, validateAccessToken } from '../src/services/twitch-api.js';

const chatScopes = ['chat:read', 'chat:edit', 'user:write:chat', 'moderator:manage:chat_messages', 'moderator:read:chat_messages', 'channel:manage:polls'];

test('weather lookup requests coordinates then returns current conditions', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    if (urls.length === 1) return Response.json({ results: [{ name: 'Test City', admin1: 'Region', country: 'Country', latitude: 1, longitude: 2 }] });
    return Response.json({ current: { temperature_2m: -2.4, apparent_temperature: -4, relative_humidity_2m: 75, weather_code: 3, wind_speed_10m: 2.24 } });
  };
  const result = await getWeather('Test City', { fetchImpl });
  assert.match(result, /Test City, Region, Country: пасмурно, -2°C/);
  assert.equal(urls[0].searchParams.get('name'), 'Test City');
  assert.equal(urls[1].searchParams.get('latitude'), '1');
});

test('weather service handles not found and rate limiting', async () => {
  await assert.rejects(getWeather('Nowhere', { fetchImpl: async () => Response.json({ results: [] }) }), /Город не найден/);
  await assert.rejects(getWeather('Somewhere', { fetchImpl: async () => new Response('', { status: 429 }) }), /rate limit/);
});

test('weather lookup enforces its network timeout', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  await assert.rejects(getWeather('Somewhere', { fetchImpl, timeoutMs: 5 }), /timed out/);
});

test('Twitch token validation returns bot identity and checks app ID', async () => {
  let request;
  const result = await validateAccessToken({
    accessToken: 'example-token', username: 'bot', clientId: 'app-id', automod: { enabled: false },
  }, { fetchImpl: async (_url, options) => {
      request = options;
      return Response.json({ login: 'Bot', user_id: '123', client_id: 'app-id', scopes: chatScopes });
    } });
  assert.deepEqual(result, { login: 'Bot', userId: '123', clientId: 'app-id', scopes: chatScopes });
  assert.equal(request.headers.Authorization, 'OAuth example-token');
});

test('Twitch API validation reports status and scope errors without logging credentials', async () => {
  const options = { accessToken: 'sensitive', username: 'bot', clientId: 'app-id', automod: { enabled: false } };
  await assert.rejects(validateAccessToken(options, { fetchImpl: async () => new Response('', { status: 401 }) }), /rejected authorization/);
  await assert.rejects(validateAccessToken(options, { fetchImpl: async () => new Response('', { status: 429 }) }), /rate limit/);
  await assert.rejects(validateAccessToken({
    ...options,
    automod: { enabled: true },
  }, { fetchImpl: async () => Response.json({ login: 'bot', user_id: '123', client_id: 'app-id', scopes: chatScopes }) }), /moderator:manage:banned_users/);
  await assert.rejects(validateAccessToken({
    ...options,
  }, { fetchImpl: async () => Response.json({ login: 'bot', user_id: '123', client_id: 'different', scopes: chatScopes }) }), /TWITCH_CLIENT_ID/);
});

test('Twitch API validation handles denied scopes and account mismatch', async () => {
  await assert.rejects(validateAccessToken({
    accessToken: 'test-value', username: 'bot', clientId: 'app-id', automod: { enabled: false },
  }, { fetchImpl: async () => new Response('', { status: 403 }) }), /denied permission/);
  await assert.rejects(validateAccessToken({
    accessToken: 'test-value', username: 'bot', clientId: 'app-id', automod: { enabled: false },
  }, { fetchImpl: async () => Response.json({ login: 'different', user_id: '123', client_id: 'app-id', scopes: chatScopes }) }), /does not match/);
});

test('Twitch API sends, pins, reads, and unpins a message and creates a poll', async () => {
  const requests = [];
  const api = createTwitchApi({
    clientId: 'app-id', accessToken: 'test-value', moderatorId: 'mod-id',
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (options.method === 'POST' && new URL(url).pathname.endsWith('/chat/messages')) {
        return Response.json({ data: [{ message_id: 'message-id', is_sent: true }] });
      }
      if (new URL(url).pathname.endsWith('/chat/pins') && (!options.method || options.method === 'GET')) return Response.json({ data: [{ message_id: 'message-id' }] });
      if (new URL(url).pathname.endsWith('/polls')) return Response.json({ data: [{ id: 'poll-id' }] });
      return new Response(null, { status: 204 });
    },
  });
  const messageId = await api.sendChatMessage({ broadcasterId: 'channel-id', senderId: 'bot-id', message: 'Pinned text' });
  await api.pinChatMessage({ broadcasterId: 'channel-id', messageId, durationSeconds: 300 });
  assert.equal((await api.getPinnedChatMessage({ broadcasterId: 'channel-id' })).message_id, messageId);
  await api.unpinChatMessage({ broadcasterId: 'channel-id', messageId });
  await api.createPoll({ broadcasterId: 'channel-id', title: 'Continue?', choices: ['Yes', 'No'], duration: 120 });
  assert.deepEqual(JSON.parse(requests[0].options.body), { broadcaster_id: 'channel-id', sender_id: 'bot-id', message: 'Pinned text' });
  assert.equal(requests[1].options.method, 'PUT');
  assert.equal(requests[1].url.searchParams.get('duration_seconds'), '300');
  assert.equal(requests[3].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[4].options.body), { broadcaster_id: 'channel-id', title: 'Continue?', choices: [{ title: 'Yes' }, { title: 'No' }], duration: 120 });
});

test('Twitch token validation handles network timeout', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  await assert.rejects(validateAccessToken({ accessToken: 'test-value', username: 'bot', clientId: 'app-id', automod: { enabled: false } }, { fetchImpl, timeoutMs: 5 }), /timed out/);
});

test('Twitch API resolves and caches user IDs by normalized login', async () => {
  let calls = 0;
  const api = createTwitchApi({
    clientId: 'app-id', accessToken: 'test-value', moderatorId: 'mod-id',
    fetchImpl: async () => { calls += 1; return Response.json({ data: [{ id: 'target-id' }] }); },
  });
  assert.equal(await api.getUserId('Viewer'), 'target-id');
  assert.equal(await api.getUserId('viewer'), 'target-id');
  assert.equal(calls, 1);
});

test('Twitch AutoMod timeout uses Helix with broadcaster, moderator, target, duration, and reason', async () => {
  let request;
  const api = createTwitchApi({
    clientId: 'app-id', accessToken: 'test-value', moderatorId: 'mod-id',
    fetchImpl: async (url, options) => { request = { url: new URL(url), options }; return Response.json({ data: [] }); },
  });
  await api.timeoutUser({ broadcasterId: 'channel-id', username: 'viewer', userId: 'target-id', durationSeconds: 30, reason: 'AutoMod: spam' });
  assert.equal(request.url.searchParams.get('broadcaster_id'), 'channel-id');
  assert.equal(request.url.searchParams.get('moderator_id'), 'mod-id');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { data: { user_id: 'target-id', duration: 30, reason: 'AutoMod: spam' } });
});

test('Helix moderation service reports authorization, permission, missing resource, and rate limit errors', async () => {
  for (const [status, pattern] of [
    [401, /rejected authorization/], [403, /denied permission/],
    [404, /resource was not found/], [429, /rate limit/],
  ]) {
    const api = createTwitchApi({
      clientId: 'app-id', accessToken: 'test-value', moderatorId: 'mod-id',
      fetchImpl: async () => new Response('', { status }),
    });
    await assert.rejects(api.timeoutUser({
      broadcasterId: 'channel-id', username: 'viewer', userId: 'target-id', durationSeconds: 30, reason: 'test',
    }), pattern);
  }
});
