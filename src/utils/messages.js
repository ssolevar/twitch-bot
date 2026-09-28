import catalog from '../messages.json' with { type: 'json' };

let language = 'ru';

function safeText(value) {
  let result = '';
  for (const character of String(value ?? '')) {
    const code = character.codePointAt(0);
    result += code < 32 || code === 127 ? ' ' : character;
  }
  return result;
}

export function configureLanguage(value) {
  if (value !== 'ru' && value !== 'en') throw new Error('Language must be ru or en.');
  language = value;
}

export function currentLanguage() {
  return language;
}

export function t(key, vars = {}) {
  const template = catalog[language][key] ?? catalog.ru[key];
  if (typeof template !== 'string') throw new Error(`Unknown message key: ${key}`);
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (placeholder, name) => {
    if (!Object.hasOwn(vars, name)) return placeholder;
    return safeText(vars[name]);
  });
}

export function translateKnownError(prefix, message) {
  const key = Object.keys(catalog.ru).find((candidate) =>
    candidate.startsWith(`${prefix}.`) && catalog.ru[candidate] === message);
  return key ? t(key) : String(message);
}
