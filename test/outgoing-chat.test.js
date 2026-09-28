import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommandHandler } from '../src/commands/handler.js';
import { createAutoReplies } from '../src/services/auto-replies.js';
import { EventSubClient } from '../src/services/eventsub.js';
import { createReminders } from '../src/services/reminders.js';
import { createPredictionSession } from '../src/services/prediction-session.js';
import { createChatTimers } from '../src/services/timers.js';
import { createMessageQueue, createQueuedChatClient } from '../src/utils/message-queue.js';

test('commands, timers, reminders, auto replies, EventSub, and predictions share one chat queue', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-outgoing-chat-'));
  const sent = [];
  const queue = createMessageQueue({ send: async (channel, message) => sent.push([channel, message]), delayMs: 0 });
  const chatClient = createQueuedChatClient({ username: 'bot' }, queue);
  let now = 0;

  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() { super(); this.readyState = 0; }
    close() { this.readyState = FakeWebSocket.CLOSED; this.emit('close'); }
  }

  let eventSub;
  let timers;
  let reminders;
  try {
    const handler = createCommandHandler({
      client: chatClient, channel: 'room', prefix: '!',
      commands: new Map([['hello', {
        name: 'hello', cooldown: 0,
        execute: ({ client, channel }) => client.say(channel, 'command'),
      }]]),
      commandOptions: {
        customCommands: { get: (name) => name === '!repeat' ? 'repeated' : undefined },
        messageQueue: queue, maxRepeat: 3,
      },
    });
    await handler({ channel: 'room', username: 'viewer', message: '!hello' });
    await handler({ channel: 'room', username: 'moderator', isModerator: true, message: '!repeat 2' });

    const autoReplies = await createAutoReplies(path.join(directory, 'auto-replies.json'), {
      botUsername: 'bot', prefix: '!', channel: 'room', send: (channel, text) => chatClient.say(channel, text),
    });
    await autoReplies.add('hello', 'auto {user}');
    autoReplies.handle({ username: 'viewer', message: 'hello there' });

    timers = await createChatTimers(path.join(directory, 'timers.json'), {
      minMessages: 1, channel: 'room', now: () => now, send: (channel, text) => chatClient.say(channel, text),
    });
    reminders = await createReminders(path.join(directory, 'reminders.json'), {
      channel: 'room', now: () => now, send: (channel, text) => chatClient.say(channel, text),
    });
    await timers.add(1, 'timer');
    await reminders.add(1, 'reminder');
    timers.recordChat();
    now = 60_001;
    await timers.tick();
    await reminders.tick();

    eventSub = new EventSubClient({
      definitions: [{ type: 'channel.raid', template: 'event {user}' }],
      send: (channel, text) => chatClient.say(channel, text), channel: 'room', WebSocketImpl: FakeWebSocket,
    });
    eventSub.start();
    eventSub.socket.readyState = FakeWebSocket.OPEN;
    eventSub.socket.emit('message', Buffer.from(JSON.stringify({
      metadata: { message_type: 'notification', message_id: 'event-1' },
      payload: { subscription: { type: 'channel.raid' }, event: { from_broadcaster_user_name: 'guest' } },
    })));

    const prediction = createPredictionSession({
      onComplete: () => chatClient.say('room', 'prediction result'), now: () => now,
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
    });
    prediction.start({ option1: '1', option2: '2', title: 'Test', durationSeconds: 60 });
    prediction.finish();
    chatClient.say('room', 'system');

    await queue.close();
    assert.deepEqual(sent.map((item) => item[1]), [
      'command', 'repeated', 'repeated', 'auto viewer', 'timer', 'reminder', 'event guest', 'prediction result', 'system',
    ]);
  } finally {
    await eventSub?.close();
    await timers?.stop();
    await reminders?.stop();
    if (!queue.closed) await queue.close({ drain: false });
    await rm(directory, { recursive: true, force: true });
  }
});
