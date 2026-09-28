import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export class JsonStore {
  constructor(filePath, validate, label) {
    this.filePath = filePath;
    this.validate = validate;
    this.label = label;
    this.items = [];
    this.available = true;
    this.mutation = Promise.resolve();
  }

  async load() {
    try {
      this.items = this.validate(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.available = false;
        logger.error(`${this.label} disabled; ${this.filePath} was left unchanged.`, error.message);
      }
    }
    return this;
  }

  list() { return structuredClone(this.items); }

  update(change) {
    const task = this.mutation.then(async () => {
      if (!this.available) throw new Error(`${this.label} disabled: fix ${this.filePath}.`);
      const next = this.validate(change(this.list()));
      await writeJsonAtomic(this.filePath, next);
      this.items = next;
      return this.list();
    });
    this.mutation = task.catch(() => {});
    return task;
  }
}
