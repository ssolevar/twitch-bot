import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommandHandler } from '../src/commands/handler.js';
import predictionManagement from '../src/commands/prediction-management.js';
import predictionStatus from '../src/commands/prediction-status.js';
import { createCustomCommandStore } from '../src/services/custom-commands.js';
import {
  createPredictionPresetStore,
  parsePredictionDuration,
} from '../src/services/prediction-presets.js';
import { createPredictionSession } from '../src/services/prediction-session.js';
import { canModerate } from '../src/utils/permissions.js';
import { t } from '../src/utils/messages.js';

async function inTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'twitch-predictions-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function chat(username, message, extra = {}) {
  return { channel: 'room', username, message, ...extra };
}

function prediction(overrides = {}) {
  return {
    command: '!винлуз',
    option1: '1',
    option2: '2',
    title: 'Вин/Луз',
    durationSeconds: 300,
    enabled: true,
    ...overrides,
  };
}

function fakeClock(initialTime = 0) {
  let time = initialTime;
  const timers = [];
  const setTimeoutImpl = (callback, milliseconds) => {
    const timer = { callback, milliseconds, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  const clearTimeoutImpl = (timer) => {
    if (timer) timer.cleared = true;
  };
  return {
    timers,
    now: () => time,
    advance: (milliseconds) => { time += milliseconds; },
    setTimeoutImpl,
    clearTimeoutImpl,
  };
}

function testSession({ botUsername = 'bot', onComplete } = {}) {
  const clock = fakeClock();
  const completed = [];
  const session = createPredictionSession({
    botUsername,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    onComplete: onComplete ?? ((result) => completed.push(result)),
  });
  return { clock, completed, session };
}

function predictionHandler({ predictionPresets, predictionSession, sent = [] }) {
  const client = { username: 'bot', say: (_channel, text) => sent.push(text) };
  const handler = createCommandHandler({
    client,
    channel: 'room',
    prefix: '!',
    commands: new Map(),
    commandOptions: { predictionPresets, predictionSession, canModerate },
  });
  return { client, handler, sent };
}

test('!добпрог creates and persists the !винлуз preset', async () => inTempDir(async (directory) => {
  const file = path.join(directory, 'predictions.json');
  const predictionPresets = await createPredictionPresetStore(file);
  const sent = [];
  let reserved = [];
  await predictionManagement.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('mod', '', { isModerator: true }),
    args: ['!винлуз', '1', '2', 'Вин/Луз', '5'],
    commandName: 'добпрог',
    commands: new Map(),
    customCommands: {
      has: () => false,
      setRuntimeReserved: (names) => { reserved = [...names]; },
    },
    predictionPresets,
  });

  assert.deepEqual(predictionPresets.get('!винлуз'), prediction());
  assert.deepEqual(reserved, ['!винлуз']);
  assert.equal(sent.at(-1), 'Пресет прогноза !винлуз создан.');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    '!винлуз': {
      option1: '1', option2: '2', title: 'Вин/Луз', durationSeconds: 300, enabled: true,
    },
  });
}));

test('prediction duration 5 is parsed as 300 seconds', () => {
  assert.equal(parsePredictionDuration('5'), 300);
});

test('prediction duration 0.30 is parsed as 30 seconds', () => {
  assert.equal(parsePredictionDuration('0.30'), 30);
});

test('prediction duration 1.30 is parsed as 90 seconds', () => {
  assert.equal(parsePredictionDuration('1.30'), 90);
});

test('prediction duration rejects a seconds component above 59', () => {
  assert.throws(() => parsePredictionDuration('1.99'), /seconds/u);
});

