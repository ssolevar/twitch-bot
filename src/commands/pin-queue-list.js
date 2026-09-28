import { t } from '../utils/messages.js';

function formatQueue(items) {
  if (!items.length) return t('pin.queueEmpty');
  const shown = items.slice(0, 4).map((text, index) => `${index + 1}. ${text.length > 72 ? `${text.slice(0, 69)}...` : text}`);
  if (items.length > shown.length) shown.push(t('pin.queueMore', { count: items.length - 4 }));
  return t('pin.queueList', { items: shown.join(' | ') }).slice(0, 440);
}

export default {
  name: 'pins', aliases: ['пины'], cooldown: 2,
  execute({ client, channel, pinQueue }) {
    if (!pinQueue.queueAvailable) return client.say(channel, t('pin.queueUnavailable'));
    client.say(channel, formatQueue(pinQueue.list()));
  },
};

export { formatQueue };
