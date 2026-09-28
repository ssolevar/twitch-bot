import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpiringStore } from '../src/utils/expiring-store.js';

test('expiring store lazily removes expired custom cooldown entries', () => {
  let now = 1_000;
  const store = createExpiringStore({ now: () => now, cleanupIntervalMs: 100, cleanupEveryOperations: 2 });
  store.set('!link:alice', now + 10);
  store.set('!link:bob', now + 20);
  assert.equal(store.size, 2);
  assert.equal(store.isActive('!link:alice'), true);
  now = 1_200;
  assert.equal(store.isActive('!link:missing'), false);
  assert.equal(store.size, 0);
});
