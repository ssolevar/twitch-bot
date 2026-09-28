import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCustomCommandStore } from '../src/services/custom-commands.js';
import { createCommandHandler } from '../src/commands/handler.js';
import { parseChatMessage } from '../src/bot/parse-message.js';
import { hasCommandPermission } from '../src/utils/permissions.js';
import { renderTemplate } from '../src/utils/templates.js';
import { createChatTimers } from '../src/services/timers.js';
import { createAutoReplies } from '../src/services/auto-replies.js';
import { createActiveChatters } from '../src/services/active-chatters.js';
import { createReminders } from '../src/services/reminders.js';
import { createTwitchApi } from '../src/services/twitch-api.js';
import { EventSubClient, eventSubDefinitions } from '../src/services/eventsub.js';
import { loadCommands } from '../src/commands/loader.js';
import customSettings from '../src/commands/custom-settings.js';
import customList from '../src/commands/custom-list.js';
import title from '../src/commands/title.js';
import game from '../src/commands/game.js';
import { TwitchClient } from '../src/bot/twitch-client.js';
import timerManagement from '../src/commands/timer-management.js';
import autoReplyManagement from '../src/commands/auto-reply-management.js';
import reminderManagement from '../src/commands/reminder-management.js';
import randomChatter from '../src/commands/random-chatter.js';

async function inTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-release-'));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function chat(username, text, extra = {}) {
  return { channel: 'room', username, message: text, ...extra };
}

test('old string command JSON loads with defaults and migrates on the next edit', async () => inTempDir(async (directory) => {
  const file = path.join(directory, 'commands.json');
  await writeFile(file, JSON.stringify({ '!тг': 'Old link' }));
  const store = await createCustomCommandStore(file).load();
  assert.equal(store.get('!тг'), 'Old link');
  assert.deepEqual(store.resolve('!тг'), {
    name: '!тг', responses: ['Old link'], aliases: [], permission: 'everyone', enabled: true,
    globalCooldown: 0, userCooldown: 5,
  });
  await store.addAlias('!тг', '!telegram');
  assert.equal(store.get('!telegram'), 'Old link');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved['!тг'].aliases, ['!telegram']);
  assert.equal((await createCustomCommandStore(file).load()).get('!telegram'), 'Old link');
}));

test('legacy object records and aliases load without manual migration', async () => inTempDir(async (directory) => {
  const file = path.join(directory, 'commands.json');
  await writeFile(file, JSON.stringify({ name: 'тг', response: 'Telegram' }));
  const store = await createCustomCommandStore(file).load();
  assert.equal(store.get('!тг'), 'Telegram');
  await store.edit('!тг', 'New Telegram');
  assert.equal((await createCustomCommandStore(file).load()).get('!тг'), 'New Telegram');
}));

test('aliases cannot take built-in, command, or another alias name', async () => inTempDir(async (directory) => {
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load(new Set(['ping']));
  await store.add('!тг', 'Telegram');
  await store.add('!дс', 'Discord');
  await assert.rejects(store.addAlias('!тг', '!ping'), /built-in/u);
  await assert.rejects(store.addAlias('!тг', '!дс'), /already exists/u);
  await store.addAlias('!тг', '!telegram');
  await assert.rejects(store.addAlias('!дс', '!telegram'), /already exists/u);
  assert.deepEqual(store.aliases('!тг'), ['!telegram']);
  await store.deleteAlias('!telegram');
  assert.equal(store.resolve('!telegram'), null);
}));

