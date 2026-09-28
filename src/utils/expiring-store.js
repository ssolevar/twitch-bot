export class ExpiringStore {
  constructor({ now = Date.now, cleanupIntervalMs = 60_000, cleanupEveryOperations = 128 } = {}) {
    this.now = now;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.cleanupEveryOperations = cleanupEveryOperations;
    this.entries = new Map();
    this.nextCleanupAt = now() + cleanupIntervalMs;
    this.operations = 0;
  }

  #cleanupIfNeeded(currentTime) {
    this.operations += 1;
    if (currentTime < this.nextCleanupAt && this.operations % this.cleanupEveryOperations !== 0) return;
    this.cleanup(currentTime);
    this.nextCleanupAt = currentTime + this.cleanupIntervalMs;
  }

  set(key, expiresAt) {
    const currentTime = this.now();
    this.#cleanupIfNeeded(currentTime);
    this.entries.set(key, expiresAt);
  }

  isActive(key, currentTime = this.now()) {
    this.#cleanupIfNeeded(currentTime);
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= currentTime) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  delete(key) { return this.entries.delete(key); }

  cleanup(currentTime = this.now()) {
    let removed = 0;
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= currentTime) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size() { return this.entries.size; }
}

export function createExpiringStore(options) {
  return new ExpiringStore(options);
}
