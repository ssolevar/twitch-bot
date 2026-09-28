import { t } from '../utils/messages.js';

export default {
  name: 'help',
  aliases: ['commands', 'команды'],
  cooldown: 10,
  async execute({ client, channel }) {
    client.say(channel, t('help.commands'));
  },
};
