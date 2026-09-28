import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'elo', aliases: ['эло', 'удщ'], cooldown: 5,
  async execute({ client, channel, args, faceitApi, faceitUserStore, faceitGameId }) {
    if (args.length > 1) return client.say(channel, t('faceit.usage'));
    const nickname = args[0] || faceitUserStore.getNickname();
    if (!nickname) return client.say(channel, t('faceit.defaultMissing'));
    try {
      const player = await faceitApi.getPlayerElo(nickname);
      const level = player.level === null ? '' : t('faceit.level', { level: player.level });
      client.say(channel, t('faceit.elo', { game: faceitGameId.toUpperCase(), nickname: player.nickname, elo: player.elo, level }));
    } catch (error) {
      if (error.code === 'NOT_CONFIGURED') return client.say(channel, t('faceit.notConfigured'));
      if (error.code === 'NO_ELO' || error.status === 404) return client.say(channel, t('faceit.notFound', { nickname }));
      if (error.status === 401 || error.status === 403) return client.say(channel, t('faceit.authError'));
      if (error.status === 429) return client.say(channel, t('faceit.rateLimited'));
      logger.warn('FACEIT Elo lookup failed.', error.message);
      client.say(channel, t('faceit.unavailable'));
    }
  },
};
