import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

export class TwitchClient {
  constructor({ username, channel, accessToken, getAccessToken, refreshAccessToken, WebSocketImpl = WebSocket }) {
    this.username = username;
    this.channel = channel;
    this.accessToken = accessToken;
    this.getAccessToken = getAccessToken ?? (() => this.accessToken);
    this.refreshAccessToken = refreshAccessToken;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.closed = false;
    this.fatalError = false;
    this.authRefreshAttempts = 0;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.handlers = new Set();
  }

  onMessage(handler) { this.handlers.add(handler); }

  connect() {
    if (this.closed) return;
    this.socket = new this.WebSocketImpl(IRC_URL);
    const socket = this.socket;
    let usedToken;
    socket.on('open', () => {
      usedToken = this.getAccessToken();
      socket.send(`PASS oauth:${usedToken}\r\n`);
      socket.send(`NICK ${this.username}\r\n`);
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
      socket.send(`JOIN #${this.channel}\r\n`);
      this.reconnectDelay = 1000;
    });
    socket.on('message', (data) => {
      for (const line of data.toString().split('\r\n')) {
        if (line.startsWith('PING ')) socket.send(`PONG ${line.slice(5)}\r\n`);
        if (line.startsWith(':tmi.twitch.tv NOTICE ') && line.includes(' :Login authentication failed')) {
          this.fatalError = true;
          socket.close();
          if (this.refreshAccessToken && this.authRefreshAttempts < 1) {
            this.authRefreshAttempts += 1;
            void this.refreshAccessToken(usedToken).then(() => {
              if (this.closed) return;
              this.fatalError = false;
              this.connect();
            }).catch((error) => logger.error('Twitch IRC OAuth refresh failed.', error.message));
          } else logger.error('Twitch rejected the access token. Check TWITCH_ACCESS_TOKEN.');
        }
        if (line.startsWith(':tmi.twitch.tv 001 ')) {
          this.authRefreshAttempts = 0;
          logger.info(`Connected to #${this.channel} as @${this.username}.`);
        }
        for (const handler of this.handlers) handler(line);
      }
    });
    socket.on('error', (error) => logger.error('Twitch connection error.', error.message));
    socket.on('close', () => {
      if (this.closed || this.fatalError || socket !== this.socket) return;
      logger.warn(`Twitch connection closed; reconnecting in ${this.reconnectDelay / 1000}s.`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    });
  }

  say(channel, message) {
    if (String(channel).replace(/^#/, '').toLowerCase() !== this.channel) return;
    if (typeof message !== 'string') return;
    const safeMessage = message.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll(String.fromCharCode(0), ' ').slice(0, 450).trim();
    if (safeMessage && this.socket?.readyState === this.WebSocketImpl.OPEN) {
      this.socket.send(`PRIVMSG #${this.channel} :${safeMessage}\r\n`);
    }
  }

  isConnected() { return this.socket?.readyState === this.WebSocketImpl.OPEN; }

  async close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    if (!this.socket || this.socket.readyState === this.WebSocketImpl.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      this.socket.once('close', () => { clearTimeout(timer); resolve(); });
      this.socket.close();
    });
  }
}
