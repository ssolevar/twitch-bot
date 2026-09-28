import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

const actions = new Map([
  ['сменназвание', 'title'], ['settitle', 'title'],
  ['сменкатегорию', 'category'], ['setcategory', 'category'],
  ['слоу', 'slow'], ['slow', 'slow'],
  ['фолловеры', 'followers'], ['followers', 'followers'],
  ['эмоуты', 'emotes'], ['emotes', 'emotes'],
  ['очиститьчат', 'clear'], ['clearchat', 'clear'],
]);

function integer(value, minimum, maximum) {
  if (!/^\d+$/u.test(value ?? '')) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function switchValue(value) {
  const normalized = value?.toLowerCase();
  if (['вкл', 'on'].includes(normalized)) return true;
  if (['выкл', 'off'].includes(normalized)) return false;
  return null;
}

function usage(action) {
  const key = {
    title: 'stream.usageTitle', category: 'stream.usageCategory', slow: 'stream.usageSlow',
    followers: 'stream.usageFollowers', emotes: 'stream.usageEmotes', clear: 'stream.usageClear',
  }[action];
  return key ? t(key) : undefined;
}

export default {
  name: 'сменназвание',
  aliases: [...actions.keys()].filter((name) => name !== 'сменназвание'),
  cooldown: 0,
  async execute({ client, channel, message, args, commandName, twitchApi, broadcasterId, botUserId, tokenScopes }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const action = actions.get(commandName);
    const value = args.join(' ').trim();
    const scopes = new Set(tokenScopes ?? []);
    if (action === 'title' || action === 'category') {
      if (botUserId !== broadcasterId || !scopes.has('channel:manage:broadcast')) {
        return client.say(channel, t('stream.broadcastScope'));
      }
    } else if (action === 'clear') {
      if (!scopes.has('moderator:manage:chat_messages')) return client.say(channel, t('stream.clearScope'));
    } else if (!scopes.has('moderator:manage:chat_settings')) {
      return client.say(channel, t('stream.settingsScope'));
    }

    try {
      if (action === 'title') {
        if (!value || value.length > 140 || /[\r\n\0]/u.test(value)) return client.say(channel, usage(action));
        await twitchApi.updateChannelInformation({ broadcasterId, title: value });
        return client.say(channel, t('stream.titleUpdated'));
      }
      if (action === 'category') {
        if (!value || value.length > 100 || /[\r\n\0]/u.test(value)) return client.say(channel, usage(action));
        const game = await twitchApi.getGameByName(value);
        if (!game) return client.say(channel, t('stream.categoryMissing'));
        await twitchApi.updateChannelInformation({ broadcasterId, gameId: game.id });
        return client.say(channel, t('stream.categoryUpdated', { category: game.name }).slice(0, 450));
      }
      if (action === 'slow') {
        if (args.length !== 1) return client.say(channel, usage(action));
        const off = switchValue(args[0]) === false;
        const seconds = off ? null : integer(args[0], 3, 120);
        if (!off && seconds === null) return client.say(channel, usage(action));
        await twitchApi.updateChatSettings({ broadcasterId, settings: off ? { slow_mode: false } : { slow_mode: true, slow_mode_wait_time: seconds } });
        return client.say(channel, off ? t('stream.slowOff') : t('stream.slowOn', { seconds }));
      }
      if (action === 'followers') {
        if (args.length !== 1) return client.say(channel, usage(action));
        const off = switchValue(args[0]) === false;
        const minutes = off ? null : integer(args[0], 0, 129_600);
        if (!off && minutes === null) return client.say(channel, usage(action));
        await twitchApi.updateChatSettings({ broadcasterId, settings: off ? { follower_mode: false } : { follower_mode: true, follower_mode_duration: minutes } });
        return client.say(channel, off ? t('stream.followersOff') : t('stream.followersOn', { minutes }));
      }
      if (action === 'emotes') {
        if (args.length !== 1) return client.say(channel, usage(action));
        const enabled = switchValue(args[0]);
        if (enabled === null) return client.say(channel, usage(action));
        await twitchApi.updateChatSettings({ broadcasterId, settings: { emote_mode: enabled } });
        return client.say(channel, t(enabled ? 'stream.emotesOn' : 'stream.emotesOff'));
      }
      if (args.length !== 0) return client.say(channel, usage(action));
      await twitchApi.clearChat({ broadcasterId });
      return client.say(channel, t('stream.chatCleared'));
    } catch (error) {
      logger.warn(`Could not perform stream management command ${commandName}.`, error.message);
      return client.say(channel, t('stream.error'));
    }
  },
};
