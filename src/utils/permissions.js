export function isBroadcaster(message, channel) {
  return message.isBroadcaster === true || message.username?.toLowerCase() === channel?.toLowerCase();
}

export function canModerate(message, channel) {
  return isBroadcaster(message, channel) || message.isModerator === true;
}

export function hasCommandPermission(message, channel, permission) {
  if (permission === 'everyone') return true;
  if (isBroadcaster(message, channel)) return true;
  if (permission === 'broadcaster') return false;
  if (message.isModerator === true) return true;
  if (permission === 'moderator') return false;
  if (permission === 'subscriber') return message.isSubscriber === true;
  if (permission === 'vip') return message.isVip === true;
  return false;
}