test('subscriber and VIP permissions use separate badges; moderator and broadcaster pass both', () => {
  const subscriber = parseChatMessage('@badges=subscriber/12;subscriber=1 :sub!sub@sub.tmi.twitch.tv PRIVMSG #room :hi');
  const vip = parseChatMessage('@badges=vip/1 :vip!vip@vip.tmi.twitch.tv PRIVMSG #room :hi');
  const moderator = parseChatMessage('@mod=1;badges=moderator/1 :mod!mod@mod.tmi.twitch.tv PRIVMSG #room :hi');
  const broadcaster = chat('room', 'hi');
  assert.equal(hasCommandPermission(subscriber, 'room', 'subscriber'), true);
  assert.equal(hasCommandPermission(subscriber, 'room', 'vip'), false);
  assert.equal(hasCommandPermission(vip, 'room', 'vip'), true);
  assert.equal(hasCommandPermission(vip, 'room', 'subscriber'), false);
  for (const user of [moderator, broadcaster]) for (const permission of ['everyone', 'subscriber', 'vip', 'moderator']) {
    assert.equal(hasCommandPermission(user, 'room', permission), true);
  }
  assert.equal(hasCommandPermission(moderator, 'room', 'broadcaster'), false);
  assert.equal(hasCommandPermission(broadcaster, 'room', 'broadcaster'), true);
});

test('custom command handler gives a short denial and allows the required badge', async () => inTempDir(async (directory) => {
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load();
  await store.add('!secret', 'Allowed');
  await store.setPermission('!secret', 'subscriber');
  await store.setCooldown('!secret', 'userCooldown', 0);
  const sent = [];
  const handler = createCommandHandler({
    client: { username: 'bot', say: (_channel, text) => sent.push(text) }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: { customCommands: store, messageQueue: { sendMany: async (_channel, text) => sent.push(text) } },
  });
  await handler(chat('viewer', '!secret'));
  await handler(chat('sub', '!secret', { isSubscriber: true }));
  assert.deepEqual(sent, ['У вас нет доступа к этой команде.', 'Allowed']);
}));

test('custom response placeholders and random variants render as text only', async () => inTempDir(async (directory) => {
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load();
  await store.add('!привет', 'Привет, {user} из {channel}!');
  await store.addResponse('!привет', 'Другой ответ: {uptime}');
  await store.setCooldown('!привет', 'userCooldown', 0);
  const sent = [];
  const handler = createCommandHandler({
    client: { username: 'bot', say() {} }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: { customCommands: store, messageQueue: { sendMany: async (_channel, response) => sent.push(response) }, random: () => 0 },
  });
  await handler(chat('alice', '!привет'));
  assert.deepEqual(sent, ['Привет, alice из room!']);
  assert.equal(renderTemplate('{uptime} {unknown} {user}', { user: 'a' }, NaN), '— {unknown} a');
  const second = createCommandHandler({
    client: { username: 'bot', say() {} }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: { customCommands: store, messageQueue: { sendMany: async (_channel, response) => sent.push(response) }, random: () => 0.99 },
  });
  await second(chat('bob', '!привет'));
  assert.match(sent[1], /^Другой ответ: \d+ мин\./u);
}));

test('global and per-user custom cooldowns apply to all callers', async () => inTempDir(async (directory) => {
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load();
  await store.add('!тг', 'Telegram');
  await store.setCooldown('!тг', 'globalCooldown', 10);
  await store.setCooldown('!тг', 'userCooldown', 30);
  let now = 1000;
  const sent = [];
  const handler = createCommandHandler({
    client: { username: 'bot', say() {} }, channel: 'room', prefix: '!', commands: new Map(),
    commandOptions: { customCommands: store, now: () => now, messageQueue: { sendMany: async (_channel, response) => sent.push(response) } },
  });
  await handler(chat('alice', '!тг'));
  now += 5000;
  await handler(chat('bob', '!тг'));
  assert.equal(sent.length, 1);
  now += 6000;
  await handler(chat('bob', '!тг'));
  assert.equal(sent.length, 2);
  await handler(chat('alice', '!тг'));
  assert.equal(sent.length, 2);
  now += 20000;
  await handler(chat('alice', '!тг'));
  assert.equal(sent.length, 3);
  await store.setCooldown('!тг', 'globalCooldown', 0);
  await store.setCooldown('!тг', 'userCooldown', 0);
  await handler(chat('alice', '!тг'));
  assert.equal(sent.length, 4);
}));

