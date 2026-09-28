import { canModerate } from '../utils/permissions.js';
import { reportPinDataError } from '../utils/pin-command-errors.js';
import { t } from '../utils/messages.js';

export default {
  name: 'delpinpreset', aliases: ['удалпинпресет', 'удалитьпинпресет'], cooldown: 2,
  async execute({ client, channel, message, args, pinQueue }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (args.length !== 1) return client.say(channel, t('pin.removePresetUsage'));
    try {
      const name = await pinQueue.deletePreset(args[0]);
      client.say(channel, t('pin.presetRemoved', { name }));
    } catch (error) {
      reportPinDataError(client, channel, error);
    }
  },
};
