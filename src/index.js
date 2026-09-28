import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createTwitchApi, validateAccessToken } from './services/twitch-api.js';
import { createAutoMod } from './automod/index.js';
import { createCommandHandler } from './commands/handler.js';
import { loadCommands } from './commands/loader.js';
import { parseChatMessage } from './bot/parse-message.js';
import { TwitchClient } from './bot/twitch-client.js';
import { configureLogger, logger } from './utils/logger.js';
import { createCustomCommandStore } from './services/custom-commands.js';
import { createMessageQueue } from './utils/message-queue.js';
import { canModerate } from './utils/permissions.js';
import path from 'node:path';
import { loadPollPresets } from './services/poll-presets.js';
import { createPinQueue, startPinRotation } from './services/pin-queue.js';
import { pinText } from './commands/pin.js';
import { createChatTimers } from './services/timers.js';
import { createAutoReplies } from './services/auto-replies.js';
import { createReminders } from './services/reminders.js';
import { createActiveChatters } from './services/active-chatters.js';
import { EventSubClient, eventSubDefinitions } from './services/eventsub.js';
import { createOAuthTokens } from './services/oauth-tokens.js';
import { createFaceitApi } from './services/faceit-api.js';
import { createFaceitUserStore } from './services/faceit-user.js';
import { createPredictionPresetStore } from './services/prediction-presets.js';
import { createPredictionSession } from './services/prediction-session.js';
import { t } from './utils/messages.js';

