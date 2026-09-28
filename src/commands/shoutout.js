import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

const channelState = new Map();
const GLOBAL_COOLDOWN_MS = 2 * 60 * 1000;
const TARGET_COOLDOWN_MS = 60 * 60 * 1000;

export default {
  name: 'so', aliases: ['shoutout'], cooldown: 2,
  async execute({ client, channel, message, args, twitchApi, broadcasterId, tokenScopes = [] }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (args.length !== 1 || !/^[a-zA-Z0-9_]{1,25}$/u.test(args[0] ?? '')) {
      return client.say(channel, t('shoutout.usage'));
    }
    if (!new Set(tokenScopes).has('moderator:manage:shoutouts')) {
      return client.say(channel, t('shoutout.scope'));
    }

    const username = args[0].toLowerCase();
    try {
      const targetBroadcasterId = await twitchApi.getUserId(username);
      let state = channelState.get(broadcasterId);
      if (!state) {
        state = { lastSentAt: 0, targets: new Map(), inFlight: false };
        channelState.set(broadcasterId, state);
      }
      const now = Date.now();
      for (const [targetId, until] of state.targets) {
        if (now >= until) state.targets.delete(targetId);
      }
      const targetUntil = state.targets.get(targetBroadcasterId) ?? 0;
      if (now < targetUntil) {
        return client.say(channel, t('shoutout.targetCooldown', {
          minutes: Math.ceil((targetUntil - now) / 60_000),
        }));
      }
      if (targetBroadcasterId === broadcasterId) return client.say(channel, t('shoutout.self'));
      if (now < state.lastSentAt + GLOBAL_COOLDOWN_MS) {
        return client.say(channel, t('shoutout.cooldown', {
          seconds: Math.ceil((state.lastSentAt + GLOBAL_COOLDOWN_MS - now) / 1000),
        }));
      }
      if (state.inFlight) return client.say(channel, t('shoutout.busy'));

      state.inFlight = true;
      try {
        await twitchApi.sendShoutout({ broadcasterId, targetBroadcasterId });
        const sentAt = Date.now();
        state.lastSentAt = sentAt;
        state.targets.set(targetBroadcasterId, sentAt + TARGET_COOLDOWN_MS);
        return client.say(channel, t('shoutout.sent', { user: username }));
      } finally {
        state.inFlight = false;
      }
    } catch (error) {
      logger.warn(`Could not send Twitch shoutout for @${username}.`, error.message);
      client.say(channel, t('shoutout.error'));
    }
  },
};
