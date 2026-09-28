const API_ROOT = 'https://open.faceit.com/data/v4';
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 100;

export function createFaceitApi({ apiKey = '', gameId = 'cs2', fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();

  async function getPlayerElo(nickname) {
    const normalizedNickname = String(nickname ?? '').trim();
    if (!normalizedNickname || normalizedNickname.length > 40 || /[\s\r\n\0]/u.test(normalizedNickname)) {
      throw new Error('FACEIT nickname is invalid.');
    }
    if (!apiKey) {
      const error = new Error('FACEIT_API_KEY is not configured.');
      error.code = 'NOT_CONFIGURED';
      throw error;
    }

    const cacheKey = normalizedNickname.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && now() < cached.expiresAt) return structuredClone(cached.player);

    const url = new URL(`${API_ROOT}/players`);
    url.searchParams.set('nickname', normalizedNickname);
    url.searchParams.set('game', gameId);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (cause) {
      const error = new Error('FACEIT API request failed.');
      error.code = cause?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`FACEIT API returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const game = data?.games?.[gameId];
    if (!data?.nickname || game?.faceit_elo === null || game?.faceit_elo === undefined || !Number.isFinite(Number(game.faceit_elo))) {
      const error = new Error('FACEIT player has no Elo for the configured game.');
      error.code = 'NO_ELO';
      throw error;
    }

    const player = {
      nickname: data.nickname,
      elo: Number(game.faceit_elo),
      level: game.skill_level !== null && game.skill_level !== undefined && Number.isFinite(Number(game.skill_level))
        ? Number(game.skill_level) : null,
    };
    cache.delete(cacheKey);
    cache.set(cacheKey, { player, expiresAt: now() + CACHE_TTL_MS });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return structuredClone(player);
  }

  return { getPlayerElo };
}
