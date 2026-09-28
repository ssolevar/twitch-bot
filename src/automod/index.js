import { findViolation, isExemptMessage } from './detect.js';
import { createMessageHistory } from './history.js';
import { createPunisher } from './punishments.js';
import { createStreakTracker } from './streaks.js';

export function createAutoMod({ client, config }) {
  const cleanupMs = (config.streakWindowSeconds ?? 600) * 1000;
  const streaks = createStreakTracker({ windowMs: cleanupMs });
  const history = createMessageHistory(config);
  const punish = createPunisher({ client, config, streaks });
  const cleanup = setInterval(() => {
    streaks.clearExpired();
    history.clearExpired();
  }, cleanupMs);
  cleanup.unref();

  return {
    async handle(message) {
      if (!config.enabled || message.isBroadcaster ||
        (message.isModerator && config.exemptModerators !== false) ||
        (message.isVip && config.exemptVips === true) ||
        (message.isSubscriber && config.exemptSubscribers === true) ||
        isExemptMessage(message.message, message.username, config)) return null;
      const activity = config.spamEnabled === true || config.repeatEnabled === true
        ? history.record(message.username, message.message)
        : { spam: false, repeat: false };
      const violation = findViolation(message.message, message.username, undefined, config) ||
        (activity.repeat ? { type: 'repeat', category: 'repeat' } : null) ||
        (activity.spam ? { type: 'spam', category: 'spam' } : null);
      if (!violation) { streaks.reset(message.username); return null; }
      return punish(message, violation);
    },
    close() { clearInterval(cleanup); history.clear(); },
  };
}
