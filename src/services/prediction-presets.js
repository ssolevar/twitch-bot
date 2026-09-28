import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { writeJsonAtomic } from './json-store.js';

const MAX_COMMAND_LENGTH = 24;
const MAX_OPTION_LENGTH = 32;
const MAX_TITLE_LENGTH = 100;
const MAX_DURATION_SECONDS = Math.floor(2_147_483_647 / 1000);

export function normalizePredictionCommand(value) {
  const command = String(value ?? '').trim().toLowerCase();
  if (!/^![\p{L}\p{N}_]{1,24}$/u.test(command)) {
    throw new Error(`Prediction command must start with ! and contain 1-${MAX_COMMAND_LENGTH} letters, numbers, or underscores.`);
  }
  return command;
}

export function parsePredictionDuration(value) {
  const input = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{2}))?$/u.exec(input);
  if (!match) throw new Error('Prediction time must use minutes or minutes.seconds (for example, 5 or 1.30).');
  const minutes = Number(match[1]);
  const seconds = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(minutes) || seconds > 59) {
    throw new Error('Prediction seconds must be between 00 and 59.');
  }
  const total = (minutes * 60) + seconds;
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Prediction time must be greater than zero.');
  return total;
}

function normalizeOption(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const option = value.trim();
  if (!option || option.length > MAX_OPTION_LENGTH || /[\s\0]/u.test(option)) {
    throw new Error(`${field} must be a single chat token containing 1-${MAX_OPTION_LENGTH} characters.`);
  }
  return option;
}

function normalizeTitle(value) {
  if (typeof value !== 'string') throw new Error('Prediction title must be a string.');
  const title = value.trim();
  if (!title || title.length > MAX_TITLE_LENGTH || /[\r\n\0]/u.test(title)) {
    throw new Error(`Prediction title must contain 1-${MAX_TITLE_LENGTH} characters on one line.`);
  }
  const labels = title.split('/');
  if (labels.length > 2 || labels.some((label) => !label.trim())) {
    throw new Error('A prediction title may contain one / between two non-empty option labels.');
  }
  return title;
}

function normalizeDuration(value) {
  const durationSeconds = Number(value);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error(`Prediction duration must be 1-${MAX_DURATION_SECONDS} seconds.`);
  }
  return durationSeconds;
}

export function normalizePredictionPreset(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Invalid prediction preset record.');
  }
  const option1 = normalizeOption(value.option1, 'First option');
  const option2 = normalizeOption(value.option2, 'Second option');
  if (option1.toLocaleLowerCase() === option2.toLocaleLowerCase()) {
    throw new Error('Prediction options must be different.');
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Prediction preset enabled must be boolean.');
  }
  return {
    option1,
    option2,
    title: normalizeTitle(value.title),
    durationSeconds: normalizeDuration(value.durationSeconds),
    enabled: value.enabled ?? true,
  };
}

function normalizeReservedName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return name.startsWith('!') ? name : `!${name}`;
}

function isOccupied(command, occupied) {
  if (typeof occupied === 'function') return Boolean(occupied(command));
  if (!occupied || typeof occupied[Symbol.iterator] !== 'function') return false;
  return [...occupied].some((name) => normalizeReservedName(name) === command);
}

function parsePresets(contents) {
  const parsed = JSON.parse(contents);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Expected a JSON object of prediction presets.');
  }
  const presets = new Map();
  for (const [name, value] of Object.entries(parsed)) {
    const command = normalizePredictionCommand(name);
    if (presets.has(command)) throw new Error(`Prediction preset ${command} is duplicated.`);
    presets.set(command, normalizePredictionPreset(value));
  }
  return presets;
}

export class PredictionPresetStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.presets = new Map();
    this.available = true;
    this.mutation = Promise.resolve();
  }

  async load() {
    try {
      this.presets = parsePresets(await readFile(this.filePath, 'utf8'));
      this.available = true;
    } catch (error) {
      this.presets = new Map();
      if (error.code === 'ENOENT') {
        this.available = true;
      } else {
        this.available = false;
        logger.error(`Prediction presets disabled; data was left unchanged (${this.filePath}).`, error.message);
      }
    }
    return this;
  }

  has(command) {
    try {
      return this.presets.has(normalizePredictionCommand(command));
    } catch {
      return false;
    }
  }

  get(command) {
    let key;
    try {
      key = normalizePredictionCommand(command);
    } catch {
      return null;
    }
    const preset = this.presets.get(key);
    return preset ? { command: key, ...structuredClone(preset) } : null;
  }

  list() {
    return [...this.presets].map(([command, preset]) => ({ command, ...structuredClone(preset) }));
  }

  listCommands() { return [...this.presets.keys()]; }

  add(command, preset, { occupied = new Set(), reserved = new Set() } = {}) {
    return this.#change((next) => {
      const key = normalizePredictionCommand(command);
      if (isOccupied(key, occupied) || isOccupied(key, reserved)) {
        throw new Error(`Command ${key} is already reserved.`);
      }
      if (next.has(key)) throw new Error(`Prediction preset ${key} already exists.`);
      const record = normalizePredictionPreset(preset);
      next.set(key, record);
      return { command: key, ...structuredClone(record) };
    });
  }

  update(command, preset) {
    return this.#change((next) => {
      const key = normalizePredictionCommand(command);
      if (!next.has(key)) throw new Error(`Prediction preset ${key} does not exist.`);
      const record = normalizePredictionPreset(preset);
      next.set(key, record);
      return { command: key, ...structuredClone(record) };
    });
  }

  remove(command) {
    return this.#change((next) => {
      const key = normalizePredictionCommand(command);
      const preset = next.get(key);
      if (!preset) throw new Error(`Prediction preset ${key} does not exist.`);
      next.delete(key);
      return { command: key, ...structuredClone(preset) };
    });
  }

  #change(change) {
    const task = this.mutation.then(async () => {
      if (!this.available) {
        throw new Error(`Prediction presets are disabled: fix ${this.filePath}.`);
      }
      const next = new Map([...this.presets].map(([key, value]) => [key, structuredClone(value)]));
      const result = change(next);
      await writeJsonAtomic(this.filePath, Object.fromEntries(next));
      this.presets = next;
      return result;
    });
    this.mutation = task.catch(() => {});
    return task;
  }
}

export async function createPredictionPresetStore(filePath) {
  return new PredictionPresetStore(filePath).load();
}
