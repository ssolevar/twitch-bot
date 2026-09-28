import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

function parsePresets(contents) {
  const presets = JSON.parse(contents);
  if (!presets || Array.isArray(presets) || typeof presets !== 'object') {
    throw new Error('Poll preset data must be a JSON object.');
  }
  for (const [name, preset] of Object.entries(presets)) {
    if (!/^[a-z0-9_-]{1,32}$/u.test(name) || !preset || typeof preset !== 'object') {
      throw new Error(`Invalid poll preset: ${name}.`);
    }
    const { title, choices, duration } = preset;
    if (typeof title !== 'string' || !title.trim() || title.length > 60 || /[\r\n\0]/u.test(title)) {
      throw new Error(`Poll preset ${name} title must be 1-60 characters on one line.`);
    }
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 5 || choices.some((choice) => typeof choice !== 'string' || !choice.trim() || choice.length > 25 || /[\r\n\0]/u.test(choice))) {
      throw new Error(`Poll preset ${name} must have 2-5 choices, each 1-25 characters on one line.`);
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 1800) {
      throw new Error(`Poll preset ${name} duration must be between 15 and 1800 seconds.`);
    }
  }
  return presets;
}

export async function loadPollPresets(filePath, fallbackFilePath = null) {
  try {
    return parsePresets(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && !fallbackFilePath) {
      logger.warn(`Poll presets unavailable; ${filePath} is missing.`);
      return {};
    }
    if (error.code !== 'ENOENT') logger.error(`Poll presets damaged; data was left unchanged (${filePath}).`, error.message);
  }
  if (fallbackFilePath) {
    try {
      const defaults = parsePresets(await readFile(fallbackFilePath, 'utf8'));
      logger.warn(`Using default poll presets from ${fallbackFilePath}.`);
      return defaults;
    } catch (error) {
      logger.error(`Poll presets disabled; defaults are unavailable (${fallbackFilePath}).`, error.message);
    }
  }
  return {};
}
