# Разработка

## Структура

- `src/index.js` — запуск приложения, маршрутизация событий и graceful shutdown.
- `src/bot/` — Twitch IRC соединение, reconnect и parser сообщений.
- `src/commands/` — отдельные команды, loader и handler.
- `src/automod/` — нормализация, правила по ссылкам/словам/истории сообщений, streak и наказания.
- `src/services/` — Twitch API, EventSub, OAuth refresh, профили конфигурации, таймеры, напоминания, автоответы и Open-Meteo.
- `src/utils/` — logger с ротацией, тексты ответов, cooldown, общая очередь чата и очистка истёкших записей.
- `src/messages.json` — каталоги ответов `ru` и `en`.
- `src/config.js` и `config/profiles.example.json` — загрузка настроек и пример профилей.

## Разработка и проверки

Нужен Node.js 20.19.0 или новее. Запустите `npm ci`, скопируйте `.env.example` в `.env`, заполните Twitch credentials и выполните `npm run dev`. `npm test`, `npm run lint` и `npm run check` работают без настоящих Twitch credentials. GitHub Actions запускает `npm ci` и `npm run check` для push и pull request.

## Внешние сервисы

Twitch API service проверяет access token, получает user IDs по логину и выполняет timeout через Helix. Он обрабатывает 401, 403, 404, 429, таймаут и сетевые ошибки. Для AutoMod требуются scope `moderator:manage:banned_users`, права модератора и broadcaster ID.

Валидация OAuth требует только `chat:read` и `chat:edit`. Необязательные возможности проверяют scopes отдельно. Все обычные исходящие сообщения, включая команды, повторы, таймеры, напоминания, автоответы, EventSub и результаты прогнозов, используют одну FIFO-очередь. Очередь ограничивает число ожидающих сообщений, выдерживает `COMMAND_REPEAT_DELAY_MS` между отправками и при остановке может отменить накопившиеся задачи. Вызовы Twitch Helix остаются прямыми действиями API.

Новые команды управления стримом используют Helix Modify Channel Information, Update Chat Settings и Delete Chat Messages. Для title/category нужен токен владельца канала с `channel:manage:broadcast`; для режимов чата нужен `moderator:manage:chat_settings`, для очистки — `moderator:manage:chat_messages`.

OAuth service хранит обновлённую пару токенов в `data/oauth-tokens.json` либо `data/<profile>/oauth-tokens.json`. Файл привязан к Client ID и логину бота. Рабочие JSON, профиль `config/profiles.json`, `.env` и `logs/` не публикуются. Отдельный `BOT_PROFILE` меняет канал и настройки процесса; профили используют общие credentials из `.env`.

Weather service использует Open-Meteo geocoding и forecast endpoints без ключа. Сетевые запросы тестируются подменой `fetch`.

Сохраняйте проект небольшим: команды размещайте в отдельных файлах, сетевые запросы — в `src/services/`, а обработчик запуска не превращайте в место для бизнес-логики.
