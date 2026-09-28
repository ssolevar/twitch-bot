import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { renderTemplate } from '../utils/templates.js';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

function renderEventMessage(template, event, channel, type, anonymousLabel) {
  const anonymous = (type === 'channel.subscription.gift' || type === 'channel.cheer') && event.is_anonymous;
  const user = anonymous ? anonymousLabel : type === 'channel.raid'
    ? event.from_broadcaster_user_name ?? event.from_broadcaster_user_login
    : event.user_name ?? event.user_login ?? event.broadcaster_user_name ?? event.broadcaster_user_login;
  const clean = (value) => String(value ?? '—').replace(/[\r\n\0]/gu, ' ').trim() || '—';
  const fields = {
    user, channel, viewers: event.viewers, uptime: renderTemplate('{uptime}'),
    count: event.total, bits: event.bits, months: event.cumulative_months,
    duration: event.duration_months, title: event.title,
    category: event.category_name, game: event.category_name, language: event.language,
  };
  return String(template ?? '').replace(/\{(user|channel|viewers|uptime|count|bits|months|duration|title|category|game|language)\}/giu,
    (_match, key) => clean(fields[key.toLowerCase()])).replace(/[\r\n\0]/gu, ' ').trim().slice(0, 450);
}

export function eventSubDefinitions({ config, scopes, botUserId, broadcasterId, log = logger }) {
  if (!config.eventSub.enabled) return [];
  const available = new Set(scopes);
  const definitions = [];
  if (config.eventSub.follow) {
    if (available.has('moderator:read:followers')) definitions.push({
      type: 'channel.follow', version: '2',
      condition: { broadcaster_user_id: broadcasterId, moderator_user_id: botUserId },
      template: config.eventSub.followTemplate,
    });
    else log.warn('EventSub follow messages disabled: missing moderator:read:followers.');
  }
  if (config.eventSub.sub) {
    if (available.has('channel:read:subscriptions') && botUserId === broadcasterId) definitions.push({
      type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: broadcasterId },
      template: config.eventSub.subTemplate,
    });
    else log.warn('EventSub subscription messages disabled: broadcaster token with channel:read:subscriptions is required.');
  }
  if (config.eventSub.raid) definitions.push({
    type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId },
    template: config.eventSub.raidTemplate,
  });
  const broadcasterToken = botUserId === broadcasterId;
  const broadcasterCondition = { broadcaster_user_id: broadcasterId };
  if (config.eventSub.gift) {
    if (broadcasterToken && available.has('channel:read:subscriptions')) definitions.push({
      type: 'channel.subscription.gift', version: '1', condition: broadcasterCondition,
      template: config.eventSub.giftTemplate, anonymousLabel: config.eventSub.anonymousLabel,
    });
    else log.warn('EventSub gift messages disabled: broadcaster token with channel:read:subscriptions is required.');
  }
  if (config.eventSub.resub) {
    if (broadcasterToken && available.has('channel:read:subscriptions')) definitions.push({
      type: 'channel.subscription.message', version: '1', condition: broadcasterCondition,
      template: config.eventSub.resubTemplate,
    });
    else log.warn('EventSub resub messages disabled: broadcaster token with channel:read:subscriptions is required.');
  }
  if (config.eventSub.cheer) {
    if (broadcasterToken && available.has('bits:read')) definitions.push({
      type: 'channel.cheer', version: '1', condition: broadcasterCondition,
      template: config.eventSub.cheerTemplate, anonymousLabel: config.eventSub.anonymousLabel,
    });
    else log.warn('EventSub cheer messages disabled: broadcaster token with bits:read is required.');
  }
  if (config.eventSub.update) definitions.push({
    type: 'channel.update', version: '2', condition: broadcasterCondition,
    template: config.eventSub.updateTemplate,
  });
  if (config.eventSub.online) definitions.push({
    type: 'stream.online', version: '1', condition: broadcasterCondition,
    template: config.eventSub.onlineTemplate,
  });
  if (config.eventSub.offline) definitions.push({
    type: 'stream.offline', version: '1', condition: broadcasterCondition,
    template: config.eventSub.offlineTemplate,
  });
  return definitions;
}

