import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

export default {
  name: 'pollpreset', aliases: ['опрос'], cooldown: 3,
  async execute({ client, channel, message, args, pollPresets, pollsEnabled, twitchApi, broadcasterId }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (!pollsEnabled) return client.say(channel, t('poll.disabled'));
    const preset = pollPresets[args[0]?.toLowerCase()];
    if (!preset || args.length !== 1) return client.say(channel, t('poll.unknownPreset', { names: Object.keys(pollPresets).join(', ') || t('common.none') }));
    try {
      await twitchApi.createPoll({ broadcasterId, ...preset });
    } catch (error) {
      logger.error('Could not start poll preset.', error.message);
      client.say(channel, t('poll.error'));
    }
  },
};
