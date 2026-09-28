# Twitch Bot

Простой бот для Twitch-чата на Node.js.

Поддерживает команды, AutoMod, закрепы, Twitch Polls и небольшие сценарии автоматизации чата.

## Автор проекта

Проект Twitch-бота создан и поддерживается [ssolevar](https://github.com/ssolevar). Новости и ссылки автора: [t.me/ssolevar](https://t.me/ssolevar).

## Возможности

- Команды `!пинг`, `!аптайм`, `!команды`, `!погода`
- Свои команды через `!добком`
- Повтор команд для модераторов
- Алиасы, права, несколько ответов, cooldown, копирование и импорт/экспорт своих команд
- Таймеры, автоответы и напоминания
- AutoMod: ссылки, спам, повтор сообщений, caps, списки слов и исключения по ролям
- Очередь закрепов
- Пресеты закрепов
- Twitch Polls
- Сообщения EventSub на follow, sub, raid, gift sub, resub, cheer, смену названия/категории и начало/конец эфира
- `!title`, `!game` и выбор активного участника чата
- Управление названием, категорией и режимами чата с проверкой прав Twitch
- Профили каналов, ответы на русском и английском, локальные логи с ротацией
- Необязательное обновление OAuth token через refresh token
- Переподключение при обрыве соединения

## Установка

Требуется Node.js 20.19+.

```bash
git clone https://github.com/ssolevar/twitch-bot.git
cd twitch-bot
npm install
```

Создайте `.env` из `.env.example`.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Заполните в `.env`:

```env
TWITCH_BOT_USERNAME=
TWITCH_CHANNEL=
TWITCH_CLIENT_ID=
TWITCH_ACCESS_TOKEN=
```

Запуск:

```bash
npm start
```

## Twitch OAuth

При запуске бот проверяет токен и эти scopes:

- `chat:read` и `chat:edit` — Twitch IRC
- `user:write:chat` — отправка сообщений через Twitch API
- `moderator:manage:chat_messages` и `moderator:read:chat_messages` — закрепы

Для AutoMod нужен `moderator:manage:banned_users`. Аккаунт бота должен быть модератором канала, чтобы выдавать таймауты и закреплять сообщения.

Для Polls нужен `channel:manage:polls`, а токен должен принадлежать владельцу канала. Без этого бот запускается, но команды опросов отключены.

Для управления названием и категорией нужен токен владельца с `channel:manage:broadcast`. Для slow/followers-only/emote-only нужен `moderator:manage:chat_settings`, для очистки чата — `moderator:manage:chat_messages`.

Для EventSub follow нужны `moderator:read:followers` и роль модератора у аккаунта бота; для sub, gift sub и resub — `channel:read:subscriptions` и токен владельца; для cheer — `bits:read` и токен владельца. Raid, channel update и stream online/offline не требуют дополнительного scope. Новые типы событий выключены по умолчанию.

Как получить токен через Twitch CLI и настроить приложение, описано в [конфигурации](docs/CONFIGURATION.md).

## Примеры

```text
!добком !тг https://t.me/ssolevar
!тг
!тг 5

!добпин Telegram: https://t.me/ssolevar
!пины
!следпин

!добпинпресет тг Telegram: https://t.me/ssolevar
!пин тг
!откреп

!опрос continue

!добалиас !тг !telegram
!права !тг subscriber
!добтаймер 15 Подписывайтесь на Telegram: https://t.me/ssolevar
!добавто telegram https://t.me/ssolevar
!напомни 10 Время сделать перерыв
!рандомчат 3
!title
!game
!инфоком !тг
!копком !тг !телеграм
!сменназвание Вечерний стрим
!слоу 10
```

## Настройка

AutoMod выключен по умолчанию. Правила находятся в `src/automod/categories.js`.

```env
ENABLE_AUTOMOD=true
```

Погода тоже выключена по умолчанию:

```env
ENABLE_WEATHER=true
```

Ответы выбираются через `BOT_LANGUAGE=ru` или `BOT_LANGUAGE=en` из `src/messages.json`. Профиль канала задаётся `BOT_PROFILE` в `config/profiles.json`; пример находится в `config/profiles.example.json`. Состояние каждого профиля хранится отдельно в `data/<profile>/`. Журнал пишется в `logs/` с ротацией. Для необязательного обновления токена укажите `TWITCH_REFRESH_TOKEN` и, если приложение Twitch конфиденциальное, `TWITCH_CLIENT_SECRET`.

Остальные настройки описаны в [конфигурации](docs/CONFIGURATION.md).

Таймеры отправляют сообщение, только если чат был активен. EventSub выключен по умолчанию; включение и тексты сообщений находятся в `.env.example`.

## Документация

- [Команды](docs/COMMANDS.md)
- [Функции чата](docs/CHAT_FEATURES.md)
- [AutoMod](docs/AUTOMOD.md)
- [Конфигурация](docs/CONFIGURATION.md)
- [Разработка](docs/DEVELOPMENT.md)
