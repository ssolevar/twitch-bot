import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCooldown } from '../src/utils/cooldown.js';
import { parseChatMessage } from '../src/bot/parse-message.js';
import { TwitchClient } from '../src/bot/twitch-client.js';

test('Twitch chat parser extracts channel, user, text, and moderator flags', () => {
  assert.deepEqual(parseChatMessage('@mod=1;badges=moderator/1;user-id=42 :Some_User!some_user@some_user.tmi.twitch.tv PRIVMSG #Test :!ping'), {
    username: 'some_user', channel: 'test', message: '!ping', userId: '42', isBroadcaster: false, isModerator: true,
    isSubscriber: false, isVip: false,
  });
});

test('chat parser ignores non-chat lines', () => {
  assert.equal(parseChatMessage('PING :tmi.twitch.tv'), null);
});

test('Twitch chat client sends to the configured channel and strips IRC line breaks', () => {
  const client = new TwitchClient({ username: 'bot', channel: 'room', accessToken: 'test' });
  const sent = [];
  client.socket = { readyState: 1, send: (line) => sent.push(line) };
  client.say('room', 'hello\r\nPRIVMSG #other :injected');
  client.say('other', 'should not be sent');
  assert.deepEqual(sent, ['PRIVMSG #room :hello  PRIVMSG #other :injected\r\n']);
});

test('Twitch reconnect reuses one message handler without duplicate delivery', async () => {
  const sockets = [];
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() { super(); this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.readyState = FakeWebSocket.CLOSED; this.emit('close'); }
  }
  const client = new TwitchClient({ username: 'bot', channel: 'room', accessToken: 'test', WebSocketImpl: FakeWebSocket });
  let deliveries = 0;
  client.onMessage((line) => { if (line.includes('PRIVMSG')) deliveries += 1; });
  client.connect();
  sockets[0].readyState = FakeWebSocket.OPEN;
  sockets[0].emit('open');
  sockets[0].emit('message', Buffer.from(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #room :hello\r\n'));
  client.reconnectDelay = 1;
  sockets[0].emit('close');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sockets.length, 2);
  sockets[1].readyState = FakeWebSocket.OPEN;
  sockets[1].emit('open');
  sockets[1].emit('message', Buffer.from(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #room :hello again\r\n'));
  assert.equal(deliveries, 2);
  await client.close();
});

test('cooldown expires after the configured duration', () => {
  let time = 0;
  const cooldown = createCooldown(1000, () => time);
  cooldown.start('ping:user');
  assert.equal(cooldown.isCoolingDown('ping:user'), true);
  time = 1000;
  assert.equal(cooldown.isCoolingDown('ping:user'), false);
});
