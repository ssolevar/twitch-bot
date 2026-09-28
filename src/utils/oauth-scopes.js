export const PIN_ACTION_SCOPES = [
  'user:write:chat',
  'moderator:manage:chat_messages',
];

export function resolveScopedFeatures({ scopes = [], automodRequested = false, log = { warn() {} } } = {}) {
  const available = new Set(scopes);
  const pinsEnabled = PIN_ACTION_SCOPES.every((scope) => available.has(scope));
  if (!pinsEnabled) {
    const missing = PIN_ACTION_SCOPES.filter((scope) => !available.has(scope));
    log.warn(`Pin actions disabled: OAuth token needs ${missing.join(', ')}.`);
  }
  const automodEnabled = automodRequested && available.has('moderator:manage:banned_users');
  if (automodRequested && !automodEnabled) log.warn('AutoMod disabled: OAuth token is missing moderator:manage:banned_users.');
  return { available, pinsEnabled, automodEnabled };
}
