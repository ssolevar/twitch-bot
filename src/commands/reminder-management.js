import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { currentLanguage, t, translateKnownError } from '../utils/messages.js';

export default {
  name: 'напомни', aliases: ['напоминания', 'удалнапоминание'], cooldown: 0,
  async execute({ client, channel, message, args, commandName, reminders }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      if (commandName === 'напоминания') {
        const items = reminders.list();
        return client.say(channel, items.length
          ? t('reminders.list', { items: items.map((item, index) => `${index + 1}. ${new Date(item.dueAt).toLocaleString(currentLanguage() === 'en' ? 'en-US' : 'ru-RU')} — ${item.text}`).join(' | ') }).slice(0, 450)
          : t('reminders.empty'));
      }
      if (commandName === 'напомни') {
        const [minutes, ...words] = args;
        const position = await reminders.add(minutes, words.join(' '));
        return client.say(channel, t('reminders.added', { position }));
      }
      await reminders.remove(args[0]);
      client.say(channel, t('reminders.removed'));
    } catch (error) {
      logger.warn('Could not update reminder.', error.message);
      client.say(channel, t('reminders.error', { error: translateKnownError('reminders.detail', error.message) }).slice(0, 450));
    }
  },
};