test('disabled commands retain settings, and listing respects permissions', async () => inTempDir(async (directory) => {
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load();
  await store.add('!public', 'Public');
  await store.add('!vip', 'VIP');
  await store.setPermission('!vip', 'vip');
  await store.addAlias('!vip', '!special');
  const sent = [];
  customList.execute({ client: { say: (_channel, text) => sent.push(text) }, channel: 'room', message: chat('viewer', ''), customCommands: store });
  assert.match(sent[0], /!public/u);
  assert.doesNotMatch(sent[0], /!vip/u);
  assert.deepEqual(store.listAvailable(chat('vipuser', '', { isVip: true }), 'room'), ['!public', '!vip']);
  await store.setEnabled('!vip', false);
  assert.equal((await createCustomCommandStore(path.join(directory, 'commands.json')).load()).resolve('!special').enabled, false);
  assert.deepEqual(store.listAvailable(chat('vipuser', '', { isVip: true }), 'room'), ['!public']);
}));

test('custom command setting aliases route through one handler', async () => inTempDir(async (directory) => {
  const commands = await loadCommands();
  for (const name of ['добалиас', 'удалалиас', 'алиасы', 'права', 'добответ', 'ответы', 'удалответ', 'кд', 'юзеркд', 'выклком', 'вклком', 'кастомки']) assert.ok(commands.has(name), name);
  const store = await createCustomCommandStore(path.join(directory, 'commands.json')).load(new Set(commands.keys()));
  await store.add('!тг', 'Telegram');
  const sent = [];
  const base = { client: { say: (_channel, text) => sent.push(text) }, channel: 'room', message: chat('mod', '', { isModerator: true }), customCommands: store, commands };
  await customSettings.execute({ ...base, commandName: 'добалиас', args: ['!тг', '!telegram'] });
  await customSettings.execute({ ...base, commandName: 'права', args: ['!тг', 'subscriber'] });
  await customSettings.execute({ ...base, commandName: 'добответ', args: ['!тг', 'Other'] });
  await customSettings.execute({ ...base, commandName: 'кд', args: ['!тг', '10'] });
  await customSettings.execute({ ...base, commandName: 'юзеркд', args: ['!тг', '30'] });
  await customSettings.execute({ ...base, commandName: 'выклком', args: ['!тг'] });
  const record = store.resolve('!telegram');
  assert.deepEqual(record.responses, ['Telegram', 'Other']);
  assert.equal(record.permission, 'subscriber');
  assert.equal(record.globalCooldown, 10);
  assert.equal(record.userCooldown, 30);
  assert.equal(record.enabled, false);
  await customSettings.execute({ ...base, commandName: 'вклком', args: ['!тг'] });
  assert.equal(store.resolve('!тг').enabled, true);
  assert.ok(sent.every((line) => !line.includes('Не удалось')));
}));

test('chat timers require activity, persist, and start only one interval', async () => inTempDir(async (directory) => {
  let now = 0;
  const sent = [];
  const scheduled = [];
  const cleared = [];
  const file = path.join(directory, 'timers.json');
  const options = {
    now: () => now, minMessages: 5, channel: 'room', send: async (_channel, text) => sent.push(text),
    setIntervalImpl: (callback) => { const timer = { callback, unref() {} }; scheduled.push(timer); return timer; },
    clearIntervalImpl: (timer) => cleared.push(timer),
  };
  const timers = await createChatTimers(file, options);
  await timers.add(1, 'Telegram');
  const stop = timers.start();
  timers.start();
  assert.equal(scheduled.length, 1);
  for (let i = 0; i < 4; i += 1) timers.recordChat();
  now = 60_000;
  await timers.tick();
  assert.deepEqual(sent, []);
  for (let i = 0; i < 5; i += 1) timers.recordChat();
  now = 120_000;
  await timers.tick();
  assert.deepEqual(sent, ['Telegram']);
  await stop();
  assert.deepEqual(cleared, scheduled);
  const reloaded = await createChatTimers(file, options);
  assert.equal(reloaded.list()[0].intervalMinutes, 1);
  assert.equal(reloaded.list()[0].nextAt, 180_000);
  await reloaded.setEnabled(1, false);
  assert.equal((await createChatTimers(file, options)).list()[0].enabled, false);
}));

