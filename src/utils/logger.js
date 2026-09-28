import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
let fileWarningShown = false;
let configured = null;

export function configureLogger(options) { configured = options; }

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function logFile() {
  const profile = configured?.profile ?? process.env.BOT_PROFILE?.trim();
  const suffix = profile && /^[a-z0-9_-]{1,32}$/iu.test(profile) ? `.${profile}` : '';
  return path.resolve('logs', `bot${suffix}.log`);
}

function rotate(filePath, bytesToWrite) {
  const maximum = boundedInteger(configured?.fileMaxBytes ?? process.env.LOG_FILE_MAX_BYTES, 5 * 1024 * 1024, 1024, 100 * 1024 * 1024);
  if (!existsSync(filePath) || statSync(filePath).size + bytesToWrite <= maximum) return;
  const backups = boundedInteger(configured?.fileBackups ?? process.env.LOG_FILE_BACKUPS, 3, 1, 10);
  rmSync(`${filePath}.${backups}`, { force: true });
  for (let number = backups - 1; number >= 1; number -= 1) {
    if (existsSync(`${filePath}.${number}`)) renameSync(`${filePath}.${number}`, `${filePath}.${number + 1}`);
  }
  renameSync(filePath, `${filePath}.1`);
}

function write(level, message, details) {
  const threshold = levels[(configured?.level ?? process.env.LOG_LEVEL)?.toLowerCase()] ?? levels.info;
  if (levels[level] > threshold) return;
  const suffix = details === undefined ? '' : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `${new Date().toISOString()} [${level}] ${message}${suffix}`.replace(/[\r\n\0]/gu, ' ');
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  try {
    const filePath = logFile();
    mkdirSync(path.dirname(filePath), { recursive: true });
    rotate(filePath, Buffer.byteLength(`${line}\n`, 'utf8'));
    appendFileSync(filePath, `${line}\n`, 'utf8');
  } catch (error) {
    if (!fileWarningShown) {
      fileWarningShown = true;
      console.error(`Local log file is unavailable: ${error.message}`);
    }
  }
}

export const logger = Object.fromEntries(Object.keys(levels).map((level) => [level, (message, details) => write(level, message, details)]));
