import { currentLanguage, t } from '../utils/messages.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CONDITIONS = new Map([
  [0, 'clear'], [1, 'mostlyClear'], [2, 'partlyCloudy'], [3, 'overcast'],
  [45, 'fog'], [48, 'frostFog'], [51, 'lightDrizzle'], [53, 'drizzle'], [55, 'heavyDrizzle'],
  [56, 'freezingDrizzle'], [57, 'heavyFreezingDrizzle'], [61, 'lightRain'], [63, 'rain'],
  [65, 'heavyRain'], [66, 'freezingRain'], [67, 'heavyFreezingRain'], [71, 'lightSnow'],
  [73, 'snow'], [75, 'heavySnow'], [77, 'snowGrains'], [80, 'shower'], [81, 'shower'],
  [82, 'heavyShower'], [85, 'snowfall'], [86, 'heavySnowfall'], [95, 'thunderstorm'],
  [96, 'hailThunderstorm'], [99, 'heavyHailThunderstorm'],
]);

async function getJson(url, { fetchImpl, signal }) {
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(t('weather.timeout'), { cause: error });
    throw new Error(t('weather.unavailable'), { cause: error });
  }
  if (response.status === 429) throw new Error(t('weather.rateLimit'));
  if (!response.ok) throw new Error(t('weather.httpError', { status: response.status }));
  try {
    return await response.json();
  } catch {
    throw new Error(t('weather.invalidResponse'));
  }
}

function temperature(value) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) throw new Error(t('weather.noTemperature'));
  return `${rounded > 0 ? '+' : ''}${rounded}°C`;
}

export async function getWeather(city, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const geo = new URL(GEO_URL);
    geo.search = new URLSearchParams({ name: city, count: '1', language: currentLanguage(), format: 'json' });
    const place = (await getJson(geo, { fetchImpl, signal: controller.signal })).results?.[0];
    if (!place) throw new Error(t('weather.cityNotFound'));

    const forecastUrl = new URL(FORECAST_URL);
    forecastUrl.search = new URLSearchParams({
      latitude: String(place.latitude), longitude: String(place.longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
      timezone: 'auto', wind_speed_unit: 'ms',
    });
    const current = (await getJson(forecastUrl, { fetchImpl, signal: controller.signal })).current;
    if (!current) throw new Error(t('weather.noConditions'));
    const name = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const condition = t(`weather.condition.${CONDITIONS.get(current.weather_code) ?? 'unknown'}`);
    const wind = Math.round((Number(current.wind_speed_10m) || 0) * 10) / 10;
    return t('weather.summary', {
      name, condition, temperature: temperature(current.temperature_2m),
      apparentTemperature: temperature(current.apparent_temperature), wind,
      humidity: current.relative_humidity_2m,
    });
  } finally {
    clearTimeout(timer);
  }
}