test('IRC reconnect does not create another chat timer scheduler', async () => inTempDir(async (directory) => {
  const sockets = [];
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() { super(); this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.readyState = 3; this.emit('close'); }
  }
  const intervals = [];
  const timers = await createChatTimers(path.join(directory, 'timers.json'), {
    channel: 'room', send() {}, setIntervalImpl: (callback) => {
      const timer = { callback, unref() {} }; intervals.push(timer); return timer;
    }, clearIntervalImpl() {},
  });
  const client = new TwitchClient({ username: 'bot', channel: 'room', accessToken: 'token', WebSocketImpl: FakeWebSocket });
  client.connect();
  sockets[0].on('open', () => timers.start());
  sockets[0].readyState = 1;
  sockets[0].emit('open');
  client.reconnectDelay = 1;
  sockets[0].close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  sockets[1].on('open', () => timers.start());
  sockets[1].readyState = 1;
  sockets[1].emit('open');
  assert.equal(intervals.length, 1);
  await timers.stop();
  await client.close();
}));

test('timer, auto-reply, reminder, and chatter commands are registered and restricted to moderators', async () => inTempDir(async (directory) => {
  const commands = await loadCommands();
  for (const name of ['добтаймер', 'таймеры', 'удалтаймер', 'вклтаймер', 'выклтаймер', 'добавто', 'удавто', 'автоответы', 'вклавто', 'выклавто', 'напомни', 'напоминания', 'удалнапоминание', 'рандомчат', 'title', 'название', 'game', 'игра']) assert.ok(commands.has(name), name);
  const sent = [];
  const client = { say: (_channel, text) => sent.push(text) };
  const options = { client, channel: 'room', message: chat('viewer', '') };
  const chatTimers = await createChatTimers(path.join(directory, 'timers.json'), { channel: 'room', send() {} });
  const autoReplies = await createAutoReplies(path.join(directory, 'replies.json'), { channel: 'room', send() {} });
  const reminders = await createReminders(path.join(directory, 'reminders.json'), { channel: 'room', send() {} });
  await timerManagement.execute({ ...options, chatTimers, commandName: 'добтаймер', args: ['15', 'Text'] });
  await autoReplyManagement.execute({ ...options, autoReplies, commandName: 'добавто', args: ['key', 'Text'] });
  await reminderManagement.execute({ ...options, reminders, commandName: 'напомни', args: ['10', 'Text'] });
  randomChatter.execute({ ...options, activeChatters: createActiveChatters(), args: [] });
  assert.deepEqual(sent, Array(4).fill('У вас нет прав для этой команды.'));
  assert.deepEqual(chatTimers.list(), []);
  assert.deepEqual(autoReplies.list(), []);
  assert.deepEqual(reminders.list(), []);
  await timerManagement.execute({ ...options, message: chat('mod', '', { isModerator: true }), chatTimers, commandName: 'добтаймер', args: ['15', 'Text'] });
  assert.equal(chatTimers.list().length, 1);
}));

test('keyword auto replies are case-insensitive, rate limited, and ignore the bot', async () => inTempDir(async (directory) => {
  let now = 0;
  const sent = [];
  const file = path.join(directory, 'auto-replies.json');
  const options = { now: () => now, botUsername: 'bot', prefix: '!', channel: 'room', cooldownSeconds: 30, send: (_channel, text) => sent.push(text) };
  const replies = await createAutoReplies(file, options);
  await replies.add('Дискорд', 'Ссылка для {user}');
  assert.equal(replies.handle(chat('alice', 'Где ДИСКОРД?')), true);
  replies.handle(chat('bot', 'дискорд'));
  replies.handle(chat('bob', 'дискорд'));
  replies.handle(chat('alice', '!дискорд'));
  assert.deepEqual(sent, ['Ссылка для alice']);
  now = 31_000;
  replies.handle(chat('bob', 'дискорд'));
  assert.deepEqual(sent, ['Ссылка для alice', 'Ссылка для bob']);
  await replies.setEnabled('дискорд', false);
  assert.equal((await createAutoReplies(file, options)).list()[0].enabled, false);
  await replies.remove('дискорд');
  assert.deepEqual(replies.list(), []);
}));

