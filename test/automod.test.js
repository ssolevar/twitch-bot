import test from 'node:test';
import assert from 'node:assert/strict';
import { findViolation } from '../src/automod/detect.js';
import { exemptPhrases, exemptUsernames } from '../src/automod/exceptions.js';
import { normalizeMessage } from '../src/automod/normalize.js';
import { createStreakTracker } from '../src/automod/streaks.js';
import { createPunisher } from '../src/automod/punishments.js';
import { createAutoMod } from '../src/automod/index.js';

test('normalization removes spaces, repeated letters, zero-width and common confusables', () => {
  assert.equal(normalizeMessage('B A D\u200B wooooord'), normalizeMessage('badword'));
});

test('word detection uses normalized matching and allows configured exemptions', () => {
  assert.equal(findViolation('b a d w o r d', 'viewer', { blocked: ['badword'] })?.category, 'blocked');
  assert.equal(findViolation('BADWORD', 'viewer', { blocked: ['badword'] })?.category, 'blocked');
  exemptUsernames.add('trusted');
  assert.equal(findViolation('badword', 'trusted', { blocked: ['badword'] }), null);
  exemptUsernames.delete('trusted');
  exemptPhrases.push('safe exception');
  assert.equal(findViolation('this contains safe-exception text', 'viewer', { blocked: ['safe'] }), null);
  exemptPhrases.pop();
});

test('disabled word categories are ignored and enabled categories can override timeout', () => {
  assert.equal(findViolation('badword', 'viewer', { sample: { enabled: false, words: ['badword'] } }), null);
  const violation = findViolation('badword', 'viewer', { sample: { enabled: true, timeoutSeconds: 15, words: ['badword'] } });
  assert.equal(violation.category, 'sample');
  assert.equal(violation.timeoutSeconds, 15);
});

test('spam and caps are detected independently from word categories', () => {
  assert.equal(findViolation('buy now https://one.test https://two.test https://three.test', 'viewer')?.type, 'spam');
  assert.equal(findViolation('THIS IS AN EXTREMELY LOUD MESSAGE', 'viewer')?.type, 'caps');
});

test('spam phrase rules match normalized text and ignore blank entries', () => {
  assert.equal(findViolation('ordinary chat', 'viewer', { spamPhrases: [''] })?.type, undefined);
  assert.equal(findViolation('this is a forbidden phrase', 'viewer', { spamPhrases: ['forbidden phrase'] })?.type, 'spam');
});

test('spam and caps checks can be disabled and thresholds avoid short-message false positives', () => {
  assert.equal(findViolation('THIS IS LOUD', 'viewer')?.type, undefined);
  assert.equal(findViolation('HELLO WORLD THIS IS A VERY LOUD SHOUT', 'viewer', undefined, { capsEnabled: false }), null);
  assert.equal(findViolation('one two one two one two one two one two one two', 'viewer', undefined, { spamEnabled: false }), null);
});

test('violation streak grows within its window and resets after expiry', () => {
  let time = 1000;
  const streaks = createStreakTracker({ windowMs: 500, now: () => time });
  assert.equal(streaks.record('viewer'), 1);
  time += 400;
  assert.equal(streaks.record('viewer'), 2);
  time += 600;
  assert.equal(streaks.record('viewer'), 1);
  streaks.reset('viewer');
  assert.equal(streaks.record('viewer'), 1);
});

test('punishment escalates timeouts, applies category overrides, and respects the maximum', () => {
  const timeouts = [];
  const streaks = createStreakTracker({ windowMs: 60_000, now: () => 1000 });
  const punish = createPunisher({
    client: { timeout: (...args) => timeouts.push(args) },
    config: { timeoutSeconds: 60, maxTimeoutSeconds: 180 }, streaks,
  });
  const message = { username: 'viewer' };
  punish(message, { category: 'spam' });
  punish(message, { category: 'spam' });
  punish(message, { category: 'custom', timeoutSeconds: 20 });
  punish(message, { category: 'spam' });
  punish(message, { category: 'spam' });
  assert.deepEqual(timeouts.map(([, seconds]) => seconds), [60, 120, 80, 180, 180]);
});

test('AutoMod resets a user streak after a clean message', () => {
  const timeouts = [];
  const automod = createAutoMod({
    client: { timeout: (...args) => timeouts.push(args) },
    config: { enabled: true, timeoutSeconds: 30, streakWindowSeconds: 60, maxTimeoutSeconds: 240, capsEnabled: false, spamEnabled: true },
  });
  const message = (text) => ({ username: 'viewer', message: text, isModerator: false, isBroadcaster: false });
  automod.handle(message('spam '.repeat(6)));
  automod.handle(message('spam '.repeat(6)));
  automod.handle(message('ordinary chat'));
  automod.handle(message('spam '.repeat(6)));
  automod.close();
  assert.deepEqual(timeouts.map(([, seconds]) => seconds), [30, 60, 30]);
});