test('!винлуз launches its preset and votes do not produce chat replies', async () => {
  const { clock, session } = testSession();
  const preset = prediction();
  const { handler, sent } = predictionHandler({
    predictionPresets: { get: (name) => name === '!винлуз' ? preset : null },
    predictionSession: session,
  });

  await handler(chat('mod', '!винлуз', { isModerator: true }));
  assert.equal(session.current().title, 'Вин/Луз');
  assert.equal(clock.timers[0].milliseconds, 300_000);
  assert.deepEqual(sent, ['Прогноз: Вин/Луз | 1 — Вин | 2 — Луз | Время: 5 мин.']);

  await handler(chat('alice', '1'));
  await handler(chat('bob', '2'));
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { count1: session.current().count1, count2: session.current().count2 },
    { count1: 1, count2: 1 },
  );
  session.close();
});

test('a user can vote for the first option', () => {
  const { session } = testSession();
  session.start(prediction());
  assert.equal(session.vote('alice', '1'), true);
  assert.deepEqual(
    { count1: session.current().count1, count2: session.current().count2, total: session.current().total },
    { count1: 1, count2: 0, total: 1 },
  );
  session.close();
});

test('a user can vote for the second option', () => {
  const { session } = testSession();
  session.start(prediction());
  assert.equal(session.vote('bob', '2'), true);
  assert.deepEqual(
    { count1: session.current().count1, count2: session.current().count2, total: session.current().total },
    { count1: 0, count2: 1, total: 1 },
  );
  session.close();
});

test('a later vote from the same user moves the vote instead of adding another', () => {
  const { session } = testSession();
  session.start(prediction());
  session.vote('alice', '1');
  session.vote('alice', '2');
  assert.deepEqual(
    { count1: session.current().count1, count2: session.current().count2, total: session.current().total },
    { count1: 0, count2: 1, total: 1 },
  );
  session.close();
});

test('the bot is not counted as a prediction voter', () => {
  const { session } = testSession({ botUsername: 'bot' });
  session.start(prediction());
  assert.equal(session.vote('bot', '1'), false);
  assert.equal(session.current().total, 0);
  session.close();
});

test('prediction finishes automatically when its injected timer fires', () => {
  const { clock, completed, session } = testSession();
  session.start(prediction({ durationSeconds: 30 }));
  session.vote('alice', '1');
  session.vote('bob', '1');
  session.vote('cara', '2');

  clock.timers[0].callback();

  assert.equal(session.current(), null);
  assert.equal(clock.timers[0].cleared, true);
  assert.equal(completed.length, 1);
  assert.deepEqual(
    {
      label1: completed[0].label1,
      label2: completed[0].label2,
      count1: completed[0].count1,
      count2: completed[0].count2,
      percent1: completed[0].percent1,
      percent2: completed[0].percent2,
    },
    { label1: 'Вин', label2: 'Луз', count1: 2, count2: 1, percent1: 67, percent2: 33 },
  );
});

test('!закрытьпрог immediately finishes the current prediction and reports results', () => {
  const sent = [];
  const clock = fakeClock();
  const client = { say: (_channel, text) => sent.push(text) };
  const session = createPredictionSession({
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    onComplete: (result) => client.say('room', t('prediction.finished', result)),
  });
  session.start(prediction());
  session.vote('alice', '1');
  session.vote('bob', '2');

  predictionStatus.execute({
    client, channel: 'room', message: chat('mod', '', { isModerator: true }),
    args: [], commandName: 'закрытьпрог', predictionSession: session,
  });

  assert.equal(session.current(), null);
  assert.equal(clock.timers[0].cleared, true);
  assert.deepEqual(sent, ['Прогноз завершён: Вин — 1 (50%) | Луз — 1 (50%)']);
});

test('!отменапрог stops the current prediction without reporting results', () => {
  const sent = [];
  const { clock, completed, session } = testSession();
  session.start(prediction());
  session.vote('alice', '1');

  predictionStatus.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('room', '', { isBroadcaster: true }),
    args: [],
    commandName: 'отменапрог',
    predictionSession: session,
  });

  assert.equal(session.current(), null);
  assert.equal(clock.timers[0].cleared, true);
  assert.deepEqual(completed, []);
  assert.deepEqual(sent, ['Прогноз отменён.']);
});

