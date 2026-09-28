const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createMessageQueue({ send, delayMs = 700, maxPending = 100, wait = sleep }) {
  const pending = [];
  let running = false;
  let closed = false;
  let lastSentAt = 0;
  let idleWaiters = [];

  async function drain() {
    if (running) return;
    running = true;
    while (pending.length) {
      const task = pending.shift();
      try {
        const pause = Math.max(0, lastSentAt + delayMs - Date.now());
        if (pause) await wait(pause);
        await send(task.channel, task.message);
        lastSentAt = Date.now();
        task.resolve();
      } catch (error) {
        task.reject(error);
      }
    }
    running = false;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  return {
    sendMany(channel, message, count) {
      if (closed) return Promise.reject(new Error('Outgoing chat queue is closed.'));
      if (!Number.isInteger(count) || count < 1 || count > maxPending || pending.length + count > maxPending) {
        return Promise.reject(new Error('Outgoing chat queue limit reached.'));
      }
      const promises = Array.from({ length: count }, () => new Promise((resolve, reject) => pending.push({ channel, message, resolve, reject })));
      void drain();
      return Promise.all(promises);
    },
    async close() {
      closed = true;
      if (running || pending.length) await new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
