import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default {
  name: 'clip', aliases: ['клип'], cooldown: 30,
  async execute({ client, channel, message, args, twitchApi, broadcasterId, tokenScopes = [] }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (args.length) return client.say(channel, t('clip.usage'));
    if (!new Set(tokenScopes).has('clips:edit')) return client.say(channel, t('clip.scope'));

    try {
      const clipId = await twitchApi.createClip({ broadcasterId });
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (attempt) await sleep(1000);
        try {
          const url = await twitchApi.getClipUrl({ clipId });
          if (url) return client.say(channel, t('clip.created', { url }));
        } catch (error) {
          logger.warn(`Clip ${clipId} was created, but its public URL is not available yet.`, error.message);
          break;
        }
      }
      client.say(channel, t('clip.pending', { id: clipId }));
    } catch (error) {
      logger.warn('Could not create Twitch clip.', error.message);
      client.say(channel, t('clip.error'));
    }
  },
};
