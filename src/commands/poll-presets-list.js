import { t } from '../utils/messages.js';

export default {
  name: 'pollpresets', aliases: ['опросы'], cooldown: 2,
  execute({ client, channel, pollPresets, pollsEnabled }) {
    if (!pollsEnabled) return client.say(channel, t('poll.disabled'));
    const names = Object.keys(pollPresets);
    client.say(channel, names.length ? t('poll.presetsList', {
      names: names.slice(0, 30).join(', '), more: names.length > 30 ? t('common.more', { count: names.length - 30 }) : '',
    }).slice(0, 440) : t('poll.presetsEmpty'));
  },
};
