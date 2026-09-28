import { logger } from './logger.js';
import { t } from './messages.js';

export function reportPinDataError(client, channel, error) {
  if (error.cause) {
    logger.error('Pin data write failed.', error.cause.message);
    client.say(channel, t('pin.dataSaveError'));
    return;
  }
  const message = error.message;
  if (message.startsWith('Текст должен занимать')) return client.say(channel, t('pin.invalidText'));
  if (message.startsWith('Имя пресета:')) return client.say(channel, t('pin.invalidPresetName'));
  if (message.startsWith('Очередь заполнена')) return client.say(channel, t('pin.queueFull'));
  if (message.startsWith('Такого номера')) return client.say(channel, t('pin.invalidPosition'));
  const existing = /^Пресет «(.+)» уже существует\.$/u.exec(message);
  if (existing) return client.say(channel, t('pin.presetExists', { name: existing[1] }));
  const missing = /^Пресет «(.+)» не найден\.$/u.exec(message);
  if (missing) return client.say(channel, t('pin.presetMissing', { name: missing[1] }));
  if (message.startsWith('Очередь закрепов отключена:')) return client.say(channel, t('pin.queueCorrupt'));
  if (message.startsWith('Пресеты закрепов отключены:')) return client.say(channel, t('pin.presetsCorrupt'));
  if (message.startsWith('Пресеты закрепов доступны только для чтения:')) return client.say(channel, t('pin.presetsReadOnly'));
  logger.warn('Pin command could not update pin data.', message);
  client.say(channel, t('pin.dataError'));
}
