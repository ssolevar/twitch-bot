import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { hasCommandPermission } from '../utils/permissions.js';
import { writeJsonAtomic } from './json-store.js';

const MAX_RESPONSE_LENGTH = 450;
const PERMISSIONS = new Set(['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster']);

function commandKey(value, prefix, allowBare = false) {
  const input = String(value ?? '').trim().toLowerCase();
  const name = allowBare && !input.startsWith(prefix) ? `${prefix}${input}` : input;
  const part = name.startsWith(prefix) ? name.slice(prefix.length) : '';
  if (!part || !/^[\p{L}\p{N}_]{1,24}$/u.test(part)) {
    throw new Error(`Command name must start with ${prefix} and contain 1-24 letters, numbers, or underscores.`);
  }
  return name;
}

function responseText(value) {
  if (typeof value !== 'string') throw new Error('Response must be a string.');
  const response = value.trim();
  if (!response || response.length > MAX_RESPONSE_LENGTH || /[\r\n\0]/u.test(response)) {
    throw new Error(`Response must contain 1-${MAX_RESPONSE_LENGTH} characters on one line.`);
  }
  return response;
}

function cooldownSeconds(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 3600) throw new Error('Cooldown must be 0-3600 seconds.');
  return number;
}

function normalizeRecord(value, prefix) {
  const source = typeof value === 'string' ? { response: value } : value;
  if (!source || Array.isArray(source) || typeof source !== 'object') throw new Error('Invalid custom command record.');
  const responses = source.responses ?? (source.response === undefined ? [] : [source.response]);
  if (!Array.isArray(responses) || responses.length < 1 || responses.length > 20) throw new Error('A command needs 1-20 responses.');
  const aliases = source.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.length > 20) throw new Error('A command may have at most 20 aliases.');
  const permission = source.permission ?? 'everyone';
  if (!PERMISSIONS.has(permission)) throw new Error(`Invalid command permission: ${permission}.`);
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') throw new Error('Command enabled must be boolean.');
  return {
    responses: responses.map(responseText),
    aliases: aliases.map((alias) => {
      if (typeof alias !== 'string') throw new Error('Alias must be a string.');
      return commandKey(alias, prefix, true);
    }),
    permission,
    enabled: source.enabled ?? true,
    globalCooldown: cooldownSeconds(source.globalCooldown, 0),
    userCooldown: cooldownSeconds(source.userCooldown, 5),
  };
}

export class CustomCommandStore {
  constructor(filePath, prefix = '!') {
    this.filePath = filePath;
    this.importFilePath = path.join(path.dirname(filePath), 'commands.import.json');
    this.exportFilePath = path.join(path.dirname(filePath), 'commands.export.json');
    this.prefix = prefix;
    this.commands = new Map();
    this.aliasesByName = new Map();
    this.reserved = new Set();
    this.runtimeReserved = new Set();
    this.mutation = Promise.resolve();
    this.available = true;
  }

