import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';
import { reservedCommandNames } from '../utils/reserved-command-names.js';

function help(context) {
  context.client.say(context.channel, t('commands.usage'));
}

export default {
  name: 'addcom',
  aliases: ['newcmd', 'дк', 'lr', 'эдком', 'editcom', 'editcmd', 'delcom', 'delcmd', 'del', 'делит', 'добком', 'измком', 'удалком'],
  cooldown: 2,
  async execute(context) {
    const { client, args, message, channel, customCommands, commands, commandName, predictionPresets } = context;
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const [name, ...responseParts] = args;
    if (!name) return help(context);
    try {
      if (['delcom', 'delcmd', 'del', 'делит', 'удалком'].includes(commandName)) {
        if (responseParts.length) return help(context);
        await customCommands.delete(name);
        client.say(channel, t('commands.deleted', { name: name.toLowerCase() }));
        return;
      }
      const response = responseParts.join(' ').trim();
      if (!response) return help(context);
      const isAdd = ['addcom', 'newcmd', 'дк', 'lr', 'эдком', 'добком'].includes(commandName);
      if (isAdd) await customCommands.add(name, response, reservedCommandNames(commands, predictionPresets));
      else await customCommands.edit(name, response);
      client.say(channel, t(isAdd ? 'commands.added' : 'commands.updated', { name: name.toLowerCase() }));
    } catch (error) {
      logger.warn('Could not update a custom command.', error.message);
      if (error.message.includes('already exists')) return client.say(channel, t('commands.alreadyExists'));
      if (error.message.includes('does not exist')) return client.say(channel, t('commands.missing'));
      if (error.message.includes('built-in command')) return client.say(channel, t('commands.reserved'));
      if (error.message.includes('Command name')) return client.say(channel, t('commands.invalidName'));
      if (error.message.includes('Response must')) return client.say(channel, t('commands.invalidResponse'));
      client.say(channel, t('commands.error'));
    }
  },
};
