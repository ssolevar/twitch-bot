import 'dotenv/config';
import path from 'node:path';
import { loadProfileEnvironment } from './services/config-profiles.js';
import { configureLanguage, t } from './utils/messages.js';

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}\nSee .env.example for configuration.`);
  return value;
}

function positiveInteger(env, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function loadConfig() {
  const env = loadProfileEnvironment();
  const need = (name) => required(env, name);
  const integer = (name, fallback, maximum) => positiveInteger(env, name, fallback, maximum);
  const enabled = (env.ENABLE_AUTOMOD ?? 'false').toLowerCase() === 'true';
  const username = need('TWITCH_BOT_USERNAME').toLowerCase().replace(/^@/, '');
  const channel = need('TWITCH_CHANNEL').toLowerCase().replace(/^#/, '');
  const weatherAllowedUsernames = parseUsernames(env.WEATHER_ALLOWED_USERNAMES);
  const pinDurationSeconds = env.PIN_DURATION_SECONDS?.trim() === '0' ? 0 : integer('PIN_DURATION_SECONDS', 600, 1800);
  const language = (env.BOT_LANGUAGE ?? 'ru').toLowerCase();
  if (!['ru', 'en'].includes(language)) throw new Error('BOT_LANGUAGE must be ru or en.');
  configureLanguage(language);
  return {
    username,
    channel,
    profile: env.BOT_PROFILE?.trim() || '',
    language,
    dataDirectory: path.resolve('data', env.BOT_PROFILE?.trim() || ''),
    logging: {
      profile: env.BOT_PROFILE?.trim() || '', level: env.LOG_LEVEL || 'info',
      fileMaxBytes: Math.max(1024, integer('LOG_FILE_MAX_BYTES', 5 * 1024 * 1024, 100 * 1024 * 1024)),
      fileBackups: integer('LOG_FILE_BACKUPS', 3, 10),
    },
    clientId: need('TWITCH_CLIENT_ID'),
    accessToken: need('TWITCH_ACCESS_TOKEN').replace(/^oauth:/i, ''),
    refreshToken: env.TWITCH_REFRESH_TOKEN?.trim() ?? '',
    clientSecret: env.TWITCH_CLIENT_SECRET?.trim() ?? '',
    prefix: env.COMMAND_PREFIX?.trim() || '!',
    commandRepeatMax: integer('MAX_COMMAND_REPEAT', 10, 100),
    commandRepeatDelayMs: integer('COMMAND_REPEAT_DELAY_MS', 700, 60_000),
    timerMinChatMessages: integer('TIMER_MIN_CHAT_MESSAGES', 5, 1000),
    autoReplyCooldownSeconds: integer('AUTO_REPLY_COOLDOWN_SECONDS', 30, 3600),
    activeChatterWindowMinutes: integer('ACTIVE_CHATTER_WINDOW_MINUTES', 15, 1440),
    streamInfoCacheSeconds: integer('STREAM_INFO_CACHE_SECONDS', 30, 3600),
    pinDurationSeconds,
    pinMessage: env.PIN_MESSAGE?.trim() ?? '',
    faceitApiKey: env.FACEIT_API_KEY?.trim() ?? '',
    faceitDefaultNickname: env.FACEIT_DEFAULT_NICKNAME?.trim() ?? '',
    faceitGameId: env.FACEIT_GAME_ID?.trim().toLowerCase() || 'cs2',
    pinQueueAutoRotate: (env.PIN_QUEUE_AUTO_ROTATE ?? 'false').toLowerCase() === 'true',
    pinQueueIntervalSeconds: integer('PIN_QUEUE_INTERVAL_SECONDS', 600, 86_400),
    weatherEnabled: (env.ENABLE_WEATHER ?? 'false').toLowerCase() === 'true',
    weatherTimeoutMs: integer('WEATHER_TIMEOUT_MS', 10_000, 60_000),
    weatherAllowedUsernames,
    eventSub: {
      enabled: (env.ENABLE_EVENTSUB ?? 'false').toLowerCase() === 'true',
      follow: (env.EVENT_FOLLOW_MESSAGE ?? 'true').toLowerCase() === 'true',
      sub: (env.EVENT_SUB_MESSAGE ?? 'true').toLowerCase() === 'true',
      raid: (env.EVENT_RAID_MESSAGE ?? 'true').toLowerCase() === 'true',
      gift: (env.EVENT_GIFT_MESSAGE ?? 'false').toLowerCase() === 'true',
      resub: (env.EVENT_RESUB_MESSAGE ?? 'false').toLowerCase() === 'true',
      cheer: (env.EVENT_CHEER_MESSAGE ?? 'false').toLowerCase() === 'true',
      update: (env.EVENT_UPDATE_MESSAGE ?? 'false').toLowerCase() === 'true',
      online: (env.EVENT_ONLINE_MESSAGE ?? 'false').toLowerCase() === 'true',
      offline: (env.EVENT_OFFLINE_MESSAGE ?? 'false').toLowerCase() === 'true',
      followTemplate: env.EVENT_FOLLOW_TEMPLATE?.trim() || t('event.follow'),
      subTemplate: env.EVENT_SUB_TEMPLATE?.trim() || t('event.sub'),
      raidTemplate: env.EVENT_RAID_TEMPLATE?.trim() || t('event.raid'),
      giftTemplate: env.EVENT_GIFT_TEMPLATE?.trim() || t('event.gift'),
      resubTemplate: env.EVENT_RESUB_TEMPLATE?.trim() || t('event.resub'),
      cheerTemplate: env.EVENT_CHEER_TEMPLATE?.trim() || t('event.cheer'),
      updateTemplate: env.EVENT_UPDATE_TEMPLATE?.trim() || t('event.update'),
      onlineTemplate: env.EVENT_ONLINE_TEMPLATE?.trim() || t('event.online'),
      offlineTemplate: env.EVENT_OFFLINE_TEMPLATE?.trim() || t('event.offline'),
      anonymousLabel: t('event.anonymous'),
    },
    automod: {
      enabled,
      timeoutSeconds: integer('AUTOMOD_TIMEOUT_SECONDS', 60, 86_400),
      streakWindowSeconds: integer('AUTOMOD_STREAK_WINDOW_SECONDS', 600, 86_400),
      maxTimeoutSeconds: integer('AUTOMOD_MAX_TIMEOUT_SECONDS', 3600, 604_800),
      capsEnabled: (env.AUTOMOD_CAPS_ENABLED ?? 'false').toLowerCase() === 'true',
      spamEnabled: (env.AUTOMOD_SPAM_ENABLED ?? 'false').toLowerCase() === 'true',
      capsMinLetters: integer('AUTOMOD_CAPS_MIN_LETTERS', 12, 500),
      capsRatio: boundedRatio(env.AUTOMOD_CAPS_RATIO, 0.8),
      spamRepeatCount: integer('AUTOMOD_SPAM_REPEAT_COUNT', 6, 100),
      spamCharacterLimit: integer('AUTOMOD_SPAM_CHARACTER_LIMIT', 10, 500),
      spamUrlLimit: integer('AUTOMOD_SPAM_URL_LIMIT', 3, 50),
      linkEnabled: (env.AUTOMOD_LINK_ENABLED ?? 'false').toLowerCase() === 'true',
      linkAllowedDomains: parseList(env.AUTOMOD_LINK_ALLOWED_DOMAINS),
      spamWindowSeconds: integer('AUTOMOD_SPAM_WINDOW_SECONDS', 10, 3600),
      spamMessageLimit: integer('AUTOMOD_SPAM_MESSAGE_LIMIT', 6, 100),
      repeatEnabled: (env.AUTOMOD_REPEAT_ENABLED ?? 'false').toLowerCase() === 'true',
      repeatWindowSeconds: integer('AUTOMOD_REPEAT_WINDOW_SECONDS', 60, 3600),
      repeatMessageLimit: integer('AUTOMOD_REPEAT_MESSAGE_LIMIT', 3, 100),
      repeatMinLength: integer('AUTOMOD_REPEAT_MIN_LENGTH', 8, 500),
      blacklistWords: parseList(env.AUTOMOD_BLACKLIST_WORDS),
      whitelistWords: parseList(env.AUTOMOD_WHITELIST_WORDS),
      blacklistUsernames: parseList(env.AUTOMOD_BLACKLIST_USERNAMES),
      whitelistUsernames: parseList(env.AUTOMOD_WHITELIST_USERNAMES),
      exemptModerators: (env.AUTOMOD_EXEMPT_MODERATORS ?? 'true').toLowerCase() === 'true',
      exemptVips: (env.AUTOMOD_EXEMPT_VIPS ?? 'false').toLowerCase() === 'true',
      exemptSubscribers: (env.AUTOMOD_EXEMPT_SUBSCRIBERS ?? 'false').toLowerCase() === 'true',
    },
  };
}

function boundedRatio(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function parseUsernames(value) {
  const usernames = (value ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  return new Set(usernames);
}

function parseList(value) {
  return (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
}
