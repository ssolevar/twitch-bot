import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'unpin', aliases: ['откреп'], cooldown: 2,
  async execute({ client, channel, message, twitchApi, broadcasterId }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      const pinned = await twitchApi.getPinnedChatMessage({ broadcasterId });
      if (!pinned?.message_id) return client.say(channel, t('pin.noPinnedMessage'));
      await twitchApi.unpinChatMessage({ broadcasterId, messageId: pinned.message_id });
    } catch (error) {
      logger.error('Could not unpin chat message.', error.message);
      client.say(channel, t('pin.unpinError'));
    }
  },
};