export class EventSubClient {
  constructor({ twitchApi, definitions, send, channel, WebSocketImpl = WebSocket,
    setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    this.twitchApi = twitchApi;
    this.definitions = definitions;
    this.send = send;
    this.channel = channel;
    this.WebSocketImpl = WebSocketImpl;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.socket = null;
    this.pending = null;
    this.reconnectTimer = null;
    this.keepaliveTimer = null;
    this.keepaliveSeconds = 30;
    this.reconnectDelay = 1000;
    this.started = false;
    this.closed = false;
    this.subscribedSessions = new Set();
    this.subscriptionEpoch = 0;
    this.activeSubscriptionTypes = new Set();
    this.seenMessages = new Map();
  }

  start() {
    if (this.started || !this.definitions?.length) return;
    this.started = true;
    this.#connect(EVENTSUB_URL, false);
  }

  #connect(url, migrating) {
    if (this.closed) return;
    const socket = new this.WebSocketImpl(url);
    if (migrating) this.pending = socket;
    else this.socket = socket;
    socket.on('message', (raw) => {
      try { this.#message(socket, JSON.parse(raw.toString()), migrating); }
      catch (error) { logger.warn('Invalid EventSub message.', error.message); }
    });
    socket.on('error', (error) => logger.warn('EventSub connection error.', error.message));
    socket.on('close', () => {
      if (this.closed) return;
      if (socket === this.pending) {
        this.pending = null;
        if (!this.socket || this.socket.readyState === this.WebSocketImpl.CLOSED) this.#scheduleReconnect();
      } else if (socket === this.socket) {
        this.socket = null;
        this.#clearKeepalive();
        if (!this.pending) this.#scheduleReconnect();
      }
    });
  }

  #message(socket, data, migrating) {
    const type = data?.metadata?.message_type;
    if (socket !== this.socket && socket !== this.pending) return;
    if (type === 'session_welcome') {
      const session = data.payload?.session;
      if (!session?.id) throw new Error('EventSub welcome has no session ID.');
      this.reconnectDelay = 1000;
      if (migrating) {
        const old = this.socket;
        this.socket = socket;
        this.pending = null;
        if (old && old !== socket) old.close();
      } else if (!this.subscribedSessions.has(session.id)) {
        this.subscribedSessions.add(session.id);
        if (this.subscribedSessions.size > 100) this.subscribedSessions.delete(this.subscribedSessions.values().next().value);
        this.subscriptionEpoch += 1;
        this.activeSubscriptionTypes.clear();
        void this.#subscribe(session.id, this.subscriptionEpoch);
      }
      this.#resetKeepalive(session.keepalive_timeout_seconds);
      return;
    }
    if (socket !== this.socket) return;
    this.#resetKeepalive(data.payload?.session?.keepalive_timeout_seconds);
    if (type === 'session_reconnect') {
      const url = data.payload?.session?.reconnect_url;
      if (url && !this.pending) this.#connect(url, true);
    } else if (type === 'notification') this.#notification(data);
    else if (type === 'revocation') {
      const revokedType = data.payload?.subscription?.type ?? 'unknown';
      this.activeSubscriptionTypes.delete(revokedType);
      logger.warn(`EventSub subscription revoked: ${revokedType}.`);
    }
  }

  async #subscribe(sessionId, epoch) {
    await Promise.all(this.definitions.map(async (definition) => {
      if (this.closed) return;
      try {
        await this.twitchApi.createEventSubSubscription({
          type: definition.type, version: definition.version, condition: definition.condition, sessionId,
        });
        if (!this.closed && this.subscriptionEpoch === epoch) this.activeSubscriptionTypes.add(definition.type);
      } catch (error) {
        logger.warn(`Could not subscribe to ${definition.type}.`, error.message);
      }
    }));
  }

  #notification(data) {
    const definition = this.definitions.find((entry) => entry.type === data.payload?.subscription?.type);
    if (!definition) return;
    const event = data.payload?.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      logger.warn('EventSub notification has no valid event payload.');
      return;
    }
    const id = data.metadata?.message_id;
    if (id && this.seenMessages.has(id)) return;
    if (id) {
      this.seenMessages.set(id, Date.now());
      if (this.seenMessages.size > 500) this.seenMessages.delete(this.seenMessages.keys().next().value);
    }
    if (definition.type === 'channel.subscribe' && event.is_gift && this.activeSubscriptionTypes.has('channel.subscription.gift')) return;
    this.send(this.channel, renderEventMessage(definition.template, event, this.channel, definition.type, definition.anonymousLabel));
  }

  #resetKeepalive(seconds) {
    this.#clearKeepalive();
    if (Number.isFinite(seconds) && seconds > 0) this.keepaliveSeconds = seconds;
    this.keepaliveTimer = this.setTimeoutImpl(() => {
      if (!this.closed && this.socket) {
        if (typeof this.socket.terminate === 'function') this.socket.terminate();
        else this.socket.close();
      }
    }, (this.keepaliveSeconds * 2 + 5) * 1000);
    this.keepaliveTimer.unref?.();
  }

  #clearKeepalive() {
    if (this.keepaliveTimer) this.clearTimeoutImpl(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  #scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      this.#connect(EVENTSUB_URL, false);
    }, this.reconnectDelay);
    this.reconnectTimer.unref?.();
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) this.clearTimeoutImpl(this.reconnectTimer);
    this.#clearKeepalive();
    const sockets = [...new Set([this.pending, this.socket].filter(Boolean))];
    this.pending = null;
    this.socket = null;
    await Promise.all(sockets.map((socket) => new Promise((resolve) => {
      if (socket.readyState === this.WebSocketImpl.CLOSED) return resolve();
      const timer = setTimeout(resolve, 2000);
      socket.once('close', () => { clearTimeout(timer); resolve(); });
      socket.close();
    })));
  }
}
