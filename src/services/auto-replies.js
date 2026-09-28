import { JsonStore } from './json-store.js';
import { renderTemplate } from '../utils/templates.js';

function validKeyword(value) {
  const keyword = String(value ?? '').trim().toLowerCase();
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(keyword)) throw new Error('Ключевое слово: 1-40 букв, цифр, дефисов или подчёркиваний.');
  return keyword;
}

function validResponse(value) {
  const response = String(value ?? '').trim();
  if (!response || response.length > 450 || /[\r\n\0]/u.test(response)) throw new Error('Ответ: от 1 до 450 символов в одной строке.');
  return response;
}

function validate(items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('Expected up to 100 auto replies.');
  const names = new Set();
  return items.map((item) => {
    const keyword = validKeyword(item?.keyword);
    if (names.has(keyword) || typeof item.enabled !== 'boolean') throw new Error('Invalid auto reply record.');
    names.add(keyword);
    return { keyword, response: validResponse(item.response), enabled: item.enabled };
  });
}

export class AutoReplies {
  constructor(filePath, { cooldownSeconds = 30, botUsername = '', prefix = '!', now = Date.now, send, channel } = {}) {
    this.store = new JsonStore(filePath, validate, 'Auto replies');
    this.cooldownMs = cooldownSeconds * 1000;
    this.botUsername = botUsername.toLowerCase();
    this.prefix = prefix;
    this.now = now;
    this.send = send;
    this.channel = channel;
    this.lastSent = new Map();
  }

  async load() { await this.store.load(); return this; }
  list() { return this.store.list(); }
  get available() { return this.store.available; }

  async add(keyword, response) {
    const name = validKeyword(keyword);
    const text = validResponse(response);
    await this.store.update((items) => {
      if (items.some((item) => item.keyword === name)) throw new Error('Такое ключевое слово уже есть.');
      if (items.length >= 100) throw new Error('Максимум 100 автоответов.');
      items.push({ keyword: name, response: text, enabled: true });
      return items;
    });
  }

  async remove(keyword) {
    const name = validKeyword(keyword);
    await this.store.update((items) => {
      const index = items.findIndex((item) => item.keyword === name);
      if (index < 0) throw new Error('Автоответ не найден.');
      items.splice(index, 1);
      return items;
    });
    this.lastSent.delete(name);
  }

  async setEnabled(keyword, enabled) {
    const name = validKeyword(keyword);
    await this.store.update((items) => {
      const item = items.find((entry) => entry.keyword === name);
      if (!item) throw new Error('Автоответ не найден.');
      item.enabled = enabled;
      return items;
    });
  }

  handle(message) {
    if (!this.available || message.username?.toLowerCase() === this.botUsername || message.message?.trimStart().startsWith(this.prefix)) return false;
    const text = message.message?.toLowerCase() ?? '';
    const now = this.now();
    for (const item of this.store.items) {
      if (!item.enabled || !text.includes(item.keyword) || now < (this.lastSent.get(item.keyword) ?? 0)) continue;
      this.lastSent.set(item.keyword, now + this.cooldownMs);
      this.send(this.channel, renderTemplate(item.response, { user: message.username, channel: this.channel }));
      return true;
    }
    return false;
  }
}

export async function createAutoReplies(filePath, options) { return new AutoReplies(filePath, options).load(); }
