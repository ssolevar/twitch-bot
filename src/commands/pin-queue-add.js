import { canModerate } from '../utils/permissions.js';
import { reportPinDataError } from '../utils/pin-command-errors.js';
import { t } from '../utils/messages.js';

export default {
  name: 'addpin', aliases: ['добпин', 'добавпин'], cooldown: 2,
  async execute({ client, channel, message, args, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    let durationSeconds = null;
    let text = args.join(' ');
    if (args.length > 1 && /^-?\d+(?:\.\d+)?$/u.test(args[0])) {
      durationSeconds = Number(args[0]);
      text = args.slice(1).join(' ');
      if (!Number.isInteger(durationSeconds) || (durationSeconds !== 0 && (durationSeconds < 30 || durationSeconds > 1800))) {
        return client.say(channel, t('pin.invalidQueueDuration'));
      }
    }
    try {
      const position = await pinQueue.add(text, durationSeconds);
      client.say(channel, t('pin.queueAdded', { position }));
    } catch (error) {
      reportPinDataError(client, channel, error);
    }
  },
};
