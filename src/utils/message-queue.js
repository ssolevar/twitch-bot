export function createMessageQueue({ send, canSend = () => true, delayMs = 700, maxPending = 100, onError = () => {}, onDrop = () => {}, now = Date.now, wait: customWait } = {}) {
  if (typeof send !== 'function') throw new TypeError('Message queue requires a send function.');
  const pending = [];
  let running = false;
  let closed = false;
  let lastSentAt = 0;
  let current = null;
  let currentSendStarted = false;
  let delayTimer = null;
  let resolveDelay = null;
  let idleWaiters = [];

  function resolveIdle() {
    if (running || current || pending.length) return;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  function wait(milliseconds) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (delayTimer) clearTimeout(delayTimer);
        delayTimer = null;
        resolveDelay = null;
        resolve();
      };
      resolveDelay = finish;
      if (customWait) {
        Promise.resolve(customWait(milliseconds)).then(finish, (error) => {
          if (settled) return;
          settled = true;
          resolveDelay = null;
          reject(error);
        });
      } else {
        delayTimer = setTimeout(finish, milliseconds);
      }
    });
  }

  async function drain() {
    if (running) return;
    running = true;
    while (pending.length) {
      current = pending.shift();
      currentSendStarted = false;
      try {
        if (current.cancelled) {
          current.resolve('cancelled');
          continue;
        }
        if (!canSend(current.channel, current.message)) {
          try { onDrop(current, 'unavailable'); } catch { /* Logging must not stop the queue. */ }
          current.resolve('dropped');
          continue;
        }
        const pause = Math.max(0, lastSentAt + delayMs - now());
        if (pause) await wait(pause);
        if (current.cancelled) {
          current.resolve('cancelled');
          continue;
        }
        if (!canSend(current.channel, current.message)) {
          try { onDrop(current, 'unavailable'); } catch { /* Logging must not stop the queue. */ }
          current.resolve('dropped');
          continue;
        }
        currentSendStarted = true;
        const result = await send(current.channel, current.message);
        if (result === 'dropped') {
          try { onDrop(current, 'unavailable'); } catch { /* Logging must not stop the queue. */ }
          current.resolve('dropped');
          continue;
        }
        if (result === false) throw new Error('Twitch chat client did not send the message.');
        lastSentAt = now();
        current.resolve('sent');
      } catch (error) {
        try { onError(error, current); } catch { /* Logging must not stop the queue. */ }
        if (current.rejectOnError) current.reject(error);
        else current.resolve('failed');
      } finally {
        current = null;
        currentSendStarted = false;
      }
    }
    running = false;
    resolveIdle();
  }

  function enqueue(channel, message) {
    if (closed) return Promise.resolve('cancelled');
    if (pending.length + (current ? 1 : 0) >= maxPending) {
      try { onError(new Error('Outgoing Twitch chat queue limit reached.')); } catch { /* Logging must not stop the queue. */ }
      return Promise.resolve('dropped');
    }
    const promise = new Promise((resolve) => pending.push({ channel, message, resolve, cancelled: false }));
    void drain();
    return promise;
  }

  return {
    send: enqueue,
    sendMany(channel, message, count) {
      const available = maxPending - pending.length - (current ? 1 : 0);
      if (closed) return Promise.reject(new Error('Outgoing chat queue is closed.'));
      if (!Number.isInteger(count) || count < 1 || count > available) {
        try { onError(new Error('Outgoing Twitch chat queue limit reached.')); } catch { /* Logging must not stop the queue. */ }
        return Promise.reject(new Error('Outgoing chat queue limit reached.'));
      }
      const promises = Array.from({ length: count }, () => new Promise((resolve, reject) => pending.push({ channel, message, resolve, reject, rejectOnError: true, cancelled: false })));
      void drain();
      return Promise.all(promises);
    },
    get pendingCount() { return pending.length + (current ? 1 : 0); },
    get closed() { return closed; },
    async close({ drain: shouldDrain = true } = {}) {
      closed = true;
      if (!shouldDrain) {
        for (const task of pending.splice(0)) task.resolve('cancelled');
        if (current && !currentSendStarted) {
          current.cancelled = true;
          if (delayTimer) clearTimeout(delayTimer);
          delayTimer = null;
          const finishDelay = resolveDelay;
          resolveDelay = null;
          finishDelay?.();
        }
      }
      if (running || current || pending.length) await new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

export function createQueuedChatClient(client, messageQueue) {
  return {
    username: client.username,
    say(channel, message) { return messageQueue.send(channel, message); },
  };
}
