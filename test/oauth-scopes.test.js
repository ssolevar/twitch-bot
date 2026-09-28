import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccessToken } from '../src/services/twitch-api.js';
import { resolveScopedFeatures } from '../src/utils/oauth-scopes.js';

const tokenResponse = (scopes) => Response.json({
  login: 'bot',
  user_id: 'bot-id',
  client_id: 'app-id',
  scopes,
});

test('Twitch token validation accepts the minimal chat scopes', async () => {
  const result = await validateAccessToken({
    accessToken: 'example-token',
    username: 'bot',
    clientId: 'app-id',
  }, { fetchImpl: async () => tokenResponse(['chat:read', 'chat:edit']) });

  assert.deepEqual(result.scopes, ['chat:read', 'chat:edit']);
});

test('optional Twitch scopes do not become startup requirements', async () => {
  await assert.doesNotReject(validateAccessToken({
    accessToken: 'example-token',
    username: 'bot',
    clientId: 'app-id',
    automod: { enabled: true },
  }, { fetchImpl: async () => tokenResponse(['chat:read', 'chat:edit']) }));
});

test('Twitch token validation still rejects a missing base chat scope', async () => {
  await assert.rejects(validateAccessToken({
    accessToken: 'example-token',
    username: 'bot',
    clientId: 'app-id',
  }, { fetchImpl: async () => tokenResponse(['chat:read']) }), /chat:edit/);
});

test('missing optional scopes disable only their features and log a warning', () => {
  const warnings = [];
  const features = resolveScopedFeatures({
    scopes: ['chat:read', 'chat:edit'], automodRequested: true,
    log: { warn: (message) => warnings.push(message) },
  });
  assert.equal(features.automodEnabled, false);
  assert.equal(features.pinsEnabled, false);
  assert.deepEqual([...features.available], ['chat:read', 'chat:edit']);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Pin actions disabled/u);
  assert.match(warnings[1], /AutoMod disabled/u);
});
