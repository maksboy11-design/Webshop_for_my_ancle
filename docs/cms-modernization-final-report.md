# CMS-модернизация SILKWAY — итоговый отчёт (этапы 1–7)

Дата: 02.11.2026 (Europe/Moscow). Ветка: `main`. Миграция **011 на прод не применялась**.

## 1. Сделанные функции (по этапам)

| Этап | Что сделано |
|------|-------------|
| **1** | Типы блоков (`src/cms/blocks.ts`), валидаторы, миграции 007–009, конвертер legacy→blocks, чтение published из `product_content` в `/api/products` |
| **2** | Редактор описания TipTap: заголовок секции, панель секций, автосписок/нумерация, черновик `product_content` + явная публикация, нумерация секций на сайте |
| **3** | Медиатека: direct-to-Blob upload, magic-bytes, дедуп sha256, WebP-варианты, связи `product_media`, галерея и документы товара |
| **4** | «Видео о товаре», доп. блоки (характеристики, преимущества, инфо, фото, галерея) |
| **5** | Bulk по id, дубликат, статусы, версии, корзина (trash/restore/purge) |
| **6** | Глобальный CMS-поиск (`?cmsSearch=1`), «Проверить товар», журнал `cms_activity_log`, adaptive preview; миграция 011 (индексы, **не на прод**) |
| **7** | Perf/security/mobile polish: N+1 в memory-поиске, ETag+304 для публичных products/pages, debounce журнала, XSS-фикс `/product-media/`, lazy-чанки, аудит auth/MIME |

## 2. Ключевые файлы

**Сервер:** `server/max/productsHttp.ts`, `pagesHttp.ts`, `mediaHttp.ts`, `productContentStore.ts`, `mediaStore.ts`, `pagesStore.ts`, `cmsGlobalSearch.ts`, `cmsActivityStore.ts`, `http.ts` (`withCacheEtag`), `adminAuth.ts`.

**CMS/типы:** `src/cms/blocks.ts`, `pageDoc.ts`, `productChecklist.ts`, `productMerge.ts`, `productSearchText.ts`, `descriptionDoc.ts`.

**Админка:** `src/admin-reviews/App.tsx` (lazy-секции), `ProductForm.tsx`, `DescriptionEditor.tsx`, `media/*`, `pages/*`, `CmsSearchSection.tsx`, `ActivitySection.tsx`, `AdaptivePreview` (этап 6).

**Публичный сайт:** `ProductDescriptionBlock`, `ProductPage`, публичный рендер страниц CMS, `/product-media/*` proxy.

**API-бандлы:** `api/products.js`, `api/admin/products.js`, `api/pages.js`, `api/admin/pages.js`, `api/admin/media.js` (и связанные).

**Миграции:** `db/migrations/007`…`011` (+ down).

## 3. Таблицы и миграции

| Миграция | Содержимое | Прод |
|----------|------------|------|
| **007** | `product_content` (draft/published, status, rev, search_tsv, deleted_at) | применена |
| **008** | `media`, `product_media` | применена |
| **009** | `product_versions`, `cms_activity_log` | применена |
| **010** | страницы CMS (`pages`, версии страниц) | применена |
| **011** | индексы поиска (даты, meta category/brand/kind, media title) | **не применена** — ждёт разрешения |

Все миграции аддитивные; down не удаляет данные каталога. Старые `cms_product_overrides` / `cms_entries` / `products.ts` сохранены как фолбэк.

## 4. Архитектура

- **Каталог:** статический `products.ts` ⊕ overrides ⊕ added entries ⊕ `product_content.published` (приоритет CMS).
- **Черновик ≠ сайт:** публикация только явной кнопкой; draft_rev — оптимистичная блокировка.
- **Медиа:** клиент → Blob (client token) → complete + sniff → `media` → опционально process (WebP). Публичные URL через same-origin `/product-media/...`.
- **Страницы:** отдельный store + sanitize при отдаче; блоки как у товаров (без raw HTML).
- **Админ-маршруты:** единый `authorizeAdmin` (HMAC initData + allowlist) до обработчиков search/activity/checklist/media/pages.
- **Hobby:** ≤12 serverless functions; без CDN purge — свежесть через `s-maxage=30` + ETag по телу ответа.

## 5. Пакетная загрузка (batch upload)

- Очередь `useUploadQueue`: параллельность 3, AbortSignal, backoff на 5xx/сеть, idempotency по sha256.
- Direct upload в Vercel Blob (лимит тела функции 4.5 МБ обходится).
- Проверки MIME на клиенте и сервере (`sniffMime` / `sniffMatches`); неподдерживаемый тип — сразу ошибка без запроса.
- Обработка изображений в фоне не занимает слот загрузки; дубликаты помечаются.

## 6. Медиатека

