import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { writeJsonAtomic } from './json-store.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

export class OAuthTokens {
  constructor({ clientId, clientSecret = '', username = '', accessToken, refreshToken = '', filePath, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.filePath = filePath;
    this.fetchImpl = fetchImpl;
    this.persistenceAvailable = true;
    this.refreshPromise = null;
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!value || value.clientId !== this.clientId || (this.username && value.username !== this.username) || typeof value.accessToken !== 'string' ||
        !value.accessToken || typeof value.refreshToken !== 'string' || !value.refreshToken) {
        throw new Error('Invalid OAuth token file or Client ID mismatch.');
      }
      this.accessToken = value.accessToken;
      this.refreshToken = value.refreshToken;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.persistenceAvailable = false;
        logger.error(`OAuth token file was left unchanged (${this.filePath}).`, error.message);
      }
    }
    return this;
  }

  getAccessToken() { return this.accessToken; }
  get canRefresh() { return Boolean(this.refreshToken) && this.persistenceAvailable; }

  async refreshIfCurrent(usedToken) {
    if (usedToken !== this.accessToken) return this.accessToken;
    if (!this.canRefresh) throw new Error('OAuth refresh is unavailable. Configure TWITCH_REFRESH_TOKEN or repair the token file.');
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#refresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async #refresh() {
    const body = new URLSearchParams({
      client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.refreshToken,
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await this.fetchImpl(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(), signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`Could not refresh Twitch OAuth token: ${error.name === 'AbortError' ? 'request timed out' : 'network unavailable'}.`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Twitch OAuth refresh failed with HTTP ${response.status}. Reauthorize the bot.`);
    let value;
    try { value = await response.json(); }
    catch { throw new Error('Twitch returned an invalid OAuth refresh response.'); }
    if (typeof value?.access_token !== 'string' || !value.access_token ||
      typeof value.refresh_token !== 'string' || !value.refresh_token) {
      throw new Error('Twitch OAuth refresh response has no access or refresh token.');
    }
    this.accessToken = value.access_token;
    this.refreshToken = value.refresh_token;
    try {
      await writeJsonAtomic(this.filePath, {
        clientId: this.clientId, username: this.username,
        accessToken: this.accessToken, refreshToken: this.refreshToken,
      });
      logger.info('Twitch OAuth token refreshed and saved.');
    } catch (error) {
      logger.error('Twitch OAuth token refreshed in memory, but could not be saved. Repair the token file before restarting.', error.message);
    }
    return this.accessToken;
  }
}

export async function createOAuthTokens(options) { return new OAuthTokens(options).load(); }
