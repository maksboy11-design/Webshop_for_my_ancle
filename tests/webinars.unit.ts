import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePublishedWebinars, WebinarsUnavailable, youtubeEmbedUrl, youtubeWatchUrl } from '../src/cms/publishedWebinars'

describe('parsePublishedWebinars', () => {
  it('оставляет только публичные поля и проверенные источники', () => {
    const list = parsePublishedWebinars({
      webinars: [
        { id: 'a', title: 'Тема', speaker: 'Анна', date: '2026-11-05', sourceType: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', startSeconds: 30, recordingSrc: null, moderatorUserId: '42' },
        { id: 'b', title: 'Плохой id', sourceType: 'youtube', youtubeVideoId: '"><script>' },
        { id: 'c', title: 'Чужой файл', sourceType: 'hosted', recordingSrc: 'https://evil.example/a.mp4' },
        { id: 'd', title: 'Файл', sourceType: 'hosted', recordingSrc: 'https://abc.public.blob.vercel-storage.com/w.mp4', date: 'вчера' },
        { id: 'e', title: '', sourceType: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ' },
      ],
    })
    assert.deepEqual(list.map((item) => item.id), ['a', 'd'])
    assert.equal('moderatorUserId' in (list[0] ?? {}), false)
    assert.equal(list[1]?.date, null)
  })

  it('неверный ответ — ошибка, ссылки собираются без автозапуска', () => {
    assert.throws(() => parsePublishedWebinars({}), WebinarsUnavailable)
    assert.equal(youtubeEmbedUrl('dQw4w9WgXcQ', null), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1')
    assert.equal(youtubeWatchUrl('dQw4w9WgXcQ', 90), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s')
  })
})
