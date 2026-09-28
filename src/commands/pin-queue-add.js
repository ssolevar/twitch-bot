import { canModerate } from '../utils/permissions.js';
import { reportPinDataError } from '../utils/pin-command-errors.js';
import { t } from '../utils/messages.js';

export default {
  name: 'addpin', aliases: ['добпин', 'добавпин'], cooldown: 2,
  async execute({ client, channel, message, args, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    try {
      const position = await pinQueue.add(args.join(' '));
      client.say(channel, t('pin.queueAdded', { position }));
    } catch (error) {
      reportPinDataError(client, channel, error);
    }
  },
};
