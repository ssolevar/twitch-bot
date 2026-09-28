import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t, translateKnownError } from '../utils/messages.js';

export default {
  name: 'добавто', aliases: ['удавто', 'автоответы', 'вклавто', 'выклавто'], cooldown: 0,
  async execute({ client, channel, message, args, commandName, autoReplies }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      if (commandName === 'автоответы') {
        const items = autoReplies.list();
        return client.say(channel, items.length
          ? t('autoReplies.list', { items: items.map((item) => `${item.keyword} (${t(item.enabled ? 'common.enabled' : 'common.disabled')})`).join(', ') }).slice(0, 450)
          : t('autoReplies.empty'));
      }
      const [keyword, ...words] = args;
      if (commandName === 'добавто') await autoReplies.add(keyword, words.join(' '));
      else if (commandName === 'удавто') await autoReplies.remove(keyword);
      else await autoReplies.setEnabled(keyword, commandName === 'вклавто');
      client.say(channel, t('autoReplies.updated', { keyword: keyword?.toLowerCase() ?? '' }));
    } catch (error) {
      logger.warn('Could not update auto reply.', error.message);
      client.say(channel, t('autoReplies.error', { error: translateKnownError('autoReplies.detail', error.message) }).slice(0, 450));
    }
  },
};
