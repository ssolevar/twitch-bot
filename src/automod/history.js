import { normalizeMessage } from './normalize.js';

function positiveInteger(value, fallback, maximum) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

export function createMessageHistory(config = {}, { now = Date.now } = {}) {
  const spamWindowMs = positiveInteger(config.spamWindowSeconds, 10, 3600) * 1000;
  const repeatWindowMs = positiveInteger(config.repeatWindowSeconds, 60, 3600) * 1000;
  const spamMessageLimit = positiveInteger(config.spamMessageLimit, 6, 100);
  const repeatMessageLimit = positiveInteger(config.repeatMessageLimit, 3, 100);
  const repeatMinLength = positiveInteger(config.repeatMinLength, 8, 500);
  const maxWindowMs = Math.max(spamWindowMs, repeatWindowMs);
  const users = new Map();

  return {
    record(username, message) {
      const key = String(username ?? '').toLowerCase();
      const time = now();
      const normalized = normalizeMessage(message);
      const previous = users.get(key) ?? [];
      const recent = previous.filter((entry) => time - entry.time < maxWindowMs);
      recent.push({ time, normalized });
      if (recent.length > 100) recent.splice(0, recent.length - 100);
      users.delete(key);
      users.set(key, recent);
      if (users.size > 10_000) users.delete(users.keys().next().value);

      const spamCount = recent.filter((entry) => time - entry.time < spamWindowMs).length;
      const repeatCount = Array.from(normalized).length >= repeatMinLength
        ? recent.filter((entry) => entry.normalized === normalized && time - entry.time < repeatWindowMs).length
        : 0;
      return {
        spam: config.spamEnabled === true && spamCount >= spamMessageLimit,
        repeat: config.repeatEnabled === true && repeatCount >= repeatMessageLimit,
      };
    },
    clearExpired() {
      const cutoff = now() - maxWindowMs;
      for (const [username, records] of users) {
        const recent = records.filter((entry) => entry.time >= cutoff);
        if (recent.length) users.set(username, recent);
        else users.delete(username);
      }
    },
    clear() { users.clear(); },
  };
}
