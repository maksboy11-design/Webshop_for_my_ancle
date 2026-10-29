# Админ-панель Mini App MAX: отзывы, товары, вебинары

Тот же адрес `admin-reviews.html`, та же кнопка open_app и та же авторизация: подпись `initData` (HMAC, `MAX_BOT_TOKEN`) + `MAX_REVIEW_MODERATOR_IDS`. `initDataUnsafe` и `userId` из тела запроса не используются.

## API
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/products` | Публичные поля товаров (каталог + правки). `?changed=1` — только изменённые. Кэш `s-maxage` + `stale-while-revalidate`; без таблицы — статический каталог. |
| GET | `/api/admin/products[?id=]` | Список / карточка (merged + base). |
| PATCH | `/api/admin/products?id=` | `{ set: {...}, reset: [...] }`; `null` — явное «нет», отсутствие поля — из каталога. |
| POST | `/api/admin/products?id=&upload=1` | JPEG/PNG/WebP ≤ 4 МБ, ≤ 40 Мп, проверка сигнатуры → sharp → WebP 1600 + миниатюра 480 → Vercel Blob; отдаётся через `/product-media/`. |
| GET | `/api/admin/webinars[?status=&q=&offset=&limit=]`, `?id=` | Список / карточка. |
| PATCH | `/api/admin/webinars?id=` | Название, спикер, дата, источник (YouTube или https-файл в Blob), время старта, перепроверка. Провал проверки не меняет опубликованную запись (422). |
| DELETE | `/api/admin/webinars?id=` | Мягко: опубликованный → снят, ожидающий → отклонён; повтор идемпотентен. |

## Миграция 005 (выполняет владелец)
```
DATABASE_URL=... npm run db:migrate -- up     # создаёт cms_product_overrides
DATABASE_URL=... npm run db:migrate -- down   # откат: удаляет таблицу и все правки товаров
```
Без таблицы сайт показывает статический каталог, а раздел «Товары» — баннер «правки недоступны».

Для загрузки фото нужен `BLOB_READ_WRITE_TOKEN` (тот же, что для медиа отзывов).