- Список с пагинацией (PAGE=24), фильтры kind/статус, счётчик использований.
- Роли: gallery / main / video / document / block.
- Галерея товара: порядок, главное фото, кнопки ↑↓ (+ DnD на десктопе).
- Документы и видео (MP4/MOV, YouTube/RuTube по whitelist) без транскодинга на Hobby.

## 7. Блочный редактор

- TipTap + section_heading, text, списки, image, gallery, video, specs, benefits, documents, info.
- Автосохранение черновика ~1.5–2 с; локальный draft buffer 300 мс.
- Публичный рендер только из JSON (без `innerHTML`); неизвестный тип пропускается.
- Страницы: `sanitizePublicPageDoc` + `isSafeMediaSrc` (https и `/product-media/…`, reject `javascript:`).

## 8. Видео

- Блок «Видео о товаре» + `showVideos`; хостинг Blob или embed по белому списку.
- Poster/обложка; `<video preload="none">`; Range на Blob.
- Без ffmpeg/HLS на Hobby.

## 9. Меры производительности и безопасности (этап 7)

**Perf**
- Публичный каталог: batch `listPublished` + `allProductImages` (без N+1 по товарам).
- Memory CMS search: `content.get` только для id с content-строками (исправлен N+1).
- Списки: пагинация media 24 / search 20 / activity 30; виртуализация не нужна при текущих объёмах (~40 товаров).
- Debounce: поиск CMS 300 мс, autosave 1.5–2 с, фильтры журнала 300 мс.
- Кеш: `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=300` + **weak ETag (sha256 тела)** → 304 по `If-None-Match` после publish.
- Админка: `React.lazy` для Products/Media/Pages/Search/Activity/Editors.

**Security**
- `authorizeAdmin` на всех новых admin-маршрутах (products search/activity/checklist, pages, media).
- XSS: sanitize page/product blocks; safe URL/media src; нет raw HTML.
- Файлы: MIME allowlist + magic-bytes; pathname привязан к id/mime.
- Критический баг этапа 7: sanitize отбрасывал same-origin `/product-media/…` у картинок страниц → исправлено (`isSafeMediaSrc`).

**Mobile**
- Adaptive preview 390/768/1280; science e2e 375/768/1440 без горизонтального overflow.
- Кнопки вместо единственного DnD в MAX WebView.

## 10. Тесты

| Набор | Результат |
|-------|-----------|
| `npm run test:unit` | **311/311** pass (вкл. `pageDoc`, `http` ETag, media, pages, productContent, uploadQueue) |
| e2e CMS-релевантные (`pages-editor`, `admin-media`, `description-editor`, `admin-panel`, `product-description`, `science`) | **все pass** |
| `tests/hero.spec.ts` | **9 fail** — **pre-existing**, не связаны с CMS: ожидают отсутствие кнопки «Показать карточку товара» / hotspot на мобильном Hero; к CMS-этапам 1–7 не относятся |

## 11. Проблемы и ограничения

- Миграция **011** не на проде → фильтры поиска по meta/датам на больших объёмах могут быть медленнее до применения индексов.
- Hobby: нет purge CDN; свежесть опирается на короткий s-maxage + ETag.
- Три слоя товара (static/overrides/entries + content) усложняют отладку приоритетов.
- Видео без адаптивного стриминга; большие файлы дороже по Blob-трафику.
- Прямой TCP к Neon с box недоступен — миграции через approved path / serverless.
- `hero.spec` остаётся красным (отдельный бэклог Hero, не CMS).

## 12. Незавершённое / вне скоупа

- Применить **011** на прод (только с разрешения).
- Cron очистки корзины / доводки media (слот Hobby).
- Роли модераторов (сейчас плоский allowlist).
- Полноценная виртуализация списков при росте каталога ≫ 100.
- Mux/Cloudflare Stream при необходимости HLS.
- Починка pre-existing `hero.spec` (мобильный Hero hotspot/CTA).
- Отдельный iframe-preview с HMAC-токеном черновика (сейчас adaptive preview в админке).

## 13. Изменения этапа 7 (этот коммит)

- `src/cms/pageDoc.ts` + `tests/pageDoc.unit.ts` — `isSafeMediaSrc`
- `server/max/cmsGlobalSearch.ts` — меньше N+1
- `server/max/http.ts` + `http.test.ts` — `weakEtag` / `withCacheEtag`
- `productsHttp.ts` / `pagesHttp.ts` — ETag на публичных GET
- `ActivitySection.tsx` — debounce 300 мс
- пересборка `api/products.js`, `api/pages.js`, `api/admin/products.js`, `api/admin/pages.js`

---

Итог: этапы 1–7 закрыты в коде на `main`. Прод-данные миграцией 011 не трогались. Отчёт: `/workspace/wb-audit/cms-modernization-final-report.md` и `docs/cms-modernization-final-report.md`.
