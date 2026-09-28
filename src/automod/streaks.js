export function createStreakTracker({ windowMs, now = Date.now }) {
  const users = new Map();
  return {
    record(username) {
      const time = now();
      const previous = users.get(username);
      const count = previous && time - previous.time <= windowMs ? previous.count + 1 : 1;
      users.set(username, { count, time });
      return count;
    },
    reset(username) { users.delete(username); },
    clearExpired() {
      const cutoff = now() - windowMs;
      for (const [username, value] of users) if (value.time < cutoff) users.delete(username);
    },
  };
}
