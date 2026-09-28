import { t } from '../utils/messages.js';

export default {
  name: 'pinpresets', aliases: ['пинпресеты'], cooldown: 2,
  execute({ client, channel, pinQueue }) {
    if (!pinQueue.presetsAvailable) return client.say(channel, t('pin.presetsUnavailable'));
    const names = pinQueue.listPresets();
    client.say(channel, names.length ? t('pin.presetsList', {
      names: names.slice(0, 30).join(', '), more: names.length > 30 ? t('common.more', { count: names.length - 30 }) : '',
    }).slice(0, 440) : t('pin.presetsEmpty'));
  },
};
