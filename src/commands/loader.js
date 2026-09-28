import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));

export async function loadCommands({ features = {} } = {}) {
  const commands = new Map();
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js') && !['loader.js', 'handler.js'].includes(file));
  for (const file of files) {
    const { default: command } = await import(pathToFileURL(path.join(directory, file)));
    if (!command?.name || typeof command.execute !== 'function') throw new Error(`Invalid command module: ${file}`);
    if (command.feature && features[command.feature] !== true) continue;
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (commands.has(key) && commands.get(key) !== command) throw new Error(`Built-in command alias ${key} is duplicated.`);
      commands.set(key, command);
    }
  }
  return commands;
}
