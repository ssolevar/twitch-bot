export function parseChatMessage(line) {
  const match = line.match(/^(?:@([^ ]+) )?:([\w]+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #(\S+) :([\s\S]*)$/u);
  if (!match) return null;
  const tags = Object.fromEntries((match[1] ?? '').split(';').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
  return {
    username: match[2].toLowerCase(), channel: match[3].toLowerCase(), message: match[4],
    userId: tags['user-id'] ?? '',
    isBroadcaster: tags.badges?.split(',').some((badge) => badge.startsWith('broadcaster/')) ?? false,
    isModerator: tags.mod === '1' || (tags.badges?.split(',').some((badge) => badge.startsWith('moderator/')) ?? false),
    isSubscriber: tags.subscriber === '1' || (tags.badges?.split(',').some((badge) => badge.startsWith('subscriber/') || badge.startsWith('founder/')) ?? false),
    isVip: tags.badges?.split(',').some((badge) => badge.startsWith('vip/')) ?? false,
  };
}
