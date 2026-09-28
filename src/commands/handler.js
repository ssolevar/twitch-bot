import { createCooldown } from '../utils/cooldown.js';
import { logger } from '../utils/logger.js';
import { hasCommandPermission } from '../utils/permissions.js';
import { renderTemplate } from '../utils/templates.js';
import { t } from '../utils/messages.js';
import { predictionView } from '../utils/prediction-format.js';
import { createExpiringStore } from '../utils/expiring-store.js';

export function createCommandHandler({ client, channel, prefix, commands, commandOptions = {} }) {
  const cooldowns = new Map();
  const now = commandOptions.now ?? Date.now;
  const globalCustomUntil = createExpiringStore({ now });
  const userCustomUntil = createExpiringStore({ now });
  return async (message) => {
    if (message.channel !== channel || message.username === client.username) return;
    const text = message.message.trim();
    commandOptions.predictionSession?.vote(message.username, text);
    if (!text.startsWith(prefix)) return;
    const [name, ...args] = text.slice(prefix.length).trim().split(/\s+/u);
    const normalizedName = name?.toLowerCase();
    const command = commands.get(normalizedName);
    const requestedName = `${prefix}${normalizedName}`;
    const custom = !command ? commandOptions.customCommands?.resolve?.(requestedName) ??
      (commandOptions.customCommands?.get(requestedName) ? {
        name: requestedName, responses: [commandOptions.customCommands.get(requestedName)], enabled: true,
        permission: 'everyone', globalCooldown: 0, userCooldown: 5,
      } : null) : null;
    const prediction = !command && !custom ? commandOptions.predictionPresets?.get?.(`!${normalizedName}`) : null;
    if (!command && (!custom || !custom.enabled) && !prediction) return;
    if (prediction) {
      if (!prediction.enabled) return;
      const allowed = commandOptions.canModerate?.(message, channel) ?? (message.isBroadcaster || message.isModerator);
      if (!allowed) return client.say(channel, t('common.noPermission'));
      const result = commandOptions.predictionSession.start(prediction);
      if (!result.started) return client.say(channel, t('prediction.alreadyActive', { title: result.active.title }));
      return client.say(channel, t('prediction.started', predictionView(prediction)));
    }
    const commandId = command?.name ?? custom.name;
    if (command) {
      let cooldown = cooldowns.get(commandId);
      if (!cooldown) {
        cooldown = createCooldown((command.cooldown ?? 5) * 1000);
        cooldowns.set(commandId, cooldown);
      }
      const key = `${commandId}:${message.username}`;
      if (cooldown.isCoolingDown(key)) return;
      cooldown.start(key);
    } else {
      if (!hasCommandPermission(message, channel, custom.permission)) {
        client.say(channel, t('commands.noAccess'));
        return;
      }
      const currentTime = now();
      const userKey = `${commandId}:${message.username}`;
      if ((custom.globalCooldown > 0 && globalCustomUntil.isActive(commandId, currentTime)) ||
        (custom.userCooldown > 0 && userCustomUntil.isActive(userKey, currentTime))) return;
      if (custom.globalCooldown > 0) globalCustomUntil.set(commandId, currentTime + custom.globalCooldown * 1000);
      else globalCustomUntil.delete(commandId);
      if (custom.userCooldown > 0) userCustomUntil.set(userKey, currentTime + custom.userCooldown * 1000);
      else userCustomUntil.delete(userKey);
    }
    try {
      if (command) {
        await command.execute({ client, channel, user: message.username, args, message, commandName: normalizedName, commands, ...commandOptions });
      } else {
        const authorizedToRepeat = commandOptions.canModerate?.(message, channel) ?? (message.isBroadcaster || message.isModerator);
        const hasRepeatCount = authorizedToRepeat && /^\d+$/u.test(args[0] ?? '');
        const requested = hasRepeatCount ? Number(args[0]) : 1;
        const maximum = commandOptions.maxRepeat ?? 10;
        if (hasRepeatCount && requested > maximum) await client.say(channel, t('commands.tooManyRepeats', { maximum }));
        const repeat = requested > maximum ? maximum : Math.max(1, requested);
        const random = commandOptions.random?.() ?? Math.random();
        const selected = custom.responses[Math.min(custom.responses.length - 1, Math.floor(random * custom.responses.length))];
        const response = renderTemplate(selected, { user: message.username, channel });
        await commandOptions.messageQueue.sendMany(channel, response, repeat);
      }
    } catch (error) {
      logger.error(`Command !${commandId} failed.`, error.message);
    }
  };
}
