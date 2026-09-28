export function createCooldown(durationMs, now = Date.now) {
  const timestamps = new Map();
  return {
    isCoolingDown(key) {
      const last = timestamps.get(key);
      if (last === undefined) return false;
      if (now() - last >= durationMs) {
        timestamps.delete(key);
        return false;
      }
      return true;
    },
    start(key) {
      const time = now();
      for (const [storedKey, started] of timestamps) {
        if (time - started >= durationMs) timestamps.delete(storedKey);
      }
      timestamps.set(key, time);
    },
    clear(key) { timestamps.delete(key); },
  };
}