  async load(reserved = new Set()) {
    this.reserved = new Set(reserved);
    let content;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') return this.#disable(error);
      try {
        await writeJsonAtomic(this.filePath, {});
        content = '{}';
      } catch (writeError) {
        return this.#disable(writeError);
      }
    }
    try {
      this.commands = this.#parseContent(content);
      this.#rebuildAliases();
      this.available = true;
    } catch (error) {
      return this.#disable(error);
    }
    return this;
  }

  has(name) { return Boolean(this.resolve(name)); }
  get(name) { return this.resolve(name)?.responses[0]; }
  entries() { return [...this.commands].map(([name, record]) => [name, record.responses[0]]); }

  setRuntimeReserved(names = []) {
    const previous = this.runtimeReserved;
    this.runtimeReserved = new Set([...names].map((name) => {
      const input = String(name ?? '').trim().toLowerCase();
      const bare = input.startsWith(this.prefix) ? input.slice(this.prefix.length) : input.replace(/^!/u, '');
      return commandKey(`${this.prefix}${bare}`, this.prefix).slice(this.prefix.length);
    }));
    try {
      this.#checkNames(this.commands);
    } catch (error) {
      this.runtimeReserved = previous;
      throw error;
    }
  }

  resolve(name) {
    const input = String(name ?? '').toLowerCase();
    const key = this.aliasesByName.get(input) ?? input;
    const record = this.commands.get(key);
    return record ? { name: key, ...structuredClone(record) } : null;
  }

  listAvailable(message, channel) {
    return [...this.commands].filter(([, record]) => record.enabled && hasCommandPermission(message, channel, record.permission))
      .map(([name]) => name);
  }

  add(name, response, reserved = new Set()) {
    return this.#change((next) => {
      const key = commandKey(name, this.prefix);
      this.#requireFreeName(key, reserved);
      next.set(key, normalizeRecord(responseText(response), this.prefix));
    });
  }

  edit(name, response) {
    return this.#change((next) => {
      const key = this.#requireCommand(name);
      next.get(key).responses[0] = responseText(response);
    });
  }

  delete(name) {
    return this.#change((next) => next.delete(this.#requireCommand(name)));
  }

  addAlias(name, alias, reserved = new Set()) {
    return this.#change((next) => {
      const key = this.#requireCommand(name);
      const aliasKey = commandKey(alias, this.prefix);
      this.#requireFreeName(aliasKey, reserved);
      next.get(key).aliases.push(aliasKey);
    });
  }

  deleteAlias(alias) {
    return this.#change((next) => {
      const aliasKey = commandKey(alias, this.prefix);
      const key = this.aliasesByName.get(aliasKey);
      if (!key) throw new Error(`Alias ${aliasKey} does not exist.`);
      next.get(key).aliases = next.get(key).aliases.filter((value) => value !== aliasKey);
    });
  }

  aliases(name) { return this.resolve(name)?.aliases ?? null; }

  setPermission(name, permission) {
    return this.#change((next) => {
      if (!PERMISSIONS.has(permission)) throw new Error('Permission must be everyone, subscriber, vip, moderator, or broadcaster.');
      next.get(this.#requireCommand(name)).permission = permission;
    });
  }

  addResponse(name, response) {
    return this.#change((next) => {
      const responses = next.get(this.#requireCommand(name)).responses;
      if (responses.length >= 20) throw new Error('A command may have at most 20 responses.');
      responses.push(responseText(response));
    });
  }

  responses(name) { return this.resolve(name)?.responses ?? null; }

  deleteResponse(name, position) {
    return this.#change((next) => {
      const responses = next.get(this.#requireCommand(name)).responses;
      if (!Number.isInteger(position) || position < 1 || position > responses.length) throw new Error('Response number does not exist.');
      if (responses.length === 1) throw new Error('A command needs at least one response.');
      responses.splice(position - 1, 1);
    });
  }

  setCooldown(name, kind, seconds) {
    return this.#change((next) => {
      const value = cooldownSeconds(seconds, 0);
      if (kind !== 'globalCooldown' && kind !== 'userCooldown') throw new Error('Unknown cooldown type.');
      next.get(this.#requireCommand(name))[kind] = value;
    });
  }

  setEnabled(name, enabled) {
    return this.#change((next) => { next.get(this.#requireCommand(name)).enabled = Boolean(enabled); });
  }

  copy(name, newName, reserved = new Set()) {
    return this.#change((next) => {
      const source = this.#requireCommand(name);
      const destination = commandKey(newName, this.prefix);
      this.#requireFreeName(destination, reserved);
      // Aliases must remain unique: copy the settings and responses, then add new aliases explicitly.
      next.set(destination, { ...structuredClone(next.get(source)), aliases: [] });
    });
  }

  exportToFile() {
    const task = this.mutation.then(async () => {
      if (!this.available) throw new Error('Custom commands are disabled because data/commands.json could not be loaded.');
      await writeJsonAtomic(this.exportFilePath, Object.fromEntries(this.commands));
      return { filePath: this.exportFilePath, count: this.commands.size };
    });
    this.mutation = task.catch(() => {});
    return task;
  }

  async importFromFile({ replace = false } = {}) {
    const incoming = this.#parseContent(await readFile(this.importFilePath, 'utf8'));
    await this.#change((next) => {
      if (replace) next.clear();
      for (const [name, record] of incoming) {
        if (next.has(name)) throw new Error(`Command ${name} already exists.`);
        next.set(name, structuredClone(record));
      }
    });
    return { filePath: this.importFilePath, count: incoming.size, replaced: replace };
  }

  #parseContent(content) {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object of custom commands.');
    const entries = Array.isArray(parsed) ? parsed.map((value) => [value?.name, value])
      : parsed.name && parsed.response ? [[parsed.name, parsed]] : Object.entries(parsed);
    const loaded = new Map();
    for (const [name, value] of entries) {
      const key = commandKey(name, this.prefix, true);
      if (loaded.has(key)) throw new Error(`Command ${key} already exists.`);
      loaded.set(key, normalizeRecord(value, this.prefix));
    }
    this.#checkNames(loaded);
    return loaded;
  }

  #requireCommand(name) {
    const input = commandKey(name, this.prefix);
    const key = this.aliasesByName.get(input) ?? input;
    if (!this.commands.has(key)) throw new Error(`Command ${input} does not exist.`);
    return key;
  }

  #requireFreeName(key, extra = new Set()) {
    const bare = key.slice(this.prefix.length);
    if (this.reserved.has(bare) || this.runtimeReserved.has(bare) || extra.has(bare)) {
      throw new Error('That name is already used by a built-in command.');
    }
    if (this.commands.has(key) || this.aliasesByName.has(key)) throw new Error(`Command or alias ${key} already exists.`);
  }

  #checkNames(commands) {
    const used = new Set();
    for (const [key, record] of commands) {
      for (const name of [key, ...record.aliases]) {
        if (this.reserved.has(name.slice(this.prefix.length)) || this.runtimeReserved.has(name.slice(this.prefix.length))) {
          throw new Error(`Custom command ${name} conflicts with a built-in command.`);
        }
        if (used.has(name)) throw new Error(`Custom command alias ${name} already exists.`);
        used.add(name);
      }
    }
  }

  #rebuildAliases() {
    this.aliasesByName = new Map();
    for (const [key, record] of this.commands) for (const alias of record.aliases) this.aliasesByName.set(alias, key);
  }

  #change(change) {
    const task = this.mutation.then(async () => {
      if (!this.available) throw new Error('Custom commands are disabled because data/commands.json could not be loaded.');
      const next = new Map([...this.commands].map(([key, value]) => [key, structuredClone(value)]));
      change(next);
      this.#checkNames(next);
      await writeJsonAtomic(this.filePath, Object.fromEntries(next));
      this.commands = next;
      this.#rebuildAliases();
    });
    this.mutation = task.catch(() => {});
    return task;
  }

  #disable(error) {
    this.available = false;
    this.commands = new Map();
    this.aliasesByName = new Map();
    logger.error(`Custom commands disabled; data was left unchanged (${this.filePath}).`, error.message);
    return this;
  }
}

export function createCustomCommandStore(filePath, prefix) {
  return new CustomCommandStore(filePath, prefix);
}