test('active chatter picks distinct recent users, excluding the bot and broadcaster', () => {
  let now = 0;
  const chatters = createActiveChatters({ windowMinutes: 15, botUsername: 'bot', broadcaster: 'room', now: () => now, random: () => 0 });
  for (const name of ['bot', 'room', 'alice', 'alice', 'bob', 'cara']) chatters.record(chat(name, 'hello'));
  assert.deepEqual(chatters.choose(3), ['alice', 'bob', 'cara']);
  assert.throws(() => chatters.choose(6), /1 до 5/u);
  now = 16 * 60_000;
  assert.deepEqual(chatters.choose(3), []);
});

test('reminders survive restart, send once, and skip overdue entries at startup', async () => inTempDir(async (directory) => {
  let now = 0;
  let connected = true;
  const sent = [];
  const file = path.join(directory, 'reminders.json');
  const options = { now: () => now, canSend: () => connected, channel: 'room', send: async (_channel, text) => sent.push(text) };
  const first = await createReminders(file, options);
  await first.add(1, 'Future');
  const restored = await createReminders(file, options);
  now = 60_000;
  connected = false;
  await restored.tick();
  assert.equal(restored.list().length, 1);
  connected = true;
  await restored.tick();
  await restored.tick();
  assert.deepEqual(sent, ['Future']);
  assert.deepEqual(restored.list(), []);
  await restored.add(1, 'Expired');
  now = 121_000;
  const afterRestart = await createReminders(file, options);
  assert.deepEqual(afterRestart.list(), []);
  await afterRestart.tick();
  assert.deepEqual(sent, ['Future']);
}));

test('title and game share one cached Helix channel request and handle API errors', async () => {
  let now = 0;
  let calls = 0;
  const api = createTwitchApi({ clientId: 'id', accessToken: 'token', moderatorId: 'mod', streamInfoCacheSeconds: 30, now: () => now,
    fetchImpl: async (url) => { calls += 1; assert.equal(new URL(url).pathname, '/helix/channels'); return Response.json({ data: [{ title: 'Live title', game_name: 'Game' }] }); },
  });
  const sent = [];
  const context = { client: { say: (_channel, text) => sent.push(text) }, channel: 'room', twitchApi: api, broadcasterId: '42' };
  await title.execute(context);
  await game.execute(context);
  assert.deepEqual(sent, ['Название стрима: Live title', 'Категория: Game']);
  assert.equal(calls, 1);
  now = 31_000;
  await title.execute(context);
  assert.equal(calls, 2);
  await game.execute({ ...context, twitchApi: { getChannelInformation: async () => { throw new Error('API failed'); } } });
  assert.equal(sent.at(-1), 'Не удалось получить категорию.');
});

test('Twitch API creates EventSub WebSocket subscriptions with the session ID', async () => {
  const requests = [];
  const api = createTwitchApi({ clientId: 'app', accessToken: 'token', moderatorId: 'bot', fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json({ data: [{ id: 'subscription-id' }] });
  } });
  await api.createEventSubSubscription({
    type: 'channel.follow', version: '2',
    condition: { broadcaster_user_id: 'room', moderator_user_id: 'bot' }, sessionId: 'session-1',
  });
  assert.equal(requests[0].url.pathname, '/helix/eventsub/subscriptions');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    type: 'channel.follow', version: '2', condition: { broadcaster_user_id: 'room', moderator_user_id: 'bot' },
    transport: { method: 'websocket', session_id: 'session-1' },
  });
});

