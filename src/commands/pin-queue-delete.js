import { canModerate } from '../utils/permissions.js';
import { reportPinDataError } from '../utils/pin-command-errors.js';
import { t } from '../utils/messages.js';

export default {
  name: 'delpin', aliases: ['удалпин'], cooldown: 2,
  async execute({ client, channel, message, args, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const position = Number(args[0]);
    if (args.length !== 1 || !/^\d+$/u.test(args[0] ?? '')) return client.say(channel, t('pin.removeUsage'));
    try {
      await pinQueue.remove(position);
      client.say(channel, t('pin.queueRemoved', { position }));
    } catch (error) {
      reportPinDataError(client, channel, error);
    }
  },
};
