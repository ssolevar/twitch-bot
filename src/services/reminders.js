import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { logger } from '../utils/logger.js';

function validText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 450 || /[\r\n\0]/u.test(text)) throw new Error('Текст напоминания: от 1 до 450 символов в одной строке.');
  return text;
}

function validate(items) {
  if (!Array.isArray(items) || items.length > 50) throw new Error('Expected up to 50 reminders.');
  const ids = new Set();
  return items.map((item) => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Number.isFinite(item.dueAt)) throw new Error('Invalid reminder record.');
    ids.add(item.id);
    return { id: item.id, dueAt: item.dueAt, text: validText(item.text) };
  });
}

export class Reminders {
  constructor(filePath, { send, canSend = () => true, channel, now = Date.now, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    this.store = new JsonStore(filePath, validate, 'Reminders');
    this.send = send;
    this.canSend = canSend;
    this.channel = channel;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.timer = null;
    this.running = Promise.resolve();
    this.skipped = new Set();
  }

  async load() {
    await this.store.load();
    const expired = this.store.items.filter((item) => item.dueAt <= this.now());
    this.skipped = new Set(expired.map((item) => item.id));
    if (expired.length && this.store.available) {
      try { await this.store.update((items) => items.filter((item) => !this.skipped.has(item.id))); }
      catch (error) { logger.error('Could not remove expired reminders.', error.message); }
    }
    return this;
  }

  list() { return this.store.list(); }
  get available() { return this.store.available; }

  async add(minutes, text) {
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Время: от 1 до 1440 минут.');
    const reminder = { id: randomUUID(), dueAt: this.now() + duration * 60_000, text: validText(text) };
    const items = await this.store.update((current) => {
      if (current.length >= 50) throw new Error('Максимум 50 напоминаний.');
      current.push(reminder);
      return current;
    });
    return items.length;
  }

  async remove(position) {
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0) throw new Error('Неверный номер напоминания.');
    await this.store.update((items) => {
      if (index >= items.length) throw new Error('Неверный номер напоминания.');
      items.splice(index, 1);
      return items;
    });
  }

  tick() {
    const task = this.running.then(async () => {
      if (!this.available || !this.canSend() || !this.store.items.some((item) => item.dueAt <= this.now() && !this.skipped.has(item.id))) return;
      let due = [];
      await this.store.update((items) => {
        due = items.filter((item) => item.dueAt <= this.now() && !this.skipped.has(item.id));
        return items.filter((item) => !due.some((entry) => entry.id === item.id));
      });
      for (const item of due) await this.send(this.channel, item.text);
    }).catch((error) => logger.error('Reminder delivery failed.', error.message));
    this.running = task;
    return task;
  }

  start() {
    if (!this.available) return async () => {};
    if (this.timer) return () => this.stop();
    this.timer = this.setIntervalImpl(() => void this.tick(), 1000);
    this.timer.unref?.();
    return () => this.stop();
  }

  async stop() {
    if (this.timer) this.clearIntervalImpl(this.timer);
    this.timer = null;
    await this.running;
  }
}

export async function createReminders(filePath, options) { return new Reminders(filePath, options).load(); }
