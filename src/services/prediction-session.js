function labelsFor(preset) {
  const parts = preset.title.split('/').map((part) => part.trim());
  if (parts.length === 2 && parts.every(Boolean)) return parts;
  return [preset.option1, preset.option2];
}

function summarize(active) {
  const [label1, label2] = labelsFor(active.preset);
  let count1 = 0;
  let count2 = 0;
  for (const vote of active.votes.values()) {
    if (vote === active.preset.option1) count1 += 1;
    else if (vote === active.preset.option2) count2 += 1;
  }
  const total = count1 + count2;
  const percent1 = total ? Math.round((count1 / total) * 100) : 0;
  const percent2 = total ? 100 - percent1 : 0;
  return { ...active.preset, label1, label2, count1, count2, percent1, percent2, total };
}

export class PredictionSession {
  constructor({ onComplete = () => {}, botUsername = '', now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    this.onComplete = onComplete;
    this.botUsername = botUsername.toLowerCase();
    this.now = now;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.active = null;
  }

  start(preset) {
    if (this.active) return { started: false, active: this.current() };
    const startedAt = this.now();
    const active = {
      preset: structuredClone(preset), votes: new Map(), startedAt,
      endsAt: startedAt + preset.durationSeconds * 1000, timer: null,
    };
    this.active = active;
    const timer = this.setTimeoutImpl(() => this.finish(), preset.durationSeconds * 1000);
    timer?.unref?.();
    active.timer = timer;
    return { started: true, active: this.current() };
  }

  vote(username, value) {
    if (!this.active) return false;
    const voter = String(username ?? '').trim().toLowerCase();
    if (!voter || voter === this.botUsername) return false;
    const vote = String(value ?? '').trim();
    if (vote !== this.active.preset.option1 && vote !== this.active.preset.option2) return false;
    this.active.votes.set(voter, vote);
    return true;
  }

  current() {
    if (!this.active) return null;
    return {
      ...summarize(this.active),
      remainingSeconds: Math.max(0, Math.ceil((this.active.endsAt - this.now()) / 1000)),
    };
  }

  finish() {
    if (!this.active) return null;
    const active = this.active;
    this.active = null;
    this.clearTimeoutImpl(active.timer);
    const result = summarize(active);
    Promise.resolve(this.onComplete(result)).catch(() => {});
    return result;
  }

  cancel() {
    if (!this.active) return false;
    const active = this.active;
    this.active = null;
    this.clearTimeoutImpl(active.timer);
    return true;
  }

  close() {
    this.cancel();
  }
}

export function createPredictionSession(options) {
  return new PredictionSession(options);
}

export function predictionLabels(preset) {
  return labelsFor(preset);
}