test('a second preset cannot start while another prediction is active', async () => {
  const { session } = testSession();
  const presets = new Map([
    ['!винлуз', prediction()],
    ['!карта', prediction({ command: '!карта', title: 'Мираж/Инферно', durationSeconds: 30 })],
  ]);
  const { handler, sent } = predictionHandler({
    predictionPresets: { get: (name) => presets.get(name) ?? null },
    predictionSession: session,
  });

  await handler(chat('first-mod', '!винлуз', { isModerator: true }));
  await handler(chat('second-mod', '!карта', { isModerator: true }));

  assert.equal(session.current().title, 'Вин/Луз');
  assert.equal(sent.at(-1), 'Уже идёт прогноз: Вин/Луз');
  session.close();
});

test('prediction preset names cannot use built-ins, aliases, custom commands, or custom aliases', async () => inTempDir(async (directory) => {
  const predictionPresets = await createPredictionPresetStore(path.join(directory, 'predictions.json'));
  const customCommands = await createCustomCommandStore(path.join(directory, 'commands.json')).load();
  await customCommands.add('!тг', 'Telegram');
  await customCommands.addAlias('!тг', '!telegram');
  const commands = new Map([['ping', {}], ['п', {}]]);
  const sent = [];
  const context = {
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('mod', '', { isModerator: true }),
    commandName: 'добпрог',
    commands,
    customCommands,
    predictionPresets,
  };

  for (const name of ['!ping', '!п', '!тг', '!telegram']) {
    await predictionManagement.execute({ ...context, args: [name, '1', '2', 'Да/Нет', '5'] });
  }

  assert.deepEqual(predictionPresets.listCommands(), []);
  assert.deepEqual(sent, [
    'Команда !ping уже занята.',
    'Команда !п уже занята.',
    'Команда !тг уже занята.',
    'Команда !telegram уже занята.',
  ]);
}));

test('!измпрог updates a saved preset', async () => inTempDir(async (directory) => {
  const predictionPresets = await createPredictionPresetStore(path.join(directory, 'predictions.json'));
  await predictionPresets.add('!винлуз', prediction());
  const sent = [];

  await predictionManagement.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('mod', '', { isModerator: true }),
    args: ['!винлуз', 'да', 'нет', 'Новая', 'победа/Новый', 'луз', '1.30'],
    commandName: 'измпрог',
    commands: new Map(),
    customCommands: { has: () => false },
    predictionPresets,
  });

  assert.deepEqual(predictionPresets.get('!винлуз'), {
    command: '!винлуз', option1: 'да', option2: 'нет', title: 'Новая победа/Новый луз',
    durationSeconds: 90, enabled: true,
  });
  assert.equal(sent.at(-1), 'Пресет прогноза !винлуз изменён.');
}));

test('!удалпрог removes a saved preset', async () => inTempDir(async (directory) => {
  const predictionPresets = await createPredictionPresetStore(path.join(directory, 'predictions.json'));
  await predictionPresets.add('!винлуз', prediction());
  const sent = [];
  let reserved = ['!винлуз'];

  await predictionManagement.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('mod', '', { isModerator: true }),
    args: ['!винлуз'],
    commandName: 'удалпрог',
    commands: new Map(),
    customCommands: { setRuntimeReserved: (names) => { reserved = [...names]; } },
    predictionPresets,
  });

  assert.equal(predictionPresets.has('!винлуз'), false);
  assert.deepEqual(reserved, []);
  assert.deepEqual(sent, ['Пресет прогноза !винлуз удалён.']);
}));

test('!проги lists the saved preset commands', async () => inTempDir(async (directory) => {
  const predictionPresets = await createPredictionPresetStore(path.join(directory, 'predictions.json'));
  await predictionPresets.add('!винлуз', prediction());
  await predictionPresets.add('!карта', prediction({ title: 'Мираж/Инферно', durationSeconds: 30 }));
  await predictionPresets.add('!победа', prediction({ title: 'Победа/Поражение' }));
  const sent = [];

  await predictionManagement.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('viewer', ''),
    args: [],
    commandName: 'проги',
    commands: new Map(),
    customCommands: null,
    predictionPresets,
  });

  assert.deepEqual(sent, ['Прогнозы: !винлуз, !карта, !победа']);
}));

