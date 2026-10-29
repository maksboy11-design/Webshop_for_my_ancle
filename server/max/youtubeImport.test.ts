import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyMessage } from './classify'
import {
  blocksPublication,
  fetchYoutubeMetadata,
  metadataFromResponse,
  parseStartTime,
  parseWebinarDate,
  parseWebinarFields,
  parseYoutubeUrl,
  watchUrl,
  type YoutubeFetch,
} from './youtubeImport'

const ID = 'dQw4w9WgXcQ'

describe('youtubeImport: ссылки', () => {
  it('принимает только официальные хосты и пути', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL1`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `http://youtu.be/${ID}`,
    ]) {
      assert.equal(parseYoutubeUrl(url)?.videoId, ID, url)
    }
  })

  it('отклоняет похожие и опасные адреса', () => {
    for (const url of [
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `https://evil.example/youtube.com/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
      `https://user@youtube.com/watch?v=${ID}`,
      `https://youtube.com:8443/watch?v=${ID}`,
      `javascript:alert('${ID}')`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch?v=${ID}&v=${ID}`,
      `https://www.youtube.com/embed/${ID}/x`,
      `https://youtu.be/${ID}x`,
      `ftp://youtu.be/${ID}`,
    ]) {
      assert.equal(parseYoutubeUrl(url), null, url)
    }
  })

  it('разбирает время начала', () => {
    assert.equal(parseYoutubeUrl(`https://youtu.be/${ID}?t=90`)?.startSeconds, 90)
    assert.equal(parseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.startSeconds, 90)
    assert.equal(parseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}`)?.startSeconds, null)
    assert.equal(parseStartTime('1h2m3s'), 3723)
    assert.equal(parseStartTime('abc'), null)
    assert.equal(watchUrl(ID, 90), `https://www.youtube.com/watch?v=${ID}&t=90s`)
  })
})

describe('youtubeImport: поля сообщения', () => {
  it('маркер «Вебинар» — первое слово без учёта регистра, отзыв остаётся отзывом', () => {
    assert.equal(classifyMessage(`ВЕБИНАР https://youtu.be/${ID}`, []).kind, 'webinar')
    assert.equal(classifyMessage(`вебинар: https://youtu.be/${ID}`, []).kind, 'webinar')
    assert.equal(classifyMessage(`Смотрите вебинар https://youtu.be/${ID}`, []).kind, 'text')
    assert.equal(classifyMessage('Отзыв: вебинар понравился', []).kind, 'review')
    assert.equal(classifyMessage('Вебинар', []).kind, 'empty')
  })

  it('явные «Спикер» и «Дата» читаются, свободная строка становится названием', () => {
    const parsed = parseWebinarFields(`Как выбрать шёлк\nСпикер: Анна Петрова\nДата: 05.11.2026\nhttps://youtu.be/${ID}?t=30`)
    assert.equal(parsed.title, 'Как выбрать шёлк')
    assert.equal(parsed.speaker, 'Анна Петрова')
    assert.equal(parsed.date, '2026-11-05')
    assert.deepEqual(parsed.ref, { videoId: ID, startSeconds: 30 })
  })

  it('неверная дата и ссылка не на YouTube отмечаются', () => {
    const parsed = parseWebinarFields('Тема\nДата: 31.02.2026\nhttps://vimeo.com/123')
    assert.equal(parsed.dateInvalid, true)
    assert.equal(parsed.ref, null)
    assert.equal(parseWebinarDate('2026-13-01'), null)
  })
})

describe('youtubeImport: метаданные', () => {
  it('без ключа не ходит в сеть и просит проверить вручную', async () => {
    let called = false
    const meta = await fetchYoutubeMetadata(ID, { apiKey: null, fetch: async () => { called = true; throw new Error('x') } })
    assert.equal(meta.status, 'not_configured')
    assert.equal(called, false)
  })

  it('ключ передаётся только в запросе и не попадает в результат при ошибке', async () => {
    const urls: string[] = []
    const failing: YoutubeFetch = async (url) => {
      urls.push(url)
      throw new Error(`network failure for ${url}`)
    }
    const meta = await fetchYoutubeMetadata(ID, { apiKey: 'SECRET-KEY-123', fetch: failing })
    assert.equal(meta.status, 'api_error')
    assert.equal(JSON.stringify(meta).includes('SECRET-KEY-123'), false)
    assert.equal(urls[0]?.startsWith('https://www.googleapis.com/youtube/v3/videos?'), true)
  })

  it('разбирает ответ videos.list', async () => {
    const ok: YoutubeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ snippet: { title: 'Ролик', publishedAt: '2026-10-01T10:00:00Z' }, status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' } }],
      }),
    })
    const meta = await fetchYoutubeMetadata(ID, { apiKey: 'k', fetch: ok })
    assert.equal(meta.status, 'ok')
    assert.equal(meta.title, 'Ролик')
    assert.equal(metadataFromResponse({ items: [] }).status, 'not_found')
    assert.equal(metadataFromResponse({ items: [{ status: { privacyStatus: 'private' } }] }).status, 'not_public')
    assert.equal(metadataFromResponse({ items: [{ status: { privacyStatus: 'public', embeddable: false } }] }).status, 'not_embeddable')
    assert.equal(blocksPublication('not_found'), true)
    assert.equal(blocksPublication('not_configured'), false)
  })
})
