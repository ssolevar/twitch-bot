# Конфигурация

Скопируйте `.env.example` в `.env` и заполните Twitch credentials. `.env`, `config/profiles.json`, `data/` с рабочими JSON и `logs/` игнорируются Git.

## Основные настройки

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `TWITCH_BOT_USERNAME` | обязательна | Логин владельца user access token |
| `TWITCH_CHANNEL` | обязательна | Канал для подключения; `#` можно опустить |
| `TWITCH_CLIENT_ID` | обязательна | Client ID приложения, выдавшего токен |
| `TWITCH_ACCESS_TOKEN` | обязательна | User access token; префикс `oauth:` допустим |
| `TWITCH_REFRESH_TOKEN` | пусто | Необязательный refresh token, выданный вместе с user access token |
| `TWITCH_CLIENT_SECRET` | пусто | Нужен для обновления токена конфиденциального Twitch-приложения; публичному не нужен |
| `BOT_PROFILE` | пусто | Имя профиля из `config/profiles.json` |
| `BOT_LANGUAGE` | `ru` | Язык ответов: `ru` или `en` |
| `COMMAND_PREFIX` | `!` | Префикс команд |
| `MAX_COMMAND_REPEAT` | `10` | Максимум повторов команды модератором |
| `COMMAND_REPEAT_DELAY_MS` | `700` | Пауза между повторными ответами, мс |
| `TIMER_MIN_CHAT_MESSAGES` | `5` | Минимум сообщений за интервал таймера |
| `AUTO_REPLY_COOLDOWN_SECONDS` | `30` | Пауза автоответа по ключевому слову |
| `ACTIVE_CHATTER_WINDOW_MINUTES` | `15` | Окно активности для `!рандомчат` |
| `STREAM_INFO_CACHE_SECONDS` | `30` | Кэш ответов `!title` и `!game` |
| `PIN_DURATION_SECONDS` | `600` | Срок по умолчанию: `0` — до конца стрима, `30–1800` — секунды; срок элемента очереди можно указать отдельно |
| `PIN_MESSAGE` | пусто | Текст, который `!закреп` отправляет и закрепляет без ответа на сообщение |
| `PIN_QUEUE_AUTO_ROTATE` | `false` | Автоматическая ротация очереди закрепов |
| `PIN_QUEUE_INTERVAL_SECONDS` | `600` | Интервал ротации, с |
| `ENABLE_WEATHER` | `false` | Включить `!погода` |
| `WEATHER_TIMEOUT_MS` | `10000` | Таймаут запроса к Open-Meteo, мс |
| `WEATHER_ALLOWED_USERNAMES` | пусто | Логины через запятую; пусто — погода доступна всем |
| `FACEIT_API_KEY` | пусто | Необязательный server-side API key FACEIT для `!elo` |
| `FACEIT_DEFAULT_NICKNAME` | пусто | Начальный FACEIT ник для `!elo`; `!setuser` сохраняет выбранный ник локально |
| `FACEIT_GAME_ID` | `cs2` | Игра FACEIT, для которой показывать Elo |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` или `debug` |
| `LOG_FILE_MAX_BYTES` | `5242880` | Максимальный размер активного файла журнала, байт |
| `LOG_FILE_BACKUPS` | `3` | Количество резервных файлов журнала, 1–10 |

Бот пишет сообщения в консоль и в `logs/bot.log`. При выборе профиля файл называется `logs/bot.<profile>.log`. После достижения `LOG_FILE_MAX_BYTES` старые файлы сдвигаются в `.1`, `.2` и далее; по умолчанию сохраняются три копии.

## Профили каналов и язык

Создайте `config/profiles.json` по образцу `config/profiles.example.json`:

```json
{
  "main": { "TWITCH_CHANNEL": "ssolevar", "BOT_LANGUAGE": "ru" },
  "second": { "TWITCH_CHANNEL": "ssolevar", "BOT_LANGUAGE": "en" }
}
```

Затем укажите `BOT_PROFILE=main` или `BOT_PROFILE=second` в `.env`. Настройки выбранного профиля перекрывают одноимённые значения `.env`. Имя профиля содержит 1–32 строчные латинские буквы (`a-z`), цифры, `_` или `-`. В профиле разрешены только настройки канала и поведения бота; OAuth credentials остаются в `.env`. Бот запускает один профиль за процесс. Для профиля рабочие файлы лежат в `data/<profile>/`, а без профиля — непосредственно в `data/`. Не переносите пользовательские данные между профилями без проверки их содержимого.

`BOT_LANGUAGE` выбирает русские или английские ответы из `src/messages.json`; названия команд и их алиасы остаются теми же. Пользовательские ответы, шаблоны EventSub и команды, записанные в JSON, остаются на языке своего текста.

## Локальные прогнозы

Пресеты локальных прогнозов сохраняются в `data/predictions.json`, а при выбранном `BOT_PROFILE` — в `data/<profile>/predictions.json`. Активный прогноз, его таймер и голоса хранятся только в памяти процесса: перезапуск бота отменяет текущее голосование. Дополнительный Twitch scope для этой функции не нужен, поскольку голоса принимаются обычными сообщениями чата.

## AutoMod

Все проверки выключены, пока `ENABLE_AUTOMOD=false`. Настройка категорий и примеры — в [AutoMod](AUTOMOD.md).

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ENABLE_AUTOMOD` | `false` | Включить AutoMod и timeout через Helix |
| `AUTOMOD_TIMEOUT_SECONDS` | `60` | Первый timeout, с |
| `AUTOMOD_STREAK_WINDOW_SECONDS` | `600` | Окно повторных нарушений, с |
| `AUTOMOD_MAX_TIMEOUT_SECONDS` | `3600` | Максимальный timeout, с |
| `AUTOMOD_LINK_ENABLED` | `false` | Блокировать ссылки, кроме разрешённых доменов |
| `AUTOMOD_LINK_ALLOWED_DOMAINS` | пусто | Разрешённые домены через запятую |
| `AUTOMOD_SPAM_ENABLED` | `false` | Флуд в одном сообщении и слишком частые сообщения |
| `AUTOMOD_SPAM_WINDOW_SECONDS` | `10` | Окно частоты сообщений, с |
| `AUTOMOD_SPAM_MESSAGE_LIMIT` | `6` | Максимум сообщений одного пользователя за окно |
| `AUTOMOD_SPAM_REPEAT_COUNT` | `6` | Порог повтора слова в одном сообщении |
| `AUTOMOD_SPAM_CHARACTER_LIMIT` | `10` | Порог повтора символа |
| `AUTOMOD_SPAM_URL_LIMIT` | `3` | Порог числа ссылок |
| `AUTOMOD_REPEAT_ENABLED` | `false` | Проверять одинаковые сообщения пользователя |
| `AUTOMOD_REPEAT_WINDOW_SECONDS` | `60` | Окно повторов, с |
| `AUTOMOD_REPEAT_MESSAGE_LIMIT` | `3` | Порог одинаковых сообщений |
| `AUTOMOD_REPEAT_MIN_LENGTH` | `8` | Минимальная длина сообщения для сравнения |
| `AUTOMOD_CAPS_ENABLED` | `false` | Проверять долю заглавных букв |
| `AUTOMOD_CAPS_MIN_LETTERS` | `12` | Минимум букв для caps detector |
| `AUTOMOD_CAPS_RATIO` | `0.8` | Минимальная доля заглавных букв, от 0 до 1 |
| `AUTOMOD_BLACKLIST_WORDS` | пусто | Запрещённые слова/фразы через запятую |
| `AUTOMOD_WHITELIST_WORDS` | пусто | Фразы, исключённые из проверки по словам |
| `AUTOMOD_BLACKLIST_USERNAMES` | пусто | Запрещённые логины через запятую |
| `AUTOMOD_WHITELIST_USERNAMES` | пусто | Логины, полностью исключённые из AutoMod |
| `AUTOMOD_EXEMPT_MODERATORS` | `true` | Пропускать модераторов |
| `AUTOMOD_EXEMPT_VIPS` | `false` | Пропускать VIP |
| `AUTOMOD_EXEMPT_SUBSCRIBERS` | `false` | Пропускать подписчиков |

