import { canModerate } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/messages.js';
import { parsePredictionDuration } from '../services/prediction-presets.js';

const actions = new Map([
  ['addprediction', 'add'], ['добпрог', 'add'],
  ['editprediction', 'edit'], ['измпрог', 'edit'],
  ['delprediction', 'delete'], ['удалпрог', 'delete'],
  ['predictions', 'list'], ['проги', 'list'],
]);

function usage(client, channel, action) {
  client.say(channel, t(action === 'delete' ? 'prediction.deleteUsage' : 'prediction.manageUsage'));
}

function parsePreset(args) {
  if (args.length < 5) throw new Error('USAGE');
  const [command, option1, option2, ...tail] = args;
  const durationText = tail.pop();
  const title = tail.join(' ').trim();
  if (!title) throw new Error('USAGE');
  return {
    command,
    preset: { option1, option2, title, durationSeconds: parsePredictionDuration(durationText), enabled: true },
  };
}

export default {
  name: 'addprediction', aliases: [...actions.keys()].filter((name) => name !== 'addprediction'), cooldown: 0,
  async execute({ client, channel, message, args, commandName, commands, customCommands, predictionPresets }) {
    const action = actions.get(commandName);
    if (action === 'list') {
      if (!predictionPresets.available) return client.say(channel, t('prediction.storageUnavailable'));
      const names = predictionPresets.listCommands();
      return client.say(channel, names.length
        ? t('prediction.list', { names: names.join(', ') }).slice(0, 450)
        : t('prediction.listEmpty'));
    }
    if (!canModerate(message, channel)) return client.say(channel, t('common.noPermission'));
    if (action === 'delete') {
      if (args.length !== 1) return usage(client, channel, action);
      try {
        const removed = await predictionPresets.remove(args[0]);
        customCommands?.setRuntimeReserved?.(predictionPresets.listCommands());
        return client.say(channel, t('prediction.deleted', { command: removed.command }));
      } catch (error) {
        logger.warn('Could not delete prediction preset.', error.message);
        if (error.message.includes('does not exist')) return client.say(channel, t('prediction.missing'));
        if (error.message.includes('disabled')) return client.say(channel, t('prediction.storageUnavailable'));
        return client.say(channel, t('prediction.manageError'));
      }
    }

    let parsed;
    try {
      parsed = parsePreset(args);
    } catch (error) {
      if (error.message === 'USAGE') return usage(client, channel, action);
      if (error.message.includes('time') || error.message.includes('seconds')) {
        return client.say(channel, t('prediction.invalidTime'));
      }
      return client.say(channel, t('prediction.invalidPreset'));
    }
    try {
      let saved;
      if (action === 'add') {
        saved = await predictionPresets.add(parsed.command, parsed.preset, {
          occupied: (name) => commands.has(name.slice(1))
            || customCommands?.has?.(`${customCommands.prefix ?? '!'}${name.slice(1)}`),
        });
        customCommands?.setRuntimeReserved?.(predictionPresets.listCommands());
      } else saved = await predictionPresets.update(parsed.command, parsed.preset);
      client.say(channel, t(action === 'add' ? 'prediction.added' : 'prediction.updated', { command: saved.command }));
    } catch (error) {
      logger.warn(`Could not ${action} prediction preset.`, error.message);
      if (error.message.includes('already reserved') || error.message.includes('already exists')) {
        return client.say(channel, t('prediction.commandOccupied', { command: String(parsed.command).toLowerCase() }));
      }
      if (error.message.includes('does not exist')) return client.say(channel, t('prediction.missing'));
      if (error.message.includes('duration') || error.message.includes('time') || error.message.includes('seconds')) {
        return client.say(channel, t('prediction.invalidTime'));
      }
      if (error.message.includes('disabled')) return client.say(channel, t('prediction.storageUnavailable'));
      if (error.message.includes('Prediction command') || error.message.includes('option') || error.message.includes('title')) {
        return client.say(channel, t('prediction.invalidPreset'));
      }
      client.say(channel, t('prediction.manageError'));
    }
  },
};

export { parsePreset };
