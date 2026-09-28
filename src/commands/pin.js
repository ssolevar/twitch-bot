import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

async function pinText({ twitchApi, broadcasterId, botUserId, durationSeconds }, text) {
  const messageId = await twitchApi.sendChatMessage({ broadcasterId, senderId: botUserId, message: text });
  await twitchApi.pinChatMessage({ broadcasterId, messageId, durationSeconds });
}

export default {
  name: 'pin', aliases: ['пин', 'pinpreset'], cooldown: 2,
  async execute({ client, channel, message, args, twitchApi, broadcasterId, botUserId, pinDurationSeconds, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    let durationSeconds = pinDurationSeconds;
    if (/^\d+$/u.test(args[0] ?? '')) durationSeconds = Number(args.shift());
    const requested = args.join(' ').trim();
    if (!requested) return client.say(channel, t('pin.usage'));
    if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 1800) {
      return client.say(channel, t('pin.invalidDuration'));
    }
    try {
      const preset = args.length === 1 ? pinQueue.getPreset(requested) : null;
      const text = preset ?? requested;
      await pinText({ twitchApi, broadcasterId, botUserId, durationSeconds }, text);
    } catch (error) {
      logger.error('Could not pin chat message.', error.message);
      client.say(channel, t('pin.error'));
    }
  },
};

export { pinText };
