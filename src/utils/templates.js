import { t } from './messages.js';

function clean(value) {
  return String(value ?? '—').replace(/[\r\n\0]/gu, ' ').trim() || '—';
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  return [days && t('uptime.days', { value: days }), hours && t('uptime.hours', { value: hours }),
    t('uptime.minutes', { value: minutes })].filter(Boolean).join(' ');
}

export function renderTemplate(template, values = {}, uptimeSeconds = process.uptime()) {
  const fields = {
    user: clean(values.user),
    channel: clean(values.channel),
    viewers: clean(values.viewers),
    uptime: formatUptime(uptimeSeconds),
  };
  return clean(template).replace(/\{(user|channel|uptime|viewers)\}/giu, (_match, key) => fields[key.toLowerCase()]).slice(0, 450);
}