export async function start() {
  const config = loadConfig();
  configureLogger(config.logging);
  const tokenManager = await createOAuthTokens({
    clientId: config.clientId, clientSecret: config.clientSecret, username: config.username, accessToken: config.accessToken,
    refreshToken: config.refreshToken, filePath: path.join(config.dataDirectory, 'oauth-tokens.json'),
  });
  async function validateCurrentToken() {
    const usedToken = tokenManager.getAccessToken();
    try { return await validateAccessToken({ ...config, accessToken: usedToken }); }
    catch (error) {
      if (error.status !== 401 || !tokenManager.canRefresh) throw error;
      await tokenManager.refreshIfCurrent(usedToken);
      return validateAccessToken({ ...config, accessToken: tokenManager.getAccessToken() });
    }
  }
  const account = await validateCurrentToken();
  logger.info(`Twitch access token validated for @${account.login}.`);
  const tokenCheckTimer = setInterval(() => {
    validateCurrentToken().catch((error) => logger.error(error.message));
  }, 60 * 60 * 1000);
  tokenCheckTimer.unref();
  const commands = await loadCommands({ features: { weather: config.weatherEnabled } });
  const client = new TwitchClient({
    ...config, getAccessToken: () => tokenManager.getAccessToken(),
    refreshAccessToken: tokenManager.canRefresh ? (usedToken) => tokenManager.refreshIfCurrent(usedToken) : undefined,
  });
  const twitchApi = createTwitchApi({ clientId: config.clientId, tokenManager, moderatorId: account.userId, streamInfoCacheSeconds: config.streamInfoCacheSeconds });
  const broadcasterId = await twitchApi.getUserId(config.channel);
  const faceitApi = createFaceitApi({ apiKey: config.faceitApiKey, gameId: config.faceitGameId });
  const faceitUserStore = await createFaceitUserStore(path.join(config.dataDirectory, 'faceit-user.json'), config.faceitDefaultNickname).load();
  const customCommands = await createCustomCommandStore(path.join(config.dataDirectory, 'commands.json'), config.prefix).load(new Set(commands.keys()));
  const predictionPresets = await createPredictionPresetStore(path.join(config.dataDirectory, 'predictions.json'));
  try {
    const conflict = predictionPresets.listCommands().find((name) =>
      commands.has(name.slice(1)) || customCommands.has(`${config.prefix}${name.slice(1)}`));
    if (conflict) throw new Error(`Command ${conflict} is already in use.`);
    customCommands.setRuntimeReserved(predictionPresets.listCommands());
  } catch (error) {
    predictionPresets.available = false;
    predictionPresets.presets.clear();
    logger.error('Prediction presets disabled because a command name is already in use.', error.message);
  }
  const pollPresets = await loadPollPresets(path.join(config.dataDirectory, 'polls.json'), path.resolve('data/polls.example.json'));
  const pinQueue = await createPinQueue(path.join(config.dataDirectory, 'pin-queue.json'), path.join(config.dataDirectory, 'pins.json'), path.resolve('data/pins.example.json'));
  const chatTimers = await createChatTimers(path.join(config.dataDirectory, 'timers.json'), {
    minMessages: config.timerMinChatMessages, send: (channel, text) => client.say(channel, text), channel: config.channel,
  });
  const autoReplies = await createAutoReplies(path.join(config.dataDirectory, 'auto-replies.json'), {
    cooldownSeconds: config.autoReplyCooldownSeconds, botUsername: config.username, prefix: config.prefix,
    send: (channel, text) => client.say(channel, text), channel: config.channel,
  });
  const reminders = await createReminders(path.join(config.dataDirectory, 'reminders.json'), {
    send: (channel, text) => client.say(channel, text), canSend: () => client.isConnected(), channel: config.channel,
  });
  const activeChatters = createActiveChatters({
    windowMinutes: config.activeChatterWindowMinutes, botUsername: config.username, broadcaster: config.channel,
  });
  const hasPollScope = account.scopes.includes('channel:manage:polls');
  const isPollBroadcaster = account.userId === broadcasterId;
  const pollsEnabled = hasPollScope && isPollBroadcaster && Object.keys(pollPresets).length > 0;
  if (!hasPollScope) logger.warn('Poll commands disabled: OAuth token is missing channel:manage:polls.');
  else if (!isPollBroadcaster) logger.warn('Poll commands disabled: the OAuth token must belong to the channel broadcaster.');
  const messageQueue = createMessageQueue({ send: (channel, message) => client.say(channel, message), delayMs: config.commandRepeatDelayMs });
  const predictionSession = createPredictionSession({
    botUsername: config.username,
    onComplete: (result) => client.say(config.channel, t('prediction.finished', result)),
  });
  const automod = createAutoMod({
    client: { timeout: (username, durationSeconds, reason, userId) => twitchApi.timeoutUser({ broadcasterId, username, userId, durationSeconds, reason }) },
    config: config.automod,
  });
  const handleCommand = createCommandHandler({
    client, channel: config.channel, prefix: config.prefix, commands,
    commandOptions: {
      weatherTimeoutMs: config.weatherTimeoutMs, weatherAllowedUsernames: config.weatherAllowedUsernames,
      customCommands, messageQueue, maxRepeat: config.commandRepeatMax, canModerate,
      twitchApi, broadcasterId, botUserId: account.userId, pinDurationSeconds: config.pinDurationSeconds,
      pinMessage: config.pinMessage, pollPresets, pollsEnabled,
      faceitApi, faceitUserStore,
      predictionPresets, predictionSession,
      pinQueue, pinQueueAutoRotate: config.pinQueueAutoRotate,
      chatTimers, autoReplies, reminders, activeChatters, tokenScopes: account.scopes,
    },
  });
  client.onMessage((line) => {
    const message = parseChatMessage(line);
    if (!message || message.channel !== config.channel || message.username === config.username) return;
    void handleIncomingMessage(message);
  });
  client.connect();
  const stopChatTimers = chatTimers.start();
  const stopReminders = reminders.start();
  const eventSub = new EventSubClient({
    twitchApi, definitions: eventSubDefinitions({ config, scopes: account.scopes, botUserId: account.userId, broadcasterId }),
    send: (channel, text) => client.say(channel, text), channel: config.channel,
  });
  eventSub.start();
  const stopPinRotation = config.pinQueueAutoRotate ? startPinRotation({
    pinQueue, intervalSeconds: config.pinQueueIntervalSeconds,
    pin: (text, itemDurationSeconds) => pinText({
      twitchApi, broadcasterId, botUserId: account.userId,
      durationSeconds: itemDurationSeconds ?? config.pinDurationSeconds,
    }, text),
    onError: (error) => logger.error('Automatic pin rotation failed.', error.message),
  }) : () => {};
  logger.info(`Starting bot for #${config.channel}. AutoMod ${config.automod.enabled ? 'enabled' : 'disabled'}.`);

  let closing = false;
  async function handleIncomingMessage(message) {
    try {
      if (await automod.handle(message)) return;
      activeChatters.record(message);
      chatTimers.recordChat();
      autoReplies.handle(message);
      await handleCommand(message);
    } catch (error) {
      logger.error('Failed to process a Twitch chat message.', error.message);
    }
  }

  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info(`Received ${signal}; shutting down.`);
    clearInterval(tokenCheckTimer);
    predictionSession.close();
    await stopPinRotation();
    await stopChatTimers();
    await stopReminders();
    await eventSub.close();
    automod.close();
    await messageQueue.close();
    await client.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    logger.error(error.message);
    process.exitCode = 1;
  });
}
