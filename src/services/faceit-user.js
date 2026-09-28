import { JsonStore } from './json-store.js';

function validate(value) {
  if (!Array.isArray(value) || value.length > 1) throw new Error('Expected at most one default FACEIT player.');
  if (value.length === 0) return [];
  const nickname = value[0]?.nickname;
  if (typeof nickname !== 'string' || !nickname.trim() || nickname.length > 40 || /[\s\r\n\0]/u.test(nickname)) {
    throw new Error('Invalid default FACEIT nickname.');
  }
  return [{ nickname: nickname.trim() }];
}

export async function createFaceitUserStore(filePath, fallbackNickname = '') {
  const store = await new JsonStore(filePath, validate, 'FACEIT default player').load();
  return {
    get available() { return store.available; },
    getNickname() { return store.list()[0]?.nickname || fallbackNickname; },
    setNickname(nickname) { return store.update(() => [{ nickname }]); },
  };
}
