# Mini App: опубликованные отзывы

Удобное окно внутри MAX для поиска, фильтрации и снятия опубликованных отзывов с сайта SILKWAY. Заменяет неудобный список отдельными сообщениями с кнопками.

## Где лежит приложение

| Что | Путь |
| --- | --- |
| HTML entry | `admin-reviews.html` |
| React UI | `src/admin-reviews/` |
| Защищённый API | `GET/DELETE /api/admin/reviews` → `server/entries/adminReviews.ts` → `server/max/adminReviewsHttp.ts` |
| Проверка initData | `server/max/webAppInitData.ts` (HMAC по [валидации MAX](https://dev.max.ru/docs/webapps/validation/)) |
| Поиск / фильтры | `server/max/publishedReviewSearch.ts` + SQL в `postgresStore.ts` |
| Кнопка меню | `server/max/miniAppOpen.ts` → `open_app` / `link` / fallback `m:pl:0` |

Публичный URL после деплоя:

`https://silkwaysitefortanya.vercel.app/admin-reviews.html`

## Ручная настройка в кабинете MAX

Доступ к кабинету MAX у автоматизации нет — это делает владелец бота.

1. Откройте настройки бота на [dev.max.ru](https://dev.max.ru/) / в кабинете партнёра.
2. В разделе мини-приложений зарегистрируйте HTTPS URL: `https://silkwaysitefortanya.vercel.app/admin-reviews.html`.
3. Запомните `user_id` бота (это `contact_id` для кнопки `open_app`) и, если кабинет выдаёт, идентификатор `web_app`.
4. В Vercel (или `.env` сервера) задайте:
   - `MAX_MINI_APP_URL=https://silkwaysitefortanya.vercel.app/admin-reviews.html`
   - `MAX_BOT_CONTACT_ID=<user_id бота>`
   - `MAX_WEB_APP_ID=<id web_app>` (опционально)
5. Убедитесь, что `MAX_BOT_TOKEN` и `MAX_REVIEW_MODERATOR_IDS` уже заданы (те же, что для webhook).
6. После деплоя откройте меню модератора в боте → «Опубликованные отзывы» — должна открыться Mini App внутри MAX.

Пока `MAX_BOT_CONTACT_ID` / `MAX_MINI_APP_URL` не заданы, кнопка шлёт callback `m:pl:0` с текстовой инструкцией.

## Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `MAX_BOT_TOKEN` | Подпись и проверка `initData`; **никогда** не во frontend |
| `MAX_REVIEW_MODERATOR_IDS` | Список user_id с правом доступа к API |
| `MAX_MINI_APP_URL` | HTTPS URL Mini App (кнопка link / инструкция) |
| `MAX_BOT_CONTACT_ID` | `contact_id` кнопки `open_app` |
| `MAX_WEB_APP_ID` | Опциональное поле `web_app` кнопки `open_app` |
| `DATABASE_URL` | PostgreSQL |
| `VITE_MAX_BOT_DEEP_LINK` | Опционально: deep link бота для «вернуться в MAX» через `openMaxLink` |

## Полномочия

1. Клиент читает `WebApp.initData` (строка) через Bridge.
2. Каждый запрос к `/api/admin/reviews` передаёт её в `X-Max-Init-Data` (или `Authorization: tma …`).
3. Сервер проверяет HMAC-SHA256 по документации validation, срок `auth_date` (~1 ч) и извлекает `user.id`.
4. `user.id` сверяется с `MAX_REVIEW_MODERATOR_IDS`.
5. `initDataUnsafe` / `user_id` из JSON тела **не** принимаются как доказательство прав.
6. Вне MAX (нет валидного `initData`) UI показывает заглушку «откройте из MAX», API отвечает `401`.

## Поиск и медиа

- Параметры списка: `q`, `photos`, `videos`, `limit`, `offset`.
- Пустой фильтр = нет ограничения; `0` = ровно ноль файлов данного типа.
- Несколько слов в `q`: все должны встретиться (без учёта регистра) в тексте, авторе или названии товара.
- SQL параметризован (`strpos(lower(...))`); без конкатенации пользовательской строки в SQL.
- `photosCount` / `videosCount` считаются по `media[].type` (`image` / `video`).
- В ответ попадают только URL, прошедшие `isAllowedPublicMediaSrc` (сайт / Vercel Blob).

## Снятие с сайта

`DELETE /api/admin/reviews?id=<uuid>` вызывает существующий `withdrawReview` → `withdrawn_at`.  
Строка в БД сохраняется. Повторный вызов → `409 already_withdrawn`.  
Публичный `GET /api/reviews` не возвращает снятые записи.

## Ограничения

- Нет документированного `WebApp.close()` — кнопка «Закрыть» использует `openMaxLink` (если задан deep link) и подсказку закрыть окно вручную.
- Старые callback `m:pw:` / `m:pc:` для сообщений бота сохранены (обратная совместимость).
- Не тестируйте снятие реальных отзывов production без отдельного сценария.
