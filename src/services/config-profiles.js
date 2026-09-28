import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED = new Set([
  'TWITCH_CHANNEL', 'BOT_LANGUAGE', 'COMMAND_PREFIX', 'MAX_COMMAND_REPEAT', 'COMMAND_REPEAT_DELAY_MS',
  'TIMER_MIN_CHAT_MESSAGES', 'AUTO_REPLY_COOLDOWN_SECONDS', 'ACTIVE_CHATTER_WINDOW_MINUTES',
  'STREAM_INFO_CACHE_SECONDS', 'PIN_DURATION_SECONDS', 'PIN_QUEUE_AUTO_ROTATE', 'PIN_QUEUE_INTERVAL_SECONDS',
  'LOG_LEVEL', 'LOG_FILE_MAX_BYTES', 'LOG_FILE_BACKUPS', 'ENABLE_EVENTSUB', 'EVENT_FOLLOW_MESSAGE',
  'EVENT_SUB_MESSAGE', 'EVENT_RAID_MESSAGE', 'EVENT_FOLLOW_TEMPLATE', 'EVENT_SUB_TEMPLATE',
  'EVENT_RAID_TEMPLATE', 'EVENT_GIFT_MESSAGE', 'EVENT_RESUB_MESSAGE', 'EVENT_CHEER_MESSAGE',
  'EVENT_UPDATE_MESSAGE', 'EVENT_ONLINE_MESSAGE', 'EVENT_OFFLINE_MESSAGE',
  'EVENT_GIFT_TEMPLATE', 'EVENT_RESUB_TEMPLATE', 'EVENT_CHEER_TEMPLATE', 'EVENT_UPDATE_TEMPLATE',
  'EVENT_ONLINE_TEMPLATE', 'EVENT_OFFLINE_TEMPLATE', 'ENABLE_AUTOMOD', 'ENABLE_WEATHER', 'WEATHER_TIMEOUT_MS',
  'WEATHER_ALLOWED_USERNAMES', 'AUTOMOD_TIMEOUT_SECONDS', 'AUTOMOD_STREAK_WINDOW_SECONDS',
  'AUTOMOD_MAX_TIMEOUT_SECONDS', 'AUTOMOD_CAPS_ENABLED', 'AUTOMOD_SPAM_ENABLED',
  'AUTOMOD_CAPS_MIN_LETTERS', 'AUTOMOD_CAPS_RATIO', 'AUTOMOD_SPAM_REPEAT_COUNT',
  'AUTOMOD_SPAM_CHARACTER_LIMIT', 'AUTOMOD_SPAM_URL_LIMIT',
  'AUTOMOD_LINK_ENABLED', 'AUTOMOD_LINK_ALLOWED_DOMAINS', 'AUTOMOD_SPAM_WINDOW_SECONDS',
  'AUTOMOD_SPAM_MESSAGE_LIMIT', 'AUTOMOD_REPEAT_ENABLED', 'AUTOMOD_REPEAT_WINDOW_SECONDS',
  'AUTOMOD_REPEAT_MESSAGE_LIMIT', 'AUTOMOD_REPEAT_MIN_LENGTH', 'AUTOMOD_BLACKLIST_WORDS',
  'AUTOMOD_WHITELIST_WORDS', 'AUTOMOD_BLACKLIST_USERNAMES', 'AUTOMOD_WHITELIST_USERNAMES',
  'AUTOMOD_EXEMPT_MODERATORS', 'AUTOMOD_EXEMPT_VIPS', 'AUTOMOD_EXEMPT_SUBSCRIBERS',
]);

export function loadProfileEnvironment(base = process.env) {
  const name = base.BOT_PROFILE?.trim();
  if (!name) return { ...base };
  if (!/^[a-z0-9_-]{1,32}$/u.test(name)) throw new Error('BOT_PROFILE must contain 1-32 lowercase letters, numbers, underscores, or hyphens.');
  const filePath = path.resolve('config/profiles.json');
  let profiles;
  try {
    profiles = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not load config profiles from ${filePath}: ${error.message}`, { cause: error });
  }
  if (!profiles || Array.isArray(profiles) || typeof profiles !== 'object' ||
    !Object.hasOwn(profiles, name) || !profiles[name] || Array.isArray(profiles[name]) || typeof profiles[name] !== 'object') {
    throw new Error(`Config profile ${name} was not found in ${filePath}.`);
  }
  const selected = profiles[name];
  for (const [key, value] of Object.entries(selected)) {
    if (!ALLOWED.has(key)) throw new Error(`Config profile ${name} contains unsupported setting ${key}.`);
    if (typeof value !== 'string' || /[\r\n\0]/u.test(value)) throw new Error(`Config profile ${name} has an invalid value for ${key}.`);
  }
  return { ...base, ...selected };
}