test('!прог reports the current prediction and remaining time', () => {
  const sent = [];
  const { clock, session } = testSession();
  session.start(prediction());
  clock.advance(166_000);

  predictionStatus.execute({
    client: { say: (_channel, text) => sent.push(text) },
    channel: 'room',
    message: chat('viewer', ''),
    args: [],
    commandName: 'прог',
    predictionSession: session,
  });

  assert.deepEqual(sent, ['Сейчас: Вин/Луз | 1 — Вин | 2 — Луз | осталось 2:14']);
  session.close();
});

test('prediction management and control permissions allow moderators and broadcaster only', async () => inTempDir(async (directory) => {
  const predictionPresets = await createPredictionPresetStore(path.join(directory, 'predictions.json'));
  const sent = [];
  const client = { username: 'bot', say: (_channel, text) => sent.push(text) };
  const customCommands = { has: () => false, setRuntimeReserved() {} };
  const management = (message, commandName, args) => predictionManagement.execute({
    client, channel: 'room', message, commandName, args,
    commands: new Map(), customCommands, predictionPresets,
  });

  await management(chat('viewer', ''), 'добпрог', ['!viewer', '1', '2', 'Да/Нет', '5']);
  assert.equal(predictionPresets.has('!viewer'), false);

  await management(chat('mod', '', { isModerator: true }), 'добпрог', ['!modpred', '1', '2', 'Вин/Луз', '5']);
  await management(chat('room', ''), 'добпрог', ['!ownerpred', '1', '2', 'Да/Нет', '5']);
  assert.equal(predictionPresets.has('!modpred'), true);
  assert.equal(predictionPresets.has('!ownerpred'), true);

  await management(chat('viewer', ''), 'измпрог', ['!modpred', '1', '2', 'Изменено/Нет', '5']);
  await management(chat('viewer', ''), 'удалпрог', ['!ownerpred']);
  assert.equal(predictionPresets.get('!modpred').title, 'Вин/Луз');
  assert.equal(predictionPresets.has('!ownerpred'), true);

  const { session } = testSession();
  const { handler } = predictionHandler({ predictionPresets, predictionSession: session, sent });
  await handler(chat('viewer', '!modpred'));
  assert.equal(session.current(), null);
  await handler(chat('mod', '!modpred', { isModerator: true }));
  assert.equal(session.current().title, 'Вин/Луз');

  predictionStatus.execute({
    client, channel: 'room', message: chat('viewer', ''), args: [],
    commandName: 'закрытьпрог', predictionSession: session,
  });
  predictionStatus.execute({
    client, channel: 'room', message: chat('viewer', ''), args: [],
    commandName: 'отменапрог', predictionSession: session,
  });
  assert.notEqual(session.current(), null);

  predictionStatus.execute({
    client, channel: 'room', message: chat('room', ''), args: [],
    commandName: 'закрытьпрог', predictionSession: session,
  });
  assert.equal(session.current(), null);

  await handler(chat('room', '!ownerpred'));
  assert.equal(session.current().title, 'Да/Нет');
  predictionStatus.execute({
    client, channel: 'room', message: chat('mod', '', { isModerator: true }), args: [],
    commandName: 'отменапрог', predictionSession: session,
  });
  assert.equal(session.current(), null);

  assert.equal(sent.filter((text) => text === 'У вас нет прав для этой команды.').length, 6);
}));

test('active prediction state is not restored after a restart', () => {
  const first = testSession();
  first.session.start(prediction());
  first.session.vote('alice', '1');

  const restarted = testSession();
  assert.equal(restarted.session.current(), null);
  first.session.close();
});
