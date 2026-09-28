export function createActiveChatters({ windowMinutes = 15, botUsername = '', broadcaster = '', now = Date.now, random = Math.random } = {}) {
  const recent = new Map();
  const bot = botUsername.toLowerCase();
  const channelOwner = broadcaster.toLowerCase();

  function prune() {
    const oldest = now() - windowMinutes * 60_000;
    for (const [name, seenAt] of recent) if (seenAt < oldest) recent.delete(name);
  }

  return {
    record(message) {
      const name = message.username?.toLowerCase();
      if (!name || name === bot) return;
      recent.set(name, now());
      prune();
    },
    choose(count = 1) {
      if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Можно выбрать от 1 до 5 пользователей.');
      prune();
      const candidates = [...recent.keys()].filter((name) => name !== bot && name !== channelOwner);
      const selected = [];
      while (selected.length < count && candidates.length) {
        const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
        selected.push(candidates.splice(index, 1)[0]);
      }
      return selected;
    },
  };
}
