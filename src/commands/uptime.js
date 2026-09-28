import { t } from '../utils/messages.js';

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [days && t('uptime.days', { value: days }), hours && t('uptime.hours', { value: hours }),
    minutes && t('uptime.minutes', { value: minutes }), t('uptime.seconds', { value: remainder })]
    .filter(Boolean).join(' ');
}

export default {
  name: 'аптайм',
  aliases: ['uptime'],
  cooldown: 5,
  async execute({ client, channel }) {
    client.say(channel, t('uptime.running', { duration: formatDuration(process.uptime()) }));
  },
};
