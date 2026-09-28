import { canModerate } from '../utils/permissions.js';
import { t } from '../utils/messages.js';
import { formatRemaining } from '../utils/prediction-format.js';

const actions = new Map([
  ['prediction', 'status'], ['прог', 'status'],
  ['closeprediction', 'close'], ['закрытьпрог', 'close'],
  ['cancelprediction', 'cancel'], ['отменапрог', 'cancel'],
]);

export default {
  name: 'prediction', aliases: [...actions.keys()].filter((name) => name !== 'prediction'), cooldown: 0,
  execute({ client, channel, message, args, commandName, predictionSession }) {
    const action = actions.get(commandName);
    if (args.length) return client.say(channel, t('prediction.controlUsage', { command: commandName }));
    if (action === 'status') {
      const active = predictionSession.current();
      if (!active) return client.say(channel, t('prediction.noneActive'));
      return client.say(channel, t('prediction.current', {
        ...active, remaining: formatRemaining(active.remainingSeconds),
      }));
    }
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (action === 'close') {
      if (!predictionSession.finish()) return client.say(channel, t('prediction.noneActive'));
      return;
    }
    if (!predictionSession.cancel()) return client.say(channel, t('prediction.noneActive'));
    client.say(channel, t('prediction.cancelled'));
  },
};
