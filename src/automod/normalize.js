const zeroWidth = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/gu;
const confusables = new Map(Object.entries({
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '8': 'в',
}));

export function normalizeMessage(message) {
  return String(message ?? '')
    .normalize('NFKC')
    .replace(zeroWidth, '')
    .toLocaleLowerCase('ru')
    .replace(/[abcehkmoptxy03468]/gu, (char) => confusables.get(char) ?? char)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, '')
    .replace(/([\p{L}\p{N}])\1+/gu, '$1');
}
