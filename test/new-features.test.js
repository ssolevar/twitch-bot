import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createCustomCommandStore } from '../src/services/custom-commands.js';
import { createMessageQueue, createQueuedChatClient } from '../src/utils/message-queue.js';
import { createCommandHandler } from '../src/commands/handler.js';
import pinCommand from '../src/commands/pin.js';
import pollPresetCommand from '../src/commands/pollpreset.js';
import commandManagement from '../src/commands/command-management.js';
import { loadPollPresets } from '../src/services/poll-presets.js';
import { createPinQueue, startPinRotation } from '../src/services/pin-queue.js';
import { loadCommands } from '../src/commands/loader.js';
import { TwitchClient } from '../src/bot/twitch-client.js';

test('custom commands persist atomically and reload after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-bot-'));
  const file = path.join(directory, 'commands.json');
  try {
    const store = await createCustomCommandStore(file, '!').load(new Set(['help']));
    await store.add('!hello', 'Hello chat');
    await store.edit('!hello', 'Hello again');
    const reloaded = await createCustomCommandStore(file, '!').load(new Set(['help']));
    assert.equal(reloaded.get('!hello'), 'Hello again');
    await reloaded.delete('!hello');
    assert.equal((await createCustomCommandStore(file, '!').load()).has('!hello'), false);
    await assert.rejects(store.add('!help', 'override', new Set(['help'])), /built-in command/u);
    await assert.rejects(store.add('!bad', 'one\ntwo'), /one line/u);
    const json = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(json, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing custom command JSON creates an empty runtime file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-missing-commands-'));
  const file = path.join(directory, 'commands.json');
  try {
    const store = await createCustomCommandStore(file, '!').load();
    assert.equal(store.available, true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('damaged custom command JSON disables only custom commands and stays untouched', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-damaged-commands-'));
  const file = path.join(directory, 'commands.json');
  try {
    await writeFile(file, '{ damaged', 'utf8');
    const store = await createCustomCommandStore(file, '!').load();
    assert.equal(store.available, false);
    assert.equal(store.get('!tg'), undefined);
    await assert.rejects(store.add('!tg', 'text'), /disabled/u);
    assert.equal(await readFile(file, 'utf8'), '{ damaged');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('custom command responses repeat once for viewers and clamp moderator repeats', async () => {
  const sent = [];
  const notices = [];
  const store = { get: (key) => key === '!tg' ? 'custom response' : undefined };
  const queue = createMessageQueue({ send: async (channel, text) => sent.push([channel, text]), wait: async () => {} });
  const handler = createCommandHandler({
    client: { username: 'bot', say: (...args) => notices.push(args) }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: { customCommands: store, messageQueue: queue, maxRepeat: 3 },
  });
  await handler({ channel: 'room', username: 'viewer', message: '!tg 5' });
  await handler({ channel: 'room', username: 'mod', isModerator: true, message: '!tg 5' });
  await queue.close();
  assert.equal(sent.length, 4);
  assert.deepEqual(notices, [['room', 'Слишком много повторов. Максимум: 3.']]);
  assert.ok(sent.every(([channel, text]) => channel === 'room' && text === 'custom response'));
});

test('repeat parsing is safe and clamps before work enters the outgoing queue', async () => {
  const queued = [];
  const warnings = [];
  const handler = createCommandHandler({
    client: { username: 'bot', say: (...args) => warnings.push(args) }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: {
      customCommands: { get: (name) => name === '!tg' ? 'Telegram' : undefined },
      messageQueue: { sendMany: async (_channel, _text, count) => queued.push(count) },
      maxRepeat: 10,
    },
  });
  await handler({ channel: 'room', username: 'viewer', message: '!tg 5' });
  await handler({ channel: 'room', username: 'mod-five', isModerator: true, message: '!tg 5' });
  for (const [index, value] of ['-5', '0', 'abc', '5.5'].entries()) {
    await handler({ channel: 'room', username: `mod-invalid-${index}`, isModerator: true, message: `!tg ${value}` });
  }
  await handler({ channel: 'room', username: 'mod-huge', isModerator: true, message: '!tg 999' });
  assert.deepEqual(queued, [1, 5, 1, 1, 1, 1, 10]);
  assert.deepEqual(warnings, [['room', 'Слишком много повторов. Максимум: 10.']]);
});

test('repeat limit 100 sends its warning and then all 100 allowed responses', async () => {
  const sent = [];
  const queue = createMessageQueue({
    send: (channel, text) => { sent.push([channel, text]); return 'sent'; },
    delayMs: 0,
  });
  const handler = createCommandHandler({
    client: createQueuedChatClient({ username: 'bot' }, queue), channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: {
      customCommands: { get: (name) => name === '!tg' ? 'Telegram' : undefined },
      messageQueue: queue,
      maxRepeat: 100,
    },
  });

  await handler({ channel: 'room', username: 'mod', isModerator: true, message: '!tg 999' });
  await queue.close();

  assert.equal(sent.length, 101);
  assert.match(sent[0][1], /100/u);
  assert.deepEqual(sent.slice(1), Array.from({ length: 100 }, () => ['room', 'Telegram']));
});

test('pin command requires moderator and pins the sent message using the requested duration', async () => {
  const sent = [];
  const calls = [];
  const context = {
    client: { say: (...args) => sent.push(args) }, channel: 'room', args: ['300', 'Read', 'rules'],
    twitchApi: {
      sendChatMessage: async (args) => { calls.push(['send', args]); return 'message-id'; },
      pinChatMessage: async (args) => calls.push(['pin', args]),
    }, broadcasterId: 'broadcaster-id', botUserId: 'bot-id', pinDurationSeconds: 600,
  };
  await pinCommand.execute({ ...context, message: { username: 'viewer' } });
  assert.deepEqual(calls, []);
  await pinCommand.execute({ ...context, message: { username: 'mod', isModerator: true } });
  assert.deepEqual(calls, [
    ['send', { broadcasterId: 'broadcaster-id', senderId: 'bot-id', message: 'Read rules' }],
    ['pin', { broadcasterId: 'broadcaster-id', messageId: 'message-id', durationSeconds: 300 }],
  ]);
});

test('pin command resolves saved pin presets while keeping free text behavior', async () => {
  const calls = [];
  await pinCommand.execute({
    client: { say() {} }, channel: 'room', message: { username: 'mod', isModerator: true }, args: ['tg'],
    pinQueue: { getPreset: (name) => name === 'tg' ? 'Telegram: https://t.me/example' : undefined },
    twitchApi: {
      sendChatMessage: async ({ message }) => { calls.push(message); return 'message-id'; },
      pinChatMessage: async () => {},
    }, broadcasterId: 'broadcaster-id', botUserId: 'bot-id', pinDurationSeconds: 600,
  });
  assert.deepEqual(calls, ['Telegram: https://t.me/example']);
});

test('poll preset command launches ordinary Twitch polls for moderators only', async () => {
  const calls = [];
  const context = {
    client: { say() {} }, channel: 'room', args: ['continue'],
    pollPresets: { continue: { title: 'Continue?', choices: ['Yes', 'No'], duration: 120 } },
    twitchApi: { createPoll: async (args) => calls.push(args) }, broadcasterId: 'broadcaster-id', pollsEnabled: true,
  };
  await pollPresetCommand.execute({ ...context, message: { username: 'viewer' } });
  assert.equal(calls.length, 0);
  await pollPresetCommand.execute({ ...context, message: { username: 'room', isBroadcaster: true } });
  assert.deepEqual(calls, [{ broadcasterId: 'broadcaster-id', title: 'Continue?', choices: ['Yes', 'No'], duration: 120 }]);
});

test('poll API failure is logged and returned as a short chat response', async () => {
  const sent = [];
  const command = {
    client: { say: (...args) => sent.push(args) }, channel: 'room', message: { username: 'mod', isModerator: true },
    args: ['continue'], pollPresets: { continue: { title: 'Continue?', choices: ['Yes', 'No'], duration: 120 } },
    pollsEnabled: true, broadcasterId: 'room-id',
    twitchApi: { createPoll: async () => { throw new Error('HTTP 401 technical response'); } },
  };
  await assert.doesNotReject(pollPresetCommand.execute(command));
  assert.equal(sent.length, 1);
  assert.ok(sent[0][1].length < 100);
  assert.doesNotMatch(sent[0][1], /HTTP|Error|stack/u);
});

test('chat command management is restricted to moderators and saves responses', async () => {
  const sent = [];
  const calls = [];
  const context = {
    client: { say: (...args) => sent.push(args) }, channel: 'room', args: ['!hello', 'Hello', 'there'],
    customCommands: {
      add: async (...args) => calls.push(['add', ...args]),
      edit: async (...args) => calls.push(['edit', ...args]),
      delete: async (...args) => calls.push(['delete', ...args]),
    }, commands: new Map([['help', {}]]), commandName: 'addcom',
  };
  await commandManagement.execute({ ...context, message: { username: 'viewer' } });
  assert.equal(calls.length, 0);
  await commandManagement.execute({ ...context, message: { username: 'mod', isModerator: true } });
  assert.deepEqual(calls, [['add', '!hello', 'Hello there', new Set(['help'])]]);
  assert.equal(sent[0][1], 'У вас нет прав для этой команды.');
  assert.equal(sent[1][1], '✅ Команда !hello добавлена!');
});

test('poll presets load from the checked-in example JSON file', async () => {
  const presets = await loadPollPresets(new URL('../data/polls.example.json', import.meta.url));
  assert.equal(presets.continue.title, 'Продолжаем?');
  assert.deepEqual(presets.continue.choices, ['Да', 'Нет']);
});

test('missing or damaged poll JSON uses the example file without overwriting runtime data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-poll-json-'));
  const file = path.join(directory, 'polls.json');
  const example = new URL('../data/polls.example.json', import.meta.url);
  try {
    assert.ok((await loadPollPresets(file, example)).continue);
    await writeFile(file, '', 'utf8');
    assert.ok((await loadPollPresets(file, example)).continue);
    assert.equal(await readFile(file, 'utf8'), '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pin queue persists, renumbers after removal, and only consumes a successfully pinned item', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-pins-'));
  const queuePath = path.join(directory, 'pin-queue.json');
  const presetsPath = path.join(directory, 'pins.json');
  try {
    const queue = await createPinQueue(queuePath, presetsPath);
    assert.equal(await queue.add('Telegram: https://t.me/example'), 1);
    assert.equal(await queue.add('Discord: discord.gg/example'), 2);
    await queue.remove(1);
    assert.deepEqual(queue.list(), ['Discord: discord.gg/example']);
    await assert.rejects(queue.pinNext({ pin: async () => { throw new Error('API unavailable'); } }), /API unavailable/u);
    assert.deepEqual(queue.list(), ['Discord: discord.gg/example']);
    const completed = await queue.pinNext({ pin: async () => {} });
    assert.equal(completed.remaining, 0);
    assert.deepEqual(queue.list(), []);

    await queue.addPreset('тг', 'Telegram: https://t.me/example');
    const reloaded = await createPinQueue(queuePath, presetsPath);
    assert.equal(reloaded.getPreset('тг'), 'Telegram: https://t.me/example');
    await reloaded.deletePreset('тг');
    assert.deepEqual(reloaded.listPresets(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pin queue automatic rotation cycles without removing entries and persists the cursor', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-rotate-'));
  try {
    const queue = await createPinQueue(path.join(directory, 'queue.json'), path.join(directory, 'presets.json'));
    await queue.add('first');
    await queue.add('second');
    const pinned = [];
    await queue.pinNext({ rotate: true, pin: async (text) => pinned.push(text) });
    await queue.pinNext({ rotate: true, pin: async (text) => pinned.push(text) });
    await queue.pinNext({ rotate: true, pin: async (text) => pinned.push(text) });
    assert.deepEqual(pinned, ['first', 'second', 'first']);
    assert.deepEqual(queue.list(), ['first', 'second']);
    const reloaded = await createPinQueue(path.join(directory, 'queue.json'), path.join(directory, 'presets.json'));
    await reloaded.pinNext({ rotate: true, pin: async (text) => pinned.push(text) });
    assert.equal(pinned.at(-1), 'second');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Twitch reconnects do not add another pin rotation timer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-pin-timer-'));
  const queue = await createPinQueue(path.join(directory, 'queue.json'), path.join(directory, 'presets.json'));
  const sockets = [];
  const timers = [];
  const cleared = [];
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() { super(); this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.readyState = FakeWebSocket.CLOSED; this.emit('close'); }
  }
  const client = new TwitchClient({ username: 'bot', channel: 'room', accessToken: 'test', WebSocketImpl: FakeWebSocket });
  let stopRotation;
  const startRotation = () => startPinRotation({
    pinQueue: queue, intervalSeconds: 600, pin: async () => {},
    setIntervalImpl: (callback) => { const timer = { callback, unref() {} }; timers.push(timer); return timer; },
    clearIntervalImpl: (timer) => cleared.push(timer),
  });
  client.connect();
  sockets[0].once('open', () => { stopRotation = startRotation(); });
  sockets[0].readyState = FakeWebSocket.OPEN;
  sockets[0].emit('open');
  client.reconnectDelay = 1;
  sockets[0].emit('close');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sockets.length, 2);
  sockets[1].once('open', () => { assert.equal(startRotation(), stopRotation); });
  sockets[1].readyState = FakeWebSocket.OPEN;
  sockets[1].emit('open');
  assert.equal(timers.length, 1);
  await stopRotation();
  assert.deepEqual(cleared, timers);
  await client.close();
  await rm(directory, { recursive: true, force: true });
});

test('missing and damaged pin JSON use safe defaults and preserve damaged files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-pin-json-'));
  const queuePath = path.join(directory, 'pin-queue.json');
  const pinsPath = path.join(directory, 'pins.json');
  const example = new URL('../data/pins.example.json', import.meta.url);
  try {
    const missing = await createPinQueue(queuePath, pinsPath, example);
    assert.equal(missing.queueAvailable, true);
    assert.deepEqual(missing.list(), []);
    assert.equal(missing.presetsAvailable, true);

    await writeFile(queuePath, '{ broken queue', 'utf8');
    await writeFile(pinsPath, '', 'utf8');
    const damaged = await createPinQueue(queuePath, pinsPath, example);
    assert.equal(damaged.queueAvailable, false);
    assert.equal(damaged.presetsAvailable, true);
    assert.equal(damaged.presetsWritable, false);
    assert.equal(await readFile(queuePath, 'utf8'), '{ broken queue');
    assert.equal(await readFile(pinsPath, 'utf8'), '');
    await assert.rejects(damaged.add('must not overwrite'));
    await assert.rejects(damaged.addPreset('tg', 'text'), /чтения/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('English and Russian command aliases share existing handlers', async () => {
  const commands = await loadCommands({ features: { weather: true } });
  for (const name of ['addcom', 'добком', 'editcom', 'измком', 'delcom', 'удалком', 'pin', 'пин', 'pinpreset', 'unpin', 'откреп', 'addpin', 'добавпин', 'delpin', 'удалпин', 'pins', 'пины', 'nextpin', 'следпин', 'clearpins', 'очиститьпины', 'addpinpreset', 'добавитьпинпресет', 'delpinpreset', 'pinpresets', 'пинпресеты', 'pollpreset', 'опрос', 'pollpresets', 'опросы']) {
    assert.ok(commands.has(name), `missing command alias ${name}`);
  }
});

test('both short and long add-pin aliases invoke the shared queue command', async () => {
  const commands = await loadCommands();
  const queued = [];
  const sent = [];
  const handler = createCommandHandler({
    client: { username: 'bot', say: (...args) => sent.push(args) }, channel: 'room', prefix: '!', commands,
    commandOptions: {
      pinQueue: { add: async (text) => { queued.push(text); return queued.length; } },
    },
  });
  await handler({ channel: 'room', username: 'mod-one', isModerator: true, message: '!добпин Telegram' });
  await handler({ channel: 'room', username: 'mod-two', isModerator: true, message: '!добавпин Discord' });
  assert.deepEqual(queued, ['Telegram', 'Discord']);
  assert.equal(sent[0][1], 'Закреп добавлен в очередь. Номер: 1.');
  assert.equal(sent[1][1], 'Закреп добавлен в очередь. Номер: 2.');
});
