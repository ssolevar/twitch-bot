import { t } from '../utils/messages.js';

export default {
  name: 'пинг',
  aliases: ['ping'],
  cooldown: 5,
  async execute({ client, channel, user }) {
    client.say(channel, t('ping.response', { user }));
  },
};
