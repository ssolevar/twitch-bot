import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 450;
const activeRotations = new WeakMap();

function validateText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_TEXT_LENGTH || /[\r\n\0]/u.test(text)) {
    throw new Error(`Текст должен занимать от 1 до ${MAX_TEXT_LENGTH} символов в одной строке.`);
  }
  return text;
}

function validatePresetName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) throw new Error('Имя пресета: 1-32 буквы, цифры, дефис или подчеркивание.');
  return name;
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, filePath);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(temporary, { force: true }).catch(() => {});
    throw new Error(`Не удалось безопасно сохранить ${path.basename(filePath)}: ${error.message}`, { cause: error });
  }
}

export class PinQueue {
  constructor(queuePath, presetsPath) {
    this.queuePath = queuePath;
    this.presetsPath = presetsPath;
    this.items = [];
    this.rotationIndex = 0;
    this.presets = new Map();
    this.mutation = Promise.resolve();
    this.queueAvailable = true;
    this.presetsAvailable = true;
    this.presetsWritable = true;
  }

  async load(defaultPresetsPath = null) {
    try {
      const state = JSON.parse(await readFile(this.queuePath, 'utf8'));
      if (!state || !Array.isArray(state.items) || state.items.length > MAX_ITEMS || !Number.isInteger(state.rotationIndex)) {
        throw new Error('Expected items (up to 100 entries) and rotationIndex.');
      }
      this.items = state.items.map(validateText);
      this.rotationIndex = this.items.length ? ((state.rotationIndex % this.items.length) + this.items.length) % this.items.length : 0;
    } catch (error) {
      this.items = [];
      this.rotationIndex = 0;
      if (error.code !== 'ENOENT') {
        this.queueAvailable = false;
        logger.error(`Pin queue disabled; data was left unchanged (${this.queuePath}).`, error.message);
      }
    }

    let presetsLoaded = false;
    let actualPresetsCorrupt = false;
    try {
      this.presets = this.#parsePresets(await readFile(this.presetsPath, 'utf8'));
      presetsLoaded = true;
    } catch (error) {
      actualPresetsCorrupt = error.code !== 'ENOENT';
      if (actualPresetsCorrupt) logger.error(`Pin presets damaged; data was left unchanged (${this.presetsPath}).`, error.message);
    }
    if (!presetsLoaded && defaultPresetsPath) {
      try {
        this.presets = this.#parsePresets(await readFile(defaultPresetsPath, 'utf8'));
        presetsLoaded = true;
      } catch (error) {
        if (error.code !== 'ENOENT') logger.error(`Default pin presets unavailable (${defaultPresetsPath}).`, error.message);
      }
    }
    this.presetsAvailable = presetsLoaded || !actualPresetsCorrupt;
    this.presetsWritable = !actualPresetsCorrupt;
    return this;
  }

  list() { return [...this.items]; }
  listPresets() { return [...this.presets.keys()]; }
  getPreset(name) { return this.presets.get(String(name ?? '').trim().toLowerCase()); }

  add(text) {
    return this.#change(async () => {
      this.#requireQueue();
      if (this.items.length >= MAX_ITEMS) throw new Error(`Очередь заполнена (максимум ${MAX_ITEMS} закрепов).`);
      const next = [...this.items, validateText(text)];
      await this.#saveQueue(next, this.rotationIndex);
      return next.length;
    });
  }

  remove(position) {
    return this.#change(async () => {
      this.#requireQueue();
      if (!Number.isInteger(position) || position < 1 || position > this.items.length) throw new Error('Такого номера в очереди нет.');
      const next = [...this.items];
      const [removed] = next.splice(position - 1, 1);
      const cursor = next.length === 0 ? 0 : Math.min(next.length - 1, Math.max(0, this.rotationIndex - (position - 1 < this.rotationIndex ? 1 : 0)));
      await this.#saveQueue(next, cursor);
      return removed;
    });
  }

  clear() {
    return this.#change(async () => {
      this.#requireQueue();
      const count = this.items.length;
      await this.#saveQueue([], 0);
      return count;
    });
  }

  addPreset(name, text) {
    return this.#change(async () => {
      this.#requirePresetsWritable();
      const key = validatePresetName(name);
      if (this.presets.has(key)) throw new Error(`Пресет «${key}» уже существует.`);
      const next = new Map(this.presets).set(key, validateText(text));
      await this.#savePresets(next);
      return key;
    });
  }

  deletePreset(name) {
    return this.#change(async () => {
      this.#requirePresetsWritable();
      const key = validatePresetName(name);
      if (!this.presets.has(key)) throw new Error(`Пресет «${key}» не найден.`);
      const next = new Map(this.presets);
      next.delete(key);
      await this.#savePresets(next);
      return key;
    });
  }

  pinNext({ rotate = false, pin }) {
    return this.#change(async () => {
      this.#requireQueue();
      if (!this.items.length) return null;
      const position = rotate ? this.rotationIndex % this.items.length : 0;
      const text = this.items[position];
      await pin(text);
      if (rotate) {
        const nextIndex = (position + 1) % this.items.length;
        await this.#saveQueue(this.items, nextIndex);
      } else {
        const next = [...this.items];
        next.splice(0, 1);
        await this.#saveQueue(next, 0);
      }
      return { text, remaining: this.items.length, position: position + 1 };
    });
  }

  #change(operation) {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => {});
    return result;
  }

  async #saveQueue(items, rotationIndex) {
    await atomicWriteJson(this.queuePath, { items, rotationIndex });
    this.items = items;
    this.rotationIndex = rotationIndex;
  }

  async #savePresets(presets) {
    await atomicWriteJson(this.presetsPath, Object.fromEntries(presets));
    this.presets = presets;
  }

  #parsePresets(content) {
    const parsed = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Expected a JSON object of pin presets.');
    return new Map(Object.entries(parsed).map(([name, text]) => [validatePresetName(name), validateText(text)]));
  }

  #requireQueue() {
    if (!this.queueAvailable) throw new Error('Очередь закрепов отключена: файл поврежден. Исправьте data/pin-queue.json.');
  }

  #requirePresetsWritable() {
    if (!this.presetsAvailable) throw new Error('Пресеты закрепов отключены: файл поврежден и резервная копия недоступна.');
    if (!this.presetsWritable) throw new Error('Пресеты закрепов доступны только для чтения: поврежденный файл оставлен без изменений.');
  }
}

export async function createPinQueue(queuePath, presetsPath, defaultPresetsPath = null) {
  return new PinQueue(queuePath, presetsPath).load(defaultPresetsPath);
}

export function startPinRotation({ pinQueue, intervalSeconds, pin, onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  const active = activeRotations.get(pinQueue);
  if (active) return active;
  let running = false;
  let inFlight = Promise.resolve();
  const rotate = async () => {
    if (running || pinQueue.list().length === 0) return;
    running = true;
    try {
      await pinQueue.pinNext({ rotate: true, pin });
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
  const trigger = () => {
    if (!running) inFlight = rotate();
  };
  trigger();
  const timer = setIntervalImpl(trigger, intervalSeconds * 1000);
  timer.unref();
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    clearIntervalImpl(timer);
    stopping = (async () => {
      await inFlight;
      activeRotations.delete(pinQueue);
    })();
    return stopping;
  };
  activeRotations.set(pinQueue, stop);
  return stop;
}