Для AutoMod нужны `moderator:manage:banned_users` и роль модератора у аккаунта бота. Владелец канала всегда исключён.

## EventSub

`ENABLE_EVENTSUB=false` полностью отключает подключение EventSub. Если включить его, прежние follow/sub/raid сообщения активны по умолчанию, а новые типы нужно выбрать отдельно:

| Флаг | По умолчанию | Событие и дополнительное право |
|---|---|---|
| `EVENT_FOLLOW_MESSAGE` | `true` | Follow; `moderator:read:followers`, аккаунт бота — модератор |
| `EVENT_SUB_MESSAGE` | `true` | Новая подписка; `channel:read:subscriptions`, токен владельца |
| `EVENT_RAID_MESSAGE` | `true` | Входящий raid; дополнительный scope не нужен |
| `EVENT_GIFT_MESSAGE` | `false` | Gift subs; `channel:read:subscriptions`, токен владельца |
| `EVENT_RESUB_MESSAGE` | `false` | Resub с сообщением; `channel:read:subscriptions`, токен владельца |
| `EVENT_CHEER_MESSAGE` | `false` | Cheer/Bits; `bits:read`, токен владельца |
| `EVENT_UPDATE_MESSAGE` | `false` | Обновление канала; дополнительный scope не нужен |
| `EVENT_ONLINE_MESSAGE` | `false` | Начало эфира; дополнительный scope не нужен |
| `EVENT_OFFLINE_MESSAGE` | `false` | Конец эфира; дополнительный scope не нужен |

