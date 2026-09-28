import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { logger } from '../utils/logger.js';

function validText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 450 || /[\r\n\0]/u.test(text)) throw new Error('Текст таймера: от 1 до 450 символов в одной строке.');
  return text;
}

function validate(items) {
  if (!Array.isArray(items) || items.length > 50) throw new Error('Expected up to 50 timers.');
  const ids = new Set();
  return items.map((item) => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
      !Number.isInteger(item.intervalMinutes) || item.intervalMinutes < 1 || item.intervalMinutes > 1440 ||
      typeof item.enabled !== 'boolean' || !Number.isFinite(item.nextAt)) throw new Error('Invalid timer record.');
    ids.add(item.id);
    return { id: item.id, intervalMinutes: item.intervalMinutes, text: validText(item.text), enabled: item.enabled, nextAt: item.nextAt };
  });
}

export class ChatTimers {
  constructor(filePath, { minMessages = 5, send, channel, now = Date.now, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    this.store = new JsonStore(filePath, validate, 'Chat timers');
    this.minMessages = minMessages;
    this.send = send;
    this.channel = channel;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.counts = new Map();
    this.timer = null;
    this.running = Promise.resolve();
  }

  async load() { await this.store.load(); return this; }
  list() { return this.store.list(); }
  get available() { return this.store.available; }

  async add(minutes, text) {
    const intervalMinutes = Number(minutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) throw new Error('Интервал: от 1 до 1440 минут.');
    const item = { id: randomUUID(), intervalMinutes, text: validText(text), enabled: true, nextAt: this.now() + intervalMinutes * 60_000 };
    const items = await this.store.update((current) => {
      if (current.length >= 50) throw new Error('Максимум 50 таймеров.');
      current.push(item);
      return current;
    });
    return items.length;
  }

  async remove(position) {
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0) throw new Error('Неверный номер таймера.');
    let removed;
    await this.store.update((items) => {
      if (index >= items.length) throw new Error('Неверный номер таймера.');
      [removed] = items.splice(index, 1);
      return items;
    });
    this.counts.delete(removed.id);
  }

  async setEnabled(position, enabled) {
    const index = Number(position) - 1;
    if (!Number.isInteger(index) || index < 0) throw new Error('Неверный номер таймера.');
    let id;
    await this.store.update((items) => {
      if (index >= items.length) throw new Error('Неверный номер таймера.');
      items[index].enabled = enabled;
      items[index].nextAt = this.now() + items[index].intervalMinutes * 60_000;
      id = items[index].id;
      return items;
    });
    this.counts.set(id, 0);
  }

  recordChat() {
    for (const item of this.store.items) if (item.enabled) this.counts.set(item.id, (this.counts.get(item.id) ?? 0) + 1);
  }

  tick() {
    const task = this.running.then(async () => {
      if (!this.available) return;
      if (!this.store.items.some((item) => item.enabled && item.nextAt <= this.now())) return;
      const due = [];
      await this.store.update((items) => items.map((item) => {
        if (!item.enabled || item.nextAt > this.now()) return item;
        due.push({ item, count: this.counts.get(item.id) ?? 0 });
        return { ...item, nextAt: this.now() + item.intervalMinutes * 60_000 };
      }));
      for (const { item, count } of due) {
        this.counts.set(item.id, Math.max(0, (this.counts.get(item.id) ?? 0) - count));
        if (count >= this.minMessages) await this.send(this.channel, item.text);
      }
    }).catch((error) => logger.error('Chat timer failed.', error.message));
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

export async function createChatTimers(filePath, options) { return new ChatTimers(filePath, options).load(); }
