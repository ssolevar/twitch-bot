import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'setuser', aliases: [], cooldown: 2,
  async execute({ client, channel, message, args, faceitUserStore }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const nickname = args[0]?.trim();
    if (args.length !== 1 || !nickname || nickname.length > 40 || /[\s\r\n\0]/u.test(nickname)) {
      return client.say(channel, t('faceit.setUserUsage'));
    }
    try {
      await faceitUserStore.setNickname(nickname);
      client.say(channel, t('faceit.defaultSet', { nickname }));
    } catch (error) {
      logger.warn('Could not save the default FACEIT player.', error.message);
      client.say(channel, t('faceit.defaultSaveError'));
    }
  },
};
