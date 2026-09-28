import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

async function pinText({ twitchApi, broadcasterId, botUserId, durationSeconds }, text) {
  const messageId = await twitchApi.sendChatMessage({ broadcasterId, senderId: botUserId, message: text });
  await twitchApi.pinChatMessage({ broadcasterId, messageId, durationSeconds });
}

export default {
  name: 'pin', aliases: ['пин', 'закреп', 'pinpreset'], cooldown: 2,
  async execute({ client, channel, message, args, commandName, twitchApi, broadcasterId, botUserId, pinDurationSeconds, pinMessage, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    let durationSeconds = pinDurationSeconds;
    if (/^\d+$/u.test(args[0] ?? '')) durationSeconds = Number(args.shift());
    if (durationSeconds !== 0 && (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 1800)) {
      return client.say(channel, t('pin.invalidDuration'));
    }

    if (commandName === 'закреп' || commandName === 'pin') {
      if (args.length) return client.say(channel, t('pin.usage'));
      try {
        if (message.replyParentMessageId) {
          await twitchApi.pinChatMessage({ broadcasterId, messageId: message.replyParentMessageId, durationSeconds });
        } else {
          if (!pinMessage) return client.say(channel, t('pin.defaultMessageMissing'));
          await pinText({ twitchApi, broadcasterId, botUserId, durationSeconds }, pinMessage);
        }
      } catch (error) {
        logger.error('Could not pin chat message.', error.message);
        client.say(channel, t('pin.error'));
      }
      return;
    }

    const requested = args.join(' ').trim();
    if (!requested && message.replyParentMessageId) {
      try {
        await twitchApi.pinChatMessage({ broadcasterId, messageId: message.replyParentMessageId, durationSeconds });
      } catch (error) {
        logger.error('Could not pin replied chat message.', error.message);
        client.say(channel, t('pin.error'));
      }
      return;
    }
    if (!requested) return client.say(channel, t('pin.usage'));
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
