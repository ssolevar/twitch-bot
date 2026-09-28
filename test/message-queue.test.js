import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageQueue } from '../src/utils/message-queue.js';

test('message queue preserves FIFO order and applies its rate limit', async () => {
  const sent = [];
  const queue = createMessageQueue({ send: async (_channel, message) => sent.push({ message, at: Date.now() }), delayMs: 15 });
  const one = queue.send('room', 'one');
  const two = queue.send('room', 'two');
  const three = queue.send('room', 'three');
  assert.deepEqual(await Promise.all([one, two, three]), ['sent', 'sent', 'sent']);
  assert.deepEqual(sent.map((item) => item.message), ['one', 'two', 'three']);
  assert.ok(sent[1].at - sent[0].at >= 10);
  assert.ok(sent[2].at - sent[1].at >= 10);
  await queue.close();
});

test('message queue bounds pending sends and supports moderator repeat batches', async () => {
  const sent = [];
  let releaseFirst;
  const queue = createMessageQueue({
    send: async (_channel, text) => {
      if (text === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
      sent.push(text);
    }, delayMs: 0, maxPending: 3,
  });
  const first = queue.send('room', 'first');
  await Promise.resolve();
  const repeated = queue.sendMany('room', 'repeat', 2);
  assert.equal(queue.pendingCount, 3);
  assert.equal(await queue.send('room', 'overflow'), 'dropped');
  await assert.rejects(queue.sendMany('room', 'overflow', 1), /limit reached/u);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, repeated]), ['sent', ['sent', 'sent']]);
  assert.deepEqual(sent, ['first', 'repeat', 'repeat']);
  await queue.close();
});

test('send failures do not stop later messages', async () => {
  const sent = [];
  const errors = [];
  const queue = createMessageQueue({
    send: async (_channel, text) => { if (text === 'fail') throw new Error('offline'); sent.push(text); },
    delayMs: 0, onError: (error) => errors.push(error.message),
  });
  assert.equal(await queue.send('room', 'fail'), 'failed');
  assert.equal(await queue.send('room', 'ok'), 'sent');
  assert.deepEqual(sent, ['ok']);
  assert.deepEqual(errors, ['offline']);
  await queue.close();
});

test('close drains accepted messages by default', async () => {
  const sent = [];
  const queue = createMessageQueue({ send: async (_channel, text) => sent.push(text), delayMs: 5 });
  const accepted = [queue.send('room', 'one'), queue.send('room', 'two')];
  await queue.close();
  assert.deepEqual(await Promise.all(accepted), ['sent', 'sent']);
  assert.deepEqual(sent, ['one', 'two']);
});

test('close with drain false cancels pending work and waits only for the current send', async () => {
  let finishCurrent;
  const queue = createMessageQueue({
    send: () => new Promise((resolve) => { finishCurrent = resolve; }), delayMs: 0,
  });
  const current = queue.send('room', 'current');
  await Promise.resolve();
  const pending = queue.send('room', 'pending');
  const closing = queue.close({ drain: false });
  assert.equal(await pending, 'cancelled');
  assert.equal(await queue.send('room', 'late'), 'cancelled');
  finishCurrent();
  assert.equal(await current, 'sent');
  await closing;
  assert.equal(queue.closed, true);
});

test('close with drain false cancels a rate-limit wait promptly', async () => {
  const sent = [];
  const queue = createMessageQueue({ send: async (_channel, text) => sent.push(text), delayMs: 60_000 });
  const first = queue.send('room', 'first');
  const second = queue.send('room', 'second');
  assert.equal(await first, 'sent');
  const closing = queue.close({ drain: false });
  assert.equal(await second, 'cancelled');
  await closing;
  assert.deepEqual(sent, ['first']);
});

test('disconnect drops a message once and the queue sends new messages after reconnect', async () => {
  let connected = false;
  const sent = [];
  const dropped = [];
  const queue = createMessageQueue({
    canSend: () => connected,
    send: (_channel, message) => { sent.push(message); return 'sent'; },
    onDrop: (task) => dropped.push(task.message),
    delayMs: 0,
  });

  let disconnectedStatus;
  await assert.doesNotReject(async () => {
    disconnectedStatus = await queue.send('room', 'during-disconnect');
  });
  assert.equal(disconnectedStatus, 'dropped');
  assert.deepEqual(sent, []);
  assert.deepEqual(dropped, ['during-disconnect']);

  connected = true;
  assert.equal(await queue.send('room', 'after-reconnect'), 'sent');
  assert.deepEqual(sent, ['after-reconnect']);
  assert.deepEqual(dropped, ['during-disconnect']);
  await queue.close();
});
