const explicitUrl = /https?:\/\/[^\s<>]+/giu;
const bareDomain = /(?:^|[^\p{L}\p{N}@._-])((?:www\.)?(?:[\p{L}\p{N}-]+\.)+[\p{L}][\p{L}\p{N}-]{1,62}(?:\/[^\s<>]*)?)/giu;
const bareIpv4 = /(?:^|[^\p{L}\p{N}@._-])((?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s<>]*)?)/gu;

function entries(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return typeof value === 'string' ? value.split(',') : [];
}

function hostname(value) {
  try {
    const candidate = String(value).trim().replace(/[.,!?;:)\]}]+$/u, '');
    if (!candidate) return '';
    return new URL(/^https?:\/\//iu.test(candidate) ? candidate : `https://${candidate}`).hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return '';
  }
}

export function findBlockedLink(message, allowedDomains = []) {
  const allowlist = entries(allowedDomains).map(hostname).filter(Boolean);
  const text = String(message ?? '');
  const candidates = [
    ...[...text.matchAll(explicitUrl)].map((match) => match[0]),
    ...[...text.matchAll(bareDomain)].map((match) => match[1]),
    ...[...text.matchAll(bareIpv4)].map((match) => match[1]),
  ];
  for (const candidate of candidates) {
    const domain = hostname(candidate);
    if (domain && !allowlist.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) return domain;
  }
  return null;
}
