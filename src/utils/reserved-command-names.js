export function reservedCommandNames(commands, predictionPresets) {
  return new Set([
    ...commands.keys(),
    ...(predictionPresets?.listCommands?.() ?? []).map((name) => name.replace(/^!/u, '')),
  ]);
}
