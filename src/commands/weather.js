import { getWeather } from '../services/weather.js';
import { t } from '../utils/messages.js';

export default {
  name: 'погода',
  aliases: ['weather'],
  cooldown: 15,
  feature: 'weather',
  async execute({ client, channel, user, args, weatherTimeoutMs, weatherAllowedUsernames }) {
    if (weatherAllowedUsernames?.size && !weatherAllowedUsernames.has(user.toLowerCase())) {
      client.say(channel, t('weather.restricted', { user }));
      return;
    }
    const city = args.join(' ').trim();
    if (!city) {
      client.say(channel, t('weather.usage', { user }));
      return;
    }
    if (city.length > 80) {
      client.say(channel, t('weather.tooLong', { user }));
      return;
    }
    try {
      client.say(channel, t('weather.result', { user, result: await getWeather(city, { timeoutMs: weatherTimeoutMs }) }));
    } catch (error) {
      client.say(channel, t('weather.error', { user, error: error.message }));
    }
  },
};
