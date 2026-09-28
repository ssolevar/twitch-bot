import { logger } from '../utils/logger.js';

export function createPunisher({ client, config, streaks }) {
  return async (message, violation) => {
    const count = streaks.record(message.username);
    const baseTimeout = Number.isInteger(violation.timeoutSeconds) && violation.timeoutSeconds > 0
      ? violation.timeoutSeconds
      : config.timeoutSeconds;
    const seconds = Math.min(config.maxTimeoutSeconds, baseTimeout * (2 ** (count - 1)));
    await client.timeout(message.username, seconds, `AutoMod: ${violation.category}`, message.userId);
    logger.info('AutoMod action', {
      user: message.username, violation: violation.category, streak: count, timeoutSeconds: seconds,
    });
    return { count, seconds };
  };
}
