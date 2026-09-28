import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandHandler } from '../src/commands/handler.js';

function setup() {
  const sent = [];
  const client = { username: 'bot', say: (...args) => sent.push(args) };
  const ping = { name: 'ping', aliases: ['p'], cooldown: 1, execute: ({ client: bot, channel, user, args }) => bot.say(channel, `${user}:${args.join(',')}`) };
  const commands = new Map([['ping', ping], ['p', ping]]);
  const handler = createCommandHandler({ client, channel: 'room', prefix: '!', commands });
  return { handler, sent };
}

const message = (text, username = 'viewer') => ({ channel: 'room', username, message: text });

test('command handler parses aliases and arguments', async () => {
  const { handler, sent } = setup();
  await handler(message('!p hello world'));
  assert.deepEqual(sent, [['room', 'viewer:hello,world']]);
});

test('unknown, disabled-by-loader, other-channel, and bot commands are ignored', async () => {
  const { handler, sent } = setup();
  await handler(message('!missing'));
  await handler(message('!weather Minsk'));
  await handler({ ...message('!ping', 'bot'), username: 'bot' });
  await handler({ ...message('!ping'), channel: 'elsewhere' });
  assert.deepEqual(sent, []);
});

test('command cooldown is scoped to a user and command', async () => {
  const { handler, sent } = setup();
  await handler(message('!ping'));
  await handler(message('!ping'));
  await handler(message('!ping', 'other'));
  assert.equal(sent.length, 2);
});

test('a failing command is logged and the handler continues with later messages', async () => {
  const sent = [];
  const client = { username: 'bot', say: (...args) => sent.push(args) };
  const commands = new Map([
    ['fail', { name: 'fail', cooldown: 0, execute: async () => { throw new Error('expected failure'); } }],
    ['ok', { name: 'ok', cooldown: 0, execute: async ({ client: bot, channel }) => bot.say(channel, 'still running') }],
  ]);
  const handler = createCommandHandler({ client, channel: 'room', prefix: '!', commands });
  const originalError = console.error;
  console.error = () => {};
  try {
    await handler(message('!fail'));
    await handler(message('!ok'));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(sent, [['room', 'still running']]);
});
