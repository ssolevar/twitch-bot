import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t, translateKnownError } from '../utils/messages.js';

export default {
  name: 'добтаймер', aliases: ['таймеры', 'удалтаймер', 'вклтаймер', 'выклтаймер'], cooldown: 0,
  async execute({ client, channel, message, args, commandName, chatTimers }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      if (commandName === 'таймеры') {
        const items = chatTimers.list();
        return client.say(channel, items.length
          ? t('timers.list', { items: items.map((item, index) => t('timers.item', {
            position: index + 1, interval: item.intervalMinutes,
            state: t(item.enabled ? 'common.enabled' : 'common.disabled'), text: item.text,
          })).join(' | ') }).slice(0, 450)
          : t('timers.empty'));
      }
      if (commandName === 'добтаймер') {
        const [minutes, ...words] = args;
        const position = await chatTimers.add(minutes, words.join(' '));
        return client.say(channel, t('timers.added', { position }));
      }
      const [position] = args;
      if (commandName === 'удалтаймер') await chatTimers.remove(position);
      else await chatTimers.setEnabled(position, commandName === 'вклтаймер');
      client.say(channel, t('timers.updated'));
    } catch (error) {
      logger.warn('Could not update chat timer.', error.message);
      client.say(channel, t('timers.error', { error: translateKnownError('timers.detail', error.message) }).slice(0, 450));
    }
  },
};
