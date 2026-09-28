import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const variables = [
  'TWITCH_BOT_USERNAME', 'TWITCH_CHANNEL', 'TWITCH_CLIENT_ID', 'TWITCH_ACCESS_TOKEN',
  'ENABLE_AUTOMOD', 'ENABLE_WEATHER', 'AUTOMOD_CAPS_ENABLED', 'AUTOMOD_SPAM_ENABLED', 'WEATHER_ALLOWED_USERNAMES',
  'PIN_QUEUE_AUTO_ROTATE', 'PIN_QUEUE_INTERVAL_SECONDS',
];

test('safe feature defaults disable AutoMod and weather, while an empty weather allowlist permits everyone', () => {
  const previous = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      TWITCH_BOT_USERNAME: 'example-bot', TWITCH_CHANNEL: 'example-channel',
      TWITCH_CLIENT_ID: 'example-client-id', TWITCH_ACCESS_TOKEN: 'test-token',
    });
    for (const name of variables.slice(4)) delete process.env[name];
    const config = loadConfig();
    assert.equal(config.automod.enabled, false);
    assert.equal(config.automod.capsEnabled, false);
    assert.equal(config.automod.spamEnabled, false);
    assert.equal(config.weatherEnabled, false);
    assert.equal(config.weatherAllowedUsernames.size, 0);

    process.env.WEATHER_ALLOWED_USERNAMES = 'First,Second';
    assert.deepEqual([...loadConfig().weatherAllowedUsernames], ['first', 'second']);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
