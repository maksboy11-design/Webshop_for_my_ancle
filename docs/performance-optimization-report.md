# SILKWAY — отчёт по оптимизации производительности

Дата: 2026-10-30 (Europe/Moscow)  
Базовый коммит до perf: `5b9ae89` (Benefits nav на WaterSurface)  
Репозиторий: `maksboy11-design/Webshop_for_my_ancle` · ветка `main`

## Цели

- Быстрая и предсказуемая загрузка на слабом мобильном / нестабильном Wi‑Fi.
- Сохранить дизайн, оригинальные JPG Hero (SHA-256), MAX/admin security, тексты/цены/PV.
- Не возвращать WaterSpread; Benefits nav + WaterSurface остаются рабочими.
- Бюджеты ориентира: ~1.5 MB transfer / JS ~300 KB gz / CSS ~100 KB / above-fold images ~500 KB / fonts ~100 KB.

## Метод измерения

Скрипты: `scripts/perf-measure.mjs` (Playwright CDP, lab).

- **Before (prod deploy, сценарий A mobile 390):** `PERF_URL=https://silkwaysitefortanya.vercel.app/` — см. `/tmp/perf-prod-a.txt`.
- **After (локальный `vite preview` :4173):** `PERF_URL=http://127.0.0.1:4173/` — `/tmp/perf-after.txt` (A–D + desktop).
- Lab ≠ CrUX: локальный TTFB ~2 ms; prod TTFB ~709 ms. Сравниваем transfer и состав ресурсов; FCP на preview завышенно «хороший» из‑за localhost.
- LCP в observer скрипта часто `null` (короткое окно / buffered entry) — в отчёте опираемся на FCP + transfer + top resources.

## До (prod A, mobile)

| Метрика | Значение |
|---|---|
| Transfer | **~1666 KB** (1 706 365 B) |
| Requests | 21 |
| FCP | ~2204 ms |
| CLS | 0 |
| TTFB | ~709 ms |

Топ transfer:

| KB | Ресурс |
|---:|---|
| 661 | `products/device.png` |
| 260 | `brand/logo-silkway.png` |
| 165 | `hero/hero-bg-mobile.jpg` |
| 149 | `hero/hero-bg-desktop.jpg` (лишняя загрузка на mobile) |
| … | основной JS без code-split страниц |

## После (локальный preview)

| Сценарий | Transfer | FCP | CLS | reqs |
|---|---:|---:|---:|---:|
| A mobile normal 390 | **~673 KB** | 104 ms* | 0 | 31 |
| B weak 4G 1 Mbps / 400 ms / CPU 4× | **~426 KB** | 2360 ms | 0 | 26 |
| C very weak 400 Kbps / 800 ms / CPU 4× | **~240 KB** | 5336 ms | 0 | 16 |
| D warm cache revisit | **~9 KB** | 44 ms* | 0 | 30 |
| Desktop 1440 | **~622 KB** | 108 ms* | 0 | 32 |

\*FCP на localhost несопоставим с prod TTFB; важнее объём сети.

Сборка (gzip / raw):

| Chunk | raw | gz≈ |
|---|---:|---:|
| `main-*.js` | 77 KB | **~25 KB** |
| `Benefits-*.js` (lazy) | 37 KB | **~15 KB** |
| React vendor (`preload-helper` / react chunk) | ~221 KB | **~69 KB** |

Топ after A (mobile): Inter latin-ext woff2 ~83 KB, hero-bg-mobile.webp ~71 KB, react ~67 KB, flagship-device.webp ~64 KB, hero-bg-desktop.webp ~61 KB (остаточный dual-fetch в lab), hero-bg-mobile.avif ~52 KB, Inter latin ~47 KB, logo.webp ~19 KB.

**Δ transfer A:** ~1666 KB → ~673 KB ≈ **−60 %** (−993 KB).  
Главные выигрыши: device.png 661→webp 64; logo 260→webp 19 (+ sm PNG fallback); Hero JPG dual → WebP/AVIF variants; main JS 143→77 + lazy routes/Benefits; font subsets (без greek/viet).

## Что сделано (Phase 3+)

1. **Hero `<picture>`** — AVIF/WebP + JPG fallback; preload WebP с `media` по breakpoint; cache-bust `?v=3`. Оригиналы JPG **не перекодированы** (SHA сохранены):
   - desktop `65e776d62e3e66208974ce967b712ad0a7b85b5974145e0c8708c0ed4920ee4d`
   - mobile `825e2dd826da0d662907ba78bf9df13e1e92a5032cbd6ab60d7fef4cd4d1fb9b`
2. **Производные изображения** (только variants): `hero-bg-*.{webp,avif}`, `flagship-device.webp` / `-card.webp`, `logo-silkway.webp` / `logo-silkway-sm.png`, `logo-silkway-mark.webp`, `water-tile-720.webp`.
3. **Code-split:** `lazy()` для Benefits, HomeSections, Catalog/Product/Info pages + `Suspense` fallback.
4. **Шрифты:** кастомные `fonts-inter.css` / `fonts-playfair.css` — только latin + cyrillic (+ latin-ext где нужно).
5. **Сцена / каталог:** `device.png` → `flagship-device.webp`; карточка HomeSections → `-card.webp`; WaterSurface tile → `water-tile-720.webp`.
6. **GET retries:** `src/lib/fetchRetry.ts` + unit; CMS live products/reviews/webinars.
7. **API Cache-Control:** публичные GET reviews/webinars могут отдавать короткий cache; `jsonResponse` не затирает явный Cache-Control; admin/webhook остаются no-store.
8. **vercel.json:** immutable cache для `/hero`, `/brand`, `/textures`, `/products`; HTML `max-age=0, must-revalidate`.
9. **Skills in-project:** `.agents/skills/{performance,core-web-vitals,vercel-react-best-practices}/` (без `skills-lock.json` в коммите).
10. **Benefits nav** (уже в `5b9ae89`): четыре ссылки на WaterSurface; WaterSpread не восстановлен; lazy Benefits совместим.

## Что сознательно не делали

- **Service Worker** — не оправдан на Hobby без чёткой стратегии invalidation; риск устаревшего HTML/API.
- **Перекодирование Hero JPG** — запрещено правилами (SHA).
- **WaterSpread / data-water-spread** — не возвращать.
- Изменения текстов, цен, PV, MAX admin security, Design/, Goods_images/, .env*.

## Остаточные возможности

1. Lab всё ещё тянет и mobile, и desktop Hero WebP/AVIF на одном viewport (preload+picture) — уточнить media / один LCP candidate.
2. Inter **latin-ext** ~85 KB — проверить, нужен ли полный диапазон для RU UI.
3. Generator PNG на Hero shelf (~470–500 KB) ещё не в WebP — следующий кандидат.
4. После деплоя на Vercel — повторить lab против prod URL и сверить CrUX/Search Console.

## Проверки

Команды: `lint`, `typecheck`, `build`, `bundle:api`, `test:unit` (+ `fetchRetry.unit.ts`), `check:contrast`, e2e: hero / benefits-nav / product-nav (SHA JPG через `path`).

## Коммит

`a66a3c9` on `main`.

Файлы perf + skills + report; **не** включать `skills-lock.json`, Design/, Goods_images/, `.env*`.
