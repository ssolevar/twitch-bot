import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';
import { reservedCommandNames } from '../utils/reserved-command-names.js';

const actions = new Map([
  ['addalias', 'addAlias'], ['добалиас', 'addAlias'],
  ['delalias', 'deleteAlias'], ['удалалиас', 'deleteAlias'],
  ['aliases', 'aliases'], ['алиасы', 'aliases'],
  ['permission', 'permission'], ['права', 'permission'],
  ['addresponse', 'addResponse'], ['добответ', 'addResponse'],
  ['responses', 'responses'], ['ответы', 'responses'],
  ['delresponse', 'deleteResponse'], ['удалответ', 'deleteResponse'],
  ['cooldown', 'globalCooldown'], ['кд', 'globalCooldown'],
  ['usercooldown', 'userCooldown'], ['юзеркд', 'userCooldown'],
  ['disablecom', 'disable'], ['offcmd', 'disable'], ['выклком', 'disable'],
  ['enablecom', 'enable'], ['oncmd', 'enable'], ['вклком', 'enable'],
]);

export default {
  name: 'addalias', aliases: [...actions.keys()].filter((name) => name !== 'addalias'), cooldown: 0,
  async execute({ client, channel, message, args, commandName, customCommands, commands, predictionPresets }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const action = actions.get(commandName);
    const [name, second, ...rest] = args;
    if (!name || (!['aliases', 'responses', 'disable', 'enable', 'deleteAlias'].includes(action) && !second)) {
      return client.say(channel, t('settings.usage', { command: commandName }));
    }
    try {
      if (action === 'addAlias') await customCommands.addAlias(name, second, reservedCommandNames(commands, predictionPresets));
      else if (action === 'deleteAlias') await customCommands.deleteAlias(name);
      else if (action === 'aliases') {
        const aliases = customCommands.aliases(name);
        if (!aliases) throw new Error('Command does not exist.');
        return client.say(channel, t('settings.aliases', { name, aliases: aliases.join(', ') || t('common.none') }).slice(0, 450));
      } else if (action === 'permission') await customCommands.setPermission(name, second);
      else if (action === 'addResponse') await customCommands.addResponse(name, [second, ...rest].join(' '));
      else if (action === 'responses') {
        const responses = customCommands.responses(name);
        if (!responses) throw new Error('Command does not exist.');
        return client.say(channel, t('settings.responses', { name, responses: responses.map((value, index) => `${index + 1}. ${value}`).join(' | ') }).slice(0, 450));
      } else if (action === 'deleteResponse') await customCommands.deleteResponse(name, Number(second));
      else if (action === 'globalCooldown' || action === 'userCooldown') await customCommands.setCooldown(name, action, second);
      else if (action === 'disable' || action === 'enable') await customCommands.setEnabled(name, action === 'enable');
      if (action === 'disable' || action === 'enable') {
        client.say(channel, t(action === 'enable' ? 'settings.enabled' : 'settings.disabled', { name: name.toLowerCase() }));
      } else client.say(channel, t('settings.updated', { name: name.toLowerCase() }));
    } catch (error) {
      logger.warn('Could not change custom command settings.', error.message);
      if (error.message.includes('already exists') || error.message.includes('built-in command')) return client.say(channel, t('settings.nameTaken'));
      if (error.message.includes('does not exist')) return client.say(channel, t('settings.missing'));
      client.say(channel, t('settings.error'));
    }
  },
};