Тексты задаются соответствующими переменными `EVENT_FOLLOW_TEMPLATE`, `EVENT_SUB_TEMPLATE`, `EVENT_RAID_TEMPLATE`, `EVENT_GIFT_TEMPLATE`, `EVENT_RESUB_TEMPLATE`, `EVENT_CHEER_TEMPLATE`, `EVENT_UPDATE_TEMPLATE`, `EVENT_ONLINE_TEMPLATE` и `EVENT_OFFLINE_TEMPLATE`. Пустая переменная использует перевод из `src/messages.json`. В шаблонах доступны `{user}`, `{channel}`, `{viewers}`, `{uptime}`, `{count}` (число подарков), `{bits}`, `{months}`, `{duration}`, `{title}`, `{category}` / `{game}` и `{language}`. Если scope или владелец токена не подходят, пропускается только этот тип события; причина записывается в лог. [Типы событий Twitch](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/).

## OAuth и дополнительные scopes

При запуске проверяются логин, Client ID и только два обязательных scope Twitch IRC: `chat:read` и `chat:edit`. Остальные scopes включают отдельные необязательные возможности. Если scope не выдан, бот пишет предупреждение, отключает только соответствующее действие и продолжает работу.

| Возможность | Scope и владелец токена |
|---|---|
| Закрепление и снятие закрепа | `user:write:chat`, `moderator:manage:chat_messages`; аккаунт бота — модератор или владелец |
| AutoMod | `moderator:manage:banned_users`; аккаунт бота — модератор |
| Polls | `channel:manage:polls`; токен владельца канала |
| Смена title/category | `channel:manage:broadcast`; токен владельца канала |
| Slow/followers-only/emote-only | `moderator:manage:chat_settings`; аккаунт бота — модератор или владелец |
| Очистка чата | `moderator:manage:chat_messages`; аккаунт бота — модератор или владелец |
| Shoutout `!so` | `moderator:manage:shoutouts`; аккаунт бота — модератор или владелец |
| Создание клипов `!клип` | `clips:edit`; канал должен быть в эфире |
| EventSub | Смотрите таблицу выше |

Для получения user access token зарегистрируйте приложение в Twitch Developer Console и выберите нужные scopes. Пример базового токена через Twitch CLI:

```bash
twitch token -u -s 'chat:read chat:edit'
```

Добавьте scopes из таблицы только для используемых функций. Роли и владелец токена проверяются отдельно от scopes. Все обычные сообщения бота проходят через общую FIFO-очередь, ограниченную 100 одновременно обрабатываемыми и ожидающими сообщениями и паузой `COMMAND_REPEAT_DELAY_MS`; Helix-вызовы остаются отдельными API-действиями. [Требования Twitch API](https://dev.twitch.tv/docs/api/reference).

Автообновление токена необязательно. Укажите `TWITCH_REFRESH_TOKEN`, выданный вместе с текущим user access token; для конфиденциального приложения добавьте `TWITCH_CLIENT_SECRET`. При ответе 401 бот обновляет токен и сохраняет новую пару в игнорируемом Git файле `data/oauth-tokens.json` или `data/<profile>/oauth-tokens.json`. При следующем запуске сохранённая пара имеет приоритет над значениями `.env`; бот проверяет совпадение Client ID и логина владельца токена. Если файл повреждён, бот сохраняет его без перезаписи и отключает обновление до исправления. Без refresh token заменяйте истёкший access token вручную. [Обновление токенов Twitch](https://dev.twitch.tv/docs/authentication/refresh-tokens/).
