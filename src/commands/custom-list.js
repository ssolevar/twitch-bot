import { hasCommandPermission } from '../utils/permissions.js';
import { t } from '../utils/messages.js';

export default {
  name: 'кастомки', aliases: ['customcommands'], cooldown: 5,
  execute({ client, channel, message, customCommands }) {
    const names = customCommands?.listAvailable?.(message, channel) ??
      customCommands?.entries?.().filter(([, record]) => record && hasCommandPermission(message, channel, 'everyone')).map(([name]) => name) ?? [];
    let output = t('commands.list', { names: '' });
    for (const name of names) {
      const part = `${output.endsWith(': ') ? '' : ', '}${name}`;
      if (output.length + part.length > 450) break;
      output += part;
    }
    client.say(channel, names.length ? output : t('commands.empty'));
  },
};
