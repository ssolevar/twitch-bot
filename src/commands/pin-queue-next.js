import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { pinText } from './pin.js';
import { t } from '../utils/messages.js';

export default {
  name: 'nextpin', aliases: ['следпин'], cooldown: 2,
  async execute({ client, channel, message, pinQueue, pinQueueAutoRotate, twitchApi, broadcasterId, botUserId, pinDurationSeconds }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (!pinQueue.queueAvailable) return client.say(channel, t('pin.queueUnavailable'));
    try {
      const result = await pinQueue.pinNext({
        rotate: pinQueueAutoRotate,
        pin: (text, itemDurationSeconds) => pinText({
          twitchApi, broadcasterId, botUserId,
          durationSeconds: itemDurationSeconds ?? pinDurationSeconds,
        }, text),
      });
      if (!result) return client.say(channel, t('pin.queueEmpty'));
      client.say(channel, t('pin.nextDone', { remaining: result.remaining }));
    } catch (error) {
      logger.error('Could not pin next queued message.', error.message);
      client.say(channel, t('pin.nextError'));
    }
  },
};
