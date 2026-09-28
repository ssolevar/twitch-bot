import { logger } from '../utils/logger.js';
import { canModerate } from '../utils/permissions.js';
import { t } from '../utils/messages.js';

export default {
  name: 'title', aliases: ['название', 'тайтл'], cooldown: 3,
  async execute({ client, channel, message, args = [], user, twitchApi, broadcasterId, botUserId, tokenScopes }) {
    if (args.length) {
      if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
      if (botUserId !== broadcasterId || !new Set(tokenScopes ?? []).has('channel:manage:broadcast')) {
        return client.say(channel, t('stream.broadcastScope'));
      }
      const title = args.join(' ').trim();
      if (!title || title.length > 140 || /[\r\n\0]/u.test(title)) return client.say(channel, t('stream.usageTitle'));
      try {
        await twitchApi.updateChannelInformation({ broadcasterId, title });
        return client.say(channel, t('stream.titleUpdatedBy', { user }));
      } catch (error) {
        logger.warn('Could not update stream title.', error.message);
        return client.say(channel, t('stream.error'));
      }
    }
    try {
      const info = await twitchApi.getChannelInformation({ broadcasterId });
      client.say(channel, info?.title ? t('title.current', { title: info.title }) : t('title.empty'));
    } catch (error) {
      logger.error('Could not read stream title.', error.message);
      client.say(channel, t('title.error'));
    }
  },
};
