import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'clearpins', aliases: ['очиститьпины'], cooldown: 2,
  async execute({ client, channel, message, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      await pinQueue.clear();
      client.say(channel, t('pin.queueCleared'));
    } catch (error) {
      logger.error('Could not clear the pin queue.', error.message);
      client.say(channel, t('pin.queueClearError'));
    }
  },
};
