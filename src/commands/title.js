import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'title', aliases: ['название'], cooldown: 3,
  async execute({ client, channel, twitchApi, broadcasterId }) {
    try {
      const info = await twitchApi.getChannelInformation({ broadcasterId });
      client.say(channel, info?.title ? t('title.current', { title: info.title }) : t('title.empty'));
    } catch (error) {
      logger.error('Could not read stream title.', error.message);
      client.say(channel, t('title.error'));
    }
  },
};
