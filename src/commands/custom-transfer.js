import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

const actions = new Map([
  ['инфоком', 'info'], ['infocom', 'info'],
  ['копком', 'copy'], ['copycom', 'copy'],
  ['экспортком', 'export'], ['exportcom', 'export'],
  ['импортком', 'import'], ['importcom', 'import'],
]);

function splitLine(label, value) {
  const lines = [];
  let remaining = value;
  let prefix = label;
  do {
    const length = 450 - prefix.length;
    lines.push(`${prefix}${remaining.slice(0, length)}`);
    remaining = remaining.slice(length);
    prefix = t('transfer.continued', { label });
  } while (remaining);
  return lines;
}

async function say(context, text) {
  if (context.messageQueue?.sendMany) await context.messageQueue.sendMany(context.channel, text, 1);
  else await context.client.say(context.channel, text);
}

async function showInfo(context, name) {
  const command = context.customCommands.resolve(name);
  if (!command) return say(context, t('transfer.missing'));
  await say(context, t('transfer.info', {
    name: command.name, state: t(command.enabled ? 'transfer.enabled' : 'transfer.disabled'),
    permission: command.permission, globalCooldown: command.globalCooldown,
    userCooldown: command.userCooldown, responseCount: command.responses.length,
  }));
  for (const line of splitLine(t('transfer.aliases'), command.aliases.join(', ') || t('common.none'))) await say(context, line);
  for (const [index, response] of command.responses.entries()) {
    for (const line of splitLine(t('transfer.response', { index: index + 1, count: command.responses.length }), response)) await say(context, line);
  }
}

export default {
  name: 'инфоком',
  aliases: [...actions.keys()].filter((name) => name !== 'инфоком'),
  cooldown: 0,
  async execute(context) {
    const { client, channel, message, args, commandName, customCommands, commands } = context;
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const action = actions.get(commandName);
    if (action === 'info' && args.length !== 1) return client.say(channel, t('transfer.usageInfo'));
    if (action === 'copy' && args.length !== 2) return client.say(channel, t('transfer.usageCopy'));
    if (action === 'export' && args.length !== 0) return client.say(channel, t('transfer.usageExport'));
    if (action === 'import' && (args.length > 1 || (args.length === 1 && !['заменить', 'replace'].includes(args[0].toLowerCase())))) {
      return client.say(channel, t('transfer.usageImport'));
    }
    try {
      if (action === 'info') return await showInfo(context, args[0]);
      if (action === 'copy') {
        await customCommands.copy(args[0], args[1], new Set(commands.keys()));
        return client.say(channel, t('transfer.copied', { source: args[0].toLowerCase(), target: args[1].toLowerCase() }));
      }
      if (action === 'export') {
        const result = await customCommands.exportToFile();
        return client.say(channel, t('transfer.exported', { count: result.count }));
      }
      const replace = args.length === 1;
      const result = await customCommands.importFromFile({ replace });
      return client.say(channel, t(replace ? 'transfer.replaced' : 'transfer.imported', { count: result.count }));
    } catch (error) {
      logger.warn(`Could not ${action} custom commands.`, error.message);
      if (action === 'import' && error.code === 'ENOENT') return client.say(channel, t('transfer.importFileMissing'));
      if (action === 'import' && error instanceof SyntaxError) return client.say(channel, t('transfer.invalidJson'));
      if (error.message.includes('already exists') || error.message.includes('conflicts with a built-in command')) {
        return client.say(channel, t('transfer.nameTaken'));
      }
      if (error.message.includes('does not exist')) return client.say(channel, t('transfer.missing'));
      return client.say(channel, t('transfer.error'));
    }
  },
};
