# Twitch Bot

Простой бот для Twitch-чата на Node.js.

Поддерживает команды, AutoMod, закрепы, Twitch Polls, локальные прогнозы по пресетам и небольшие сценарии автоматизации чата.

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
- Индивидуальный срок для каждого закрепа
- Twitch shoutout через `!so` и создание клипа через `!клип`
- Пресеты закрепов
- Twitch Polls
- Локальные прогнозы по пресетам с голосованием сообщениями в чате
- Сообщения EventSub на follow, sub, raid, gift sub, resub, cheer, смену названия/категории и начало/конец эфира
- `!title`, `!game` и выбор активного участника чата
- Управление названием, категорией и режимами чата с проверкой прав Twitch
- Профили каналов, ответы на русском и английском, локальные логи с ротацией
- Необязательное обновление OAuth token через refresh token
- Необязательный FACEIT Elo через команду `!elo`
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

При запуске проверяются логин, Client ID и базовые scopes для Twitch IRC:

- `chat:read` — чтение сообщений
- `chat:edit` — отправка сообщений через Twitch IRC

Остальные scopes необязательны. Если нужного scope нет, отключается только связанная возможность, причина записывается в журнал, а базовый бот продолжает работать.

Для закрепов нужны `user:write:chat` и `moderator:manage:chat_messages`. Аккаунт бота также должен быть модератором канала или владельцем.

Для AutoMod нужен `moderator:manage:banned_users`. Аккаунт бота должен иметь право модератора, чтобы выдавать таймауты.

Для Polls нужен `channel:manage:polls`, а токен должен принадлежать владельцу канала. Без этого бот запускается, но команды опросов отключены.

Для управления названием и категорией нужен токен владельца с `channel:manage:broadcast`. Для slow/followers-only/emote-only нужен `moderator:manage:chat_settings`, для очистки чата — `moderator:manage:chat_messages`.

`!so <ник>` требует scope `moderator:manage:shoutouts`, а `!клип` — `clips:edit`. Это дополнительные scopes; без них бот продолжает запускаться, но команды отвечают, что функция отключена.

Для EventSub follow нужны `moderator:read:followers` и роль модератора у аккаунта бота; для sub, gift sub и resub — `channel:read:subscriptions` и токен владельца; для cheer — `bits:read` и токен владельца. Raid, channel update и stream online/offline не требуют дополнительного scope. Новые типы событий выключены по умолчанию.

Как получить токен через Twitch CLI и настроить приложение, описано в [конфигурации](docs/CONFIGURATION.md).

Все сообщения бота в чате проходят через одну FIFO-очередь с паузой `COMMAND_REPEAT_DELAY_MS` и пределом 100 одновременно обрабатываемых и ожидающих сообщений. Это сохраняет порядок ответов команд, таймеров, напоминаний, автоответов, EventSub и прогнозов.

## Примеры

```text
!добком !тг https://t.me/ssolevar
!тг
!тг 5

!добпин Telegram: https://t.me/ssolevar
!добпин 300 Telegram: ссылка на 5 минут
!пины
!следпин

!добпинпресет тг Telegram: https://t.me/ssolevar
!пин тг
!откреп

!опрос continue

!добпрог !винлуз 1 2 Вин/Луз 5
!винлуз
!прог
!закрытьпрог

!добалиас !тг !telegram
!права !тг subscriber
!добтаймер 15 Подписывайтесь на Telegram: https://t.me/ssolevar
!добавто telegram https://t.me/ssolevar
!напомни 10 Время сделать перерыв
!рандомчат 3
!title Новый заголовок стрима
!game Dota 2
!setuser nickname
!elo
!эло другой_nickname
!инфоком !тг
!копком !тг !телеграм
!сменназвание Вечерний стрим
!слоу 10
!so nickname
!клип
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
