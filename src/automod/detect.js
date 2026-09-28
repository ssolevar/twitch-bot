import { categories } from './categories.js';
import { exemptPhrases, exemptUsernames } from './exceptions.js';
import { findBlockedLink } from './links.js';
import { normalizeMessage } from './normalize.js';

function entries(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return typeof value === 'string' ? value.split(',') : [];
}

function normalizedEntries(value) {
  return entries(value).map(normalizeMessage).filter(Boolean);
}

function userInList(username, value) {
  const name = String(username ?? '').toLowerCase();
  return entries(value).some((entry) => String(entry).trim().replace(/^@/u, '').toLowerCase() === name);
}

export function isExemptMessage(message, username, config = {}) {
  if (exemptUsernames.has(String(username ?? '').toLowerCase()) || userInList(username, config.whitelistUsernames)) return true;
  if (userInList(username, config.blacklistUsernames)) return false;
  const normalized = normalizeMessage(message);
  return exemptPhrases.some((phrase) => {
    const normalizedPhrase = normalizeMessage(phrase);
    return normalizedPhrase && normalized.includes(normalizedPhrase);
  });
}

export function findViolation(message, username, categoriesConfig = categories, config = {}) {
  if (isExemptMessage(message, username, config)) return null;
  const normalized = normalizeMessage(message);

  if (userInList(username, config.blacklistUsernames)) return { type: 'blacklist', category: 'blacklist', term: username };

  let contentForWordRules = normalized;
  for (const allowed of normalizedEntries(config.whitelistWords)) {
    contentForWordRules = contentForWordRules.replaceAll(allowed, '');
  }

  const blacklisted = entries(config.blacklistWords).find((entry) => {
    const term = normalizeMessage(entry);
    return term && contentForWordRules.includes(term);
  });
  if (blacklisted) return { type: 'blacklist', category: 'blacklist', term: blacklisted };

  for (const [category, definition] of Object.entries(categoriesConfig)) {
    if (category === 'spamPhrases') continue;
    const terms = Array.isArray(definition) ? definition : definition.words;
    if (!Array.isArray(terms) || (!Array.isArray(definition) && !definition.enabled)) continue;
    const term = terms.find((entry) => {
      const normalizedTerm = normalizeMessage(entry);
      return normalizedTerm && contentForWordRules.includes(normalizedTerm);
    });
    if (term) return { type: 'word', category, term, timeoutSeconds: definition.timeoutSeconds };
  }

  if (config.linkEnabled === true) {
    const domain = findBlockedLink(message, config.linkAllowedDomains);
    if (domain) return { type: 'link', category: 'link', term: domain };
  }
  if (config.spamEnabled !== false && isSpam(message, categoriesConfig, config)) return { type: 'spam', category: 'spam' };
  if (config.capsEnabled !== false && isExcessiveCaps(message, config)) return { type: 'caps', category: 'caps' };
  return null;
}

function isSpam(message, categoriesConfig, config) {
  const text = message.trim();
  if (!text) return false;
  const repeatCount = threshold(config.spamRepeatCount, 6);
  const characterLimit = threshold(config.spamCharacterLimit, 10);
  const urlLimit = threshold(config.spamUrlLimit, 3);
  const repeated = new RegExp(`(\\S+)(?:\\s+\\1){${repeatCount - 1},}`, 'iu').test(text);
  const characterFlood = new RegExp(`(.)\\1{${characterLimit - 1},}`, 'iu').test(text);
  const links = (text.match(/https?:\/\//giu) ?? []).length >= urlLimit;
  const normalizedText = normalizeMessage(text);
  return repeated || characterFlood || links || (categoriesConfig.spamPhrases ?? []).some((phrase) => {
    const normalizedPhrase = normalizeMessage(phrase);
    return normalizedPhrase && normalizedText.includes(normalizedPhrase);
  });
}

function threshold(value, fallback) {
  return Number.isInteger(value) && value >= 2 && value <= 500 ? value : fallback;
}

function isExcessiveCaps(message, config) {
  const letters = message.match(/\p{L}/gu) ?? [];
  const capitals = message.match(/\p{Lu}/gu) ?? [];
  return letters.length >= (config.capsMinLetters ?? 12) && capitals.length / letters.length >= (config.capsRatio ?? 0.8);
}
