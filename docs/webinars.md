# Вебинары: импорт из YouTube через бота MAX

Страница `#webinars` показывает только записи, которые модератор опубликовал в MAX. Данные отдаёт `GET /api/webinars`
(только публичные поля: id, title, speaker, date, sourceType, youtubeVideoId, startSeconds, recordingSrc).

## Режимы показа

- **A (по умолчанию) — YouTube.** Официальный плеер `https://www.youtube-nocookie.com/embed/<id>?rel=0&playsinline=1[&start=N]`,
  `loading="lazy"`, без автозапуска, `referrerpolicy="strict-origin-when-cross-origin"`, плюс ссылка «Смотреть на YouTube».
  Ролик не скачивается и не перекачивается. yt-dlp и обходы YouTube не используются.
- **B — свой файл.** Только если есть право размещать запись. Файл заранее загружается в Vercel Blob
  (`https://*.public.blob.vercel-storage.com/...`), импорт — через `scripts/webinar-import.ts --hosted-url`. Плеер `<video controls preload="metadata">`.

## Публикация в группе MAX

Первое слово — «Вебинар» (правило как у «Отзыв»), затем ссылка YouTube (youtube.com/watch, youtu.be, /live, /shorts, /embed; `t=` / `start=` → время старта).
Необязательные строки: `Название:` / `Тема:`, `Спикер:` / `Ведущий:`, `Дата:` (2026-11-05 или 05.11.2026).
Явные значения важнее данных YouTube; без названия берётся заголовок ролика, без даты — дата публикации ролика.

```
Вебинар
Название: Как выбрать шёлк
Спикер: Анна Петрова
Дата: 05.11.2026
https://youtu.be/dQw4w9WgXcQ?t=90
```

Бот создаёт запись `pending` и пишет модераторам «НОВЫЙ ВЕБИНАР В ГРУППЕ» с кнопками «Опубликовать», «Отклонить», «Проверить YouTube».
Повтор того же ролика — «ПОВТОР ВЕБИНАРА», новая запись не создаётся. Нет ссылки или она неверная — модератору приходит сообщение о проблеме.
Удаление сообщения в группе снимает вебинар (`withdrawn`); правка снимает и импортирует заново на модерацию.

## Проверка YouTube (YOUTUBE_API_KEY)

Если задан `YOUTUBE_API_KEY`, бот вызывает YouTube Data API v3 `videos.list` (part=snippet,status), таймаут 5,5 с.
Статусы: `ok`, `not_configured` (ключа нет — публиковать можно, проверка вручную), `not_found`, `not_public`
(эти два блокируют публикацию), `not_embeddable` (публиковать можно, на сайте останется ссылка), `api_error`.
Ключ: Google Cloud Console → включить YouTube Data API v3 → Credentials → API key, ограничить ключ этим API.

## Команды модератора (личный диалог)

- `/webinars_pending` — ожидающие вебинары (по 5, кнопки «Дальше»).
- `/webinars_published` — опубликованные, кнопка «Снять с сайта» с подтверждением.
- `/reviews_published` — опубликованные отзывы, «Снять с сайта» с подтверждением.

Все кнопки проверяют `MAX_REVIEW_MODERATOR_IDS`, в группе не работают; повторное нажатие отвечает «уже рассмотрен / уже снят».

## Админ-импорт без группы

```
npx tsx --env-file=.env.local scripts/webinar-import.ts --url "https://youtu.be/ID" --title "Тема" --speaker "Имя" --date 2026-11-05
```

Создаёт только `pending`, публикация — через MAX. Секреты не выводятся.

## Миграция

`db/migrations/004_webinars.up.sql` (откат — `004_webinars.down.sql`): `npm run db:migrate` с `DATABASE_URL` нужной базы.