test('EventSub definitions use current Twitch scopes and skip unavailable event types', () => {
  const logs = [];
  const config = { eventSub: { enabled: true, follow: true, sub: true, raid: true, followTemplate: 'F {user}', subTemplate: 'S {user}', raidTemplate: 'R {user} {viewers}' } };
  const definitions = eventSubDefinitions({ config, scopes: ['moderator:read:followers'], botUserId: 'bot', broadcasterId: 'room', log: { warn: (message) => logs.push(message) } });
  assert.deepEqual(definitions.map((item) => item.type), ['channel.follow', 'channel.raid']);
  assert.deepEqual(definitions[0].condition, { broadcaster_user_id: 'room', moderator_user_id: 'bot' });
  assert.deepEqual(definitions[1].condition, { to_broadcaster_user_id: 'room' });
  assert.equal(logs.length, 1);
  assert.deepEqual(eventSubDefinitions({ config, scopes: ['channel:read:subscriptions'], botUserId: 'room', broadcasterId: 'room', log: { warn() {} } }).map((item) => item.type), ['channel.subscribe', 'channel.raid']);
});

test('EventSub reconnect inherits subscriptions, deduplicates notifications, and resubscribes after a lost socket', async () => {
  const sockets = [];
  const timers = [];
  class FakeWebSocket extends EventEmitter {
    static CLOSED = 3;
    constructor(url) { super(); this.url = url; this.readyState = 1; sockets.push(this); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
  }
  const created = [];
  const sent = [];
  const eventSub = new EventSubClient({
    twitchApi: { createEventSubSubscription: async (request) => created.push(request) },
    definitions: [{ type: 'channel.follow', version: '2', condition: { broadcaster_user_id: 'room', moderator_user_id: 'bot' }, template: 'Follow {user}' }],
    channel: 'room', send: (_channel, text) => sent.push(text), WebSocketImpl: FakeWebSocket,
    setTimeoutImpl: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
  });
  const emit = (socket, metadata, payload) => socket.emit('message', Buffer.from(JSON.stringify({ metadata, payload })));
  eventSub.start();
  eventSub.start();
  assert.equal(sockets.length, 1);
  emit(sockets[0], { message_type: 'session_welcome' }, { session: { id: 'one', keepalive_timeout_seconds: 10 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 1);
  const notification = { subscription: { type: 'channel.follow' }, event: { user_name: 'Alice' } };
  emit(sockets[0], { message_type: 'notification', message_id: 'same' }, notification);
  emit(sockets[0], { message_type: 'notification', message_id: 'same' }, notification);
  assert.deepEqual(sent, ['Follow Alice']);
  emit(sockets[0], { message_type: 'session_reconnect' }, { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/reconnect' } });
  assert.equal(sockets.length, 2);
  emit(sockets[1], { message_type: 'session_welcome' }, { session: { id: 'two', keepalive_timeout_seconds: 10 } });
  assert.equal(created.length, 1);
  emit(sockets[1], { message_type: 'notification', message_id: 'same' }, notification);
  assert.equal(sent.length, 1);
  sockets[1].close();
  const retry = timers.find((timer) => timer.ms === 1000 && !timer.cleared);
  assert.ok(retry);
  retry.callback();
  assert.equal(sockets.length, 3);
  emit(sockets[2], { message_type: 'session_welcome' }, { session: { id: 'three', keepalive_timeout_seconds: 10 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 2);
  await eventSub.close();
  assert.equal(sockets[2].readyState, FakeWebSocket.CLOSED);
});

test('new runtime JSON files stay untouched when malformed', async () => inTempDir(async (directory) => {
  for (const [fileName, create] of [
    ['timers.json', createChatTimers], ['auto-replies.json', createAutoReplies], ['reminders.json', createReminders],
  ]) {
    const file = path.join(directory, fileName);
    await writeFile(file, '{broken');
    const service = await create(file, { send() {}, channel: 'room' });
    assert.equal(service.available, false);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  }
}));
