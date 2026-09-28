import { canModerate } from '../utils/permissions.js';
import { t } from '../utils/messages.js';

export default {
  name: 'рандомчат', aliases: ['randomchatter'], cooldown: 5,
  execute({ client, channel, message, args, activeChatters }) {
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    const count = args.length ? Number(args[0]) : 1;
    try {
      if (args.length > 1) return client.say(channel, t('random.oneNumber'));
      const selected = activeChatters.choose(count);
      client.say(channel, selected.length ? t('random.selected', { names: selected.map((name) => `@${name}`).join(', ') }) : t('random.empty'));
    } catch {
      client.say(channel, t('random.invalidCount'));
    }
  },
};
