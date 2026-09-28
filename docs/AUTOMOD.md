# AutoMod

AutoMod выключен по умолчанию. Перед включением проверьте правила на тестовом канале. Для timeout через Twitch Helix бот должен быть модератором и иметь scope `moderator:manage:banned_users`.

## Правила

```env
ENABLE_AUTOMOD=true
AUTOMOD_LINK_ENABLED=true
AUTOMOD_LINK_ALLOWED_DOMAINS=twitch.tv,t.me
AUTOMOD_SPAM_ENABLED=true
AUTOMOD_REPEAT_ENABLED=true
AUTOMOD_CAPS_ENABLED=true
AUTOMOD_BLACKLIST_WORDS=слово1,слово2
AUTOMOD_WHITELIST_WORDS=безопасная фраза
AUTOMOD_BLACKLIST_USERNAMES=bad_user
AUTOMOD_WHITELIST_USERNAMES=trusted_user
```

- Anti-link проверяет URL и домены без `https://`. Разрешённый домен пропускает также поддомены: `t.me` разрешает адреса вида `www.t.me`.
- Spam detector проверяет флуд одинаковыми словами/символами и ссылками в одном сообщении, а также число сообщений пользователя за окно `AUTOMOD_SPAM_WINDOW_SECONDS`.
- Repeat detector сравнивает нормализованные сообщения одного пользователя за `AUTOMOD_REPEAT_WINDOW_SECONDS`. Короткие сообщения длиной меньше `AUTOMOD_REPEAT_MIN_LENGTH` не учитываются.
- Caps detector сравнивает долю заглавных букв; минимум букв и порог доли задают `AUTOMOD_CAPS_MIN_LETTERS` и `AUTOMOD_CAPS_RATIO`.
- Blacklist слов и логинов блокирует совпадения. `AUTOMOD_WHITELIST_USERNAMES` полностью освобождает указанных пользователей от AutoMod. `AUTOMOD_WHITELIST_WORDS` исключает фразы только из проверки по словам и категориям; anti-link, spam и caps продолжают работать. Логин в blacklist имеет приоритет над исключёнными фразами.

Пороги числа сообщений, повторов и другие значения находятся в [конфигурации](CONFIGURATION.md). Правила и списки можно также расширять в `src/automod/categories.js` и `src/automod/exceptions.js`; файлы содержат пустые примеры.

## Исключения по ролям

```env
AUTOMOD_EXEMPT_MODERATORS=true
AUTOMOD_EXEMPT_VIPS=false
AUTOMOD_EXEMPT_SUBSCRIBERS=false
```

Владелец канала всегда пропускается. Эти флаги полностью освобождают соответствующую роль от проверок AutoMod. Роль берётся из Twitch IRC tags. Пустой или выключенный список правил сам по себе никого не блокирует.

## Timeout и ошибки

Первое нарушение получает `AUTOMOD_TIMEOUT_SECONDS`. Повторное нарушение в течение `AUTOMOD_STREAK_WINDOW_SECONDS` удваивает срок до `AUTOMOD_MAX_TIMEOUT_SECONDS`. Чистое сообщение или истечение окна сбрасывает streak. История сообщений и streak хранятся только в памяти и очищаются после перезапуска. Сообщение, пойманное AutoMod, не передаётся командам.

Нормализация применяет Unicode NFKC, убирает zero-width символы и учитывает похожие латинские и кириллические буквы. Ошибки Twitch API записываются в локальный журнал `logs/`, без токена и Authorization header.
