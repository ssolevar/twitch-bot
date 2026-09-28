import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'game', aliases: ['игра'], cooldown: 3,
  async execute({ client, channel, twitchApi, broadcasterId }) {
    try {
      const info = await twitchApi.getChannelInformation({ broadcasterId });
      client.say(channel, info?.game_name ? t('game.category', { category: info.game_name }) : t('game.empty'));
    } catch (error) {
      logger.error('Could not read stream category.', error.message);
      client.say(channel, t('game.error'));
    }
  },
};
