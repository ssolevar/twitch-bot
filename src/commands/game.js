import { logger } from '../utils/logger.js';
import { canModerate } from '../utils/permissions.js';
import { t } from '../utils/messages.js';

export default {
  name: 'game', aliases: ['игра', 'category', 'категория'], cooldown: 3,
  async execute({ client, channel, message, args = [], user, twitchApi, broadcasterId, botUserId, tokenScopes }) {
    if (args.length) {
      if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
      if (botUserId !== broadcasterId || !new Set(tokenScopes ?? []).has('channel:manage:broadcast')) {
        return client.say(channel, t('stream.broadcastScope'));
      }
      const name = args.join(' ').trim();
      if (!name || name.length > 100 || /[\r\n\0]/u.test(name)) return client.say(channel, t('stream.usageCategory'));
      try {
        const game = await twitchApi.getGameByName(name);
        if (!game) return client.say(channel, t('stream.categoryMissing'));
        await twitchApi.updateChannelInformation({ broadcasterId, gameId: game.id });
        return client.say(channel, t('stream.categoryUpdatedBy', { category: game.name, user }).slice(0, 450));
      } catch (error) {
        logger.warn('Could not update stream category.', error.message);
        return client.say(channel, t('stream.error'));
      }
    }
    try {
      const info = await twitchApi.getChannelInformation({ broadcasterId });
      client.say(channel, info?.game_name ? t('game.category', { category: info.game_name }) : t('game.empty'));
    } catch (error) {
      logger.error('Could not read stream category.', error.message);
      client.say(channel, t('game.error'));
    }
  },
};
