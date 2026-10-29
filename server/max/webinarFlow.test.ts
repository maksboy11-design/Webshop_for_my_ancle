import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createLogger } from './logger'
import { createMemoryStore } from './memoryStore'
import type { InlineKeyboard, MaxClient } from './maxClient'

import { handleReviewsRequest } from './reviewsHttp'
import type { ReviewStore } from './store'
import { handleMaxWebhook, type HandlerDeps } from './webhookHandler'
import { handleWebinarsRequest } from './webinarsHttp'
import type { YoutubeFetch } from './youtubeImport'

const SECRET = 'unit-test-secret'
const ID = 'dQw4w9WgXcQ'
const API_KEY = 'TEST-YT-KEY-DO-NOT-LOG'
let stamp = 0

function user(id: number) {
  return { user_id: id, first_name: 'Тест', is_bot: false }
}

function dm(text: string, userId: number) {
  stamp += 1
  return {
    update_type: 'message_created',
    timestamp: 1_700_000_000_000 + stamp,
    message: {
      sender: user(userId),
      recipient: { chat_id: 500 + userId, chat_type: 'dialog', user_id: userId },
      timestamp: 1_700_000_000_000 + stamp,
      body: { mid: `mid.dm.${stamp}`, seq: 1, text },
    },
  }
}

function group(text: string, mid: string, type = 'message_created') {
  stamp += 1
  return {
    update_type: type,
    timestamp: 1_700_000_000_000 + stamp,
    message: {
      sender: user(7),
      recipient: { chat_id: 99, chat_type: 'chat', user_id: 7 },
      timestamp: 1_700_000_000_000 + stamp,
      body: { mid, seq: stamp, text },
    },
  }
}

function removed(mid: string) {
  stamp += 1
  return { update_type: 'message_removed', timestamp: 1_700_000_000_000 + stamp, message_id: mid, chat_id: 99, user_id: 7 }
}

function callback(payload: string, userId = 42, chatType: 'dialog' | 'chat' = 'dialog') {
  stamp += 1
  return {
    update_type: 'message_callback',
    timestamp: 1_700_000_000_000 + stamp,
    callback: { timestamp: 1_700_000_000_000 + stamp, callback_id: `cb.${stamp}`, payload, user: user(userId) },
    message: {
      sender: { user_id: 1, first_name: 'Бот', is_bot: true },
      recipient: { chat_id: 500 + userId, chat_type: chatType },
      timestamp: 1_700_000_000_000,
      body: { mid: 'mid.keyboard', seq: 1, text: 'кнопки' },
    },
  }
}

function fakeMax(): MaxClient & { texts: string[]; payloads: string[]; reset(): void } {
  const texts: string[] = []
  const payloads: string[] = []
  const keep = (kb: InlineKeyboard | null) => {
    for (const row of kb?.payload.buttons ?? []) {
      for (const b of row) {
        if ('payload' in b && typeof b.payload === 'string') payloads.push(b.payload)
      }
    }
  }
  return {
    texts,
    payloads,
    reset() {
      texts.length = 0
      payloads.length = 0
    },
    async sendMessage(input) {
      texts.push(input.text ?? '')
      keep(input.attachments)
    },
    async answerCallback(input) {
      texts.push(input.text ?? '')
      keep(input.attachments)
    },
    async getMessage() {
      return null
    },
  }
}

function youtube(status: 'ok' | 'missing' = 'ok'): YoutubeFetch & { calls: number } {
  const fn = (async () => {
    fn.calls += 1
    return {
      ok: true,
      status: 200,
      json: async () =>
        status === 'missing'
          ? { items: [] }
          : {
              items: [
                {
                  snippet: { title: 'Название из YouTube', publishedAt: '2026-09-15T10:00:00Z' },
                  status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' },
                },
              ],
            },
    }
  }) as unknown as YoutubeFetch & { calls: number }
  fn.calls = 0
  return fn
}

function deps(store: ReviewStore, max: MaxClient, extra: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    secret: SECRET,
    secretConfigured: true,
    moderators: new Set(['42']),
    moderatorsConfigured: true,
    store,
    max,
    now: () => new Date('2026-10-24T08:00:00.000Z'),
    sleep: async () => {},
    log: createLogger(),
    rateLimit: { max: 100, windowMs: 600_000 },
    groupRateLimit: { max: 100, windowMs: 600_000 },
    allowedChatIds: new Set(['99']),
    allowedChatsConfigured: true,
    sessionTtlMs: 30 * 60 * 1000,
    deliveryBudgetMs: 60_000,
    blobToken: null,
    youtubeApiKey: API_KEY,
    ...extra,
  }
}

async function post(handlerDeps: HandlerDeps, body: unknown) {
  const response = await handleMaxWebhook(
    new Request('https://silkway.local/api/max/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': SECRET },
      body: JSON.stringify(body),
    }),
    handlerDeps,
  )
  assert.equal(response.status, 200)
}

async function publicWebinars(store: ReviewStore) {
  const response = await handleWebinarsRequest(new Request('https://silkway.local/api/webinars'), { store, log: createLogger() })
  return ((await response.json()) as { webinars: Record<string, unknown>[] }).webinars
}

function idFrom(payloads: string[], prefix: string): string {
  const found = payloads.find((p) => p.startsWith(prefix))
  assert.ok(found, `нет кнопки ${prefix}`)
  return found.slice(prefix.length)
}

describe('вебинары и снятие отзывов через MAX', { concurrency: 1 }, () => {
  const originalInfo = console.info
  const originalError = console.error
  const lines: string[] = []
  beforeEach(() => {
    lines.length = 0
    console.info = (...args: unknown[]) => lines.push(args.map(String).join(' '))
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  })
  afterEach(() => {
    console.info = originalInfo
    console.error = originalError
  })

  it('«Вебинар» из группы → DM модератору → публикация → API → снятие с подтверждением', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const yt = youtube()
    const d = deps(store, max, { youtubeFetch: yt })
    await post(d, group(`Вебинар\nСпикер: Анна\nhttps://youtu.be/${ID}?t=45`, 'mid.w1'))
    assert.equal(yt.calls, 1)
    assert.deepEqual(await publicWebinars(store), [])
    const dmText = max.texts.join('\n')
    assert.match(dmText, /НОВЫЙ ВЕБИНАР/)
    assert.match(dmText, /Название из YouTube \(взято из YouTube/)
    assert.match(dmText, /Спикер: Анна/)
    assert.match(dmText, /Дата: 2026-09-15/)
    const id = idFrom(max.payloads, 'm:wa:')
    assert.equal(max.payloads.includes(`m:wr:${id}`), true)

    // обычный пользователь не может опубликовать
    max.reset()
    await post(d, callback(`m:wa:${id}`, 7))
    assert.match(max.texts.join(), /недоступна/)
    // модератор в группе тоже нет
    await post(d, callback(`m:wa:${id}`, 42, 'chat'))
    assert.deepEqual(await publicWebinars(store), [])

    max.reset()
    await post(d, callback(`m:wa:${id}`))
    assert.match(max.texts.join(), /опубликован на сайте/)
    const listed = await publicWebinars(store)
    assert.equal(listed.length, 1)
    assert.deepEqual(listed[0], {
      id,
      title: 'Название из YouTube',
      speaker: 'Анна',
      date: '2026-09-15',
      sourceType: 'youtube',
      youtubeVideoId: ID,
      startSeconds: 45,
      recordingSrc: null,
    })
    // устаревшая кнопка: повторная публикация ничего не ломает
    max.reset()
    await post(d, callback(`m:wa:${id}`))
    assert.match(max.texts.join(), /уже рассмотрен/)

    // список опубликованных и снятие с подтверждением
    max.reset()
    await post(d, dm('/webinars_published', 42))
    assert.equal(max.payloads.includes(`m:ww:${id}`), true)
    max.reset()
    await post(d, callback(`m:ww:${id}`))
    assert.equal(max.payloads.includes(`m:wc:${id}`), true)
    assert.equal(max.payloads.includes('m:x'), true)
    assert.equal((await publicWebinars(store)).length, 1)
    await post(d, callback(`m:wc:${id}`, 7))
    assert.equal((await publicWebinars(store)).length, 1)
    max.reset()
    await post(d, callback(`m:wc:${id}`))
    assert.match(max.texts.join(), /снят с сайта\. Запись сохранена/)
    assert.deepEqual(await publicWebinars(store), [])
    const row = await store.transaction((tx) => tx.getWebinar(id))
    assert.equal(row?.status, 'withdrawn')
    max.reset()
    await post(d, callback(`m:wc:${id}`))
    assert.match(max.texts.join(), /уже снят/)

    const logged = lines.join('\n')
    assert.equal(logged.includes(API_KEY), false)
    assert.equal(logged.includes('Анна'), false)
  })

  it('без ключа YouTube модератор получает просьбу проверить вручную, явные поля сохраняются', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const yt = youtube()
    const d = deps(store, max, { youtubeApiKey: null, youtubeFetch: yt })
    await post(d, group(`вебинар Уход за шёлком\nДата: 2026-11-05\nhttps://www.youtube.com/watch?v=${ID}`, 'mid.w2'))
    assert.equal(yt.calls, 0)
    const text = max.texts.join('\n')
    assert.match(text, /Название: Уход за шёлком/)
    assert.match(text, /Дата: 2026-11-05/)
    assert.match(text, /вручную/i)
  })

  it('ссылка не на YouTube, повтор ролика, отклонение и удалённое видео', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const d = deps(store, max, { youtubeFetch: youtube('missing') })
    await post(d, group('Вебинар Тема\nhttps://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'mid.bad'))
    assert.match(max.texts.join(), /НЕ ИМПОРТИРОВАН/)
    assert.equal(max.payloads.some((p) => p.startsWith('m:wa:')), false)

    max.reset()
    await post(d, group(`Вебинар Тема\nhttps://youtu.be/${ID}`, 'mid.w3'))
    const id = idFrom(max.payloads, 'm:wa:')
    max.reset()
    await post(d, callback(`m:wa:${id}`))
    assert.match(max.texts.join(), /не прошёл проверку/)
    assert.deepEqual(await publicWebinars(store), [])

    max.reset()
    await post(d, group(`Вебинар Тема ещё раз\nhttps://youtu.be/${ID}`, 'mid.w4'))
    assert.match(max.texts.join(), /ПОВТОР ВЕБИНАРА/)

    max.reset()
    await post(d, callback(`m:wr:${id}`))
    assert.match(max.texts.join(), /отклонён/)
    max.reset()
    await post(d, callback(`m:wr:${id}`))
    assert.match(max.texts.join(), /уже рассмотрен/)
    max.reset()
    await post(d, callback('m:wa:not-a-uuid'))
    assert.match(max.texts.join(), /Некорректный/)
  })

  it('правка и удаление исходного сообщения снимают вебинар с сайта', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const d = deps(store, max, { youtubeFetch: youtube() })
    await post(d, group(`Вебинар Тема\nhttps://youtu.be/${ID}`, 'mid.w5'))
    const id = idFrom(max.payloads, 'm:wa:')
    await post(d, callback(`m:wa:${id}`))
    assert.equal((await publicWebinars(store)).length, 1)
    max.reset()
    await post(d, group(`Вебинар Новая тема\nhttps://youtu.be/${ID}`, 'mid.w5', 'message_edited'))
    assert.deepEqual(await publicWebinars(store), [])
    assert.match(max.texts.join(), /НОВЫЙ ВЕБИНАР/)
    assert.match(max.texts.join(), /Новая тема/)
    const again = idFrom(max.payloads, 'm:wa:')
    await post(d, callback(`m:wa:${again}`))
    assert.equal((await publicWebinars(store)).length, 1)
    await post(d, removed('mid.w5'))
    assert.deepEqual(await publicWebinars(store), [])
  })

  it('«Проверить YouTube» обновляет метаданные только у модератора', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const yt = youtube()
    const d = deps(store, max, { youtubeApiKey: null, youtubeFetch: yt })
    await post(d, group(`Вебинар\nhttps://youtu.be/${ID}`, 'mid.w6'))
    const id = idFrom(max.payloads, 'm:wa:')
    const withKey = { ...d, youtubeApiKey: API_KEY }
    await post(withKey, callback(`m:wm:${id}`, 7))
    assert.equal(yt.calls, 0)
    max.reset()
    await post(withKey, callback(`m:wm:${id}`))
    assert.equal(yt.calls, 1)
    assert.match(max.texts.join(), /Название из YouTube/)
    const row = await store.transaction((tx) => tx.getWebinar(id))
    assert.equal(row?.metadataStatus, 'ok')
    assert.equal(row?.title, 'Название из YouTube')
  })

  it('/webinars_pending и /reviews_published недоступны обычному пользователю', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const d = deps(store, max)
    for (const command of ['/webinars_pending', '/webinars_published', '/reviews_published']) {
      max.reset()
      await post(d, dm(command, 7))
      assert.match(max.texts.join(), /недоступна/, command)
    }
    max.reset()
    await post(d, dm('/webinars_pending', 42))
    assert.match(max.texts.join(), /Вебинаров на проверке нет/)
    for (const payload of ['m:pl:0', 'm:wq:0', 'm:wl:0', 'm:pc:00000000-0000-4000-8000-000000000000']) {
      max.reset()
      await post(d, callback(payload, 7))
      assert.match(max.texts.join(), /недоступна/, payload)
    }
  })

  it('снятие опубликованного отзыва: Mini App вход + callback withdraw (обратная совместимость)', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const d = deps(store, max)
    await post(d, group('Отзыв: СНЯТИЕ_ТЕКСТ_11', 'mid.r1'))
    const saved = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.r1'))
    await post(d, dm(`/review_approve ${saved?.id} flagship`, 42))
    const api = async () =>
      ((await (await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=flagship'), { store, log: createLogger() })).json()) as {
        reviews: { id: string }[]
      }).reviews
    assert.equal((await api()).length, 1)
    max.reset()
    await post(d, dm('/reviews_published', 42))
    assert.match(max.texts.join(), /мини-приложении|Мини-приложение/i)
    const reviewId = (await api())[0]!.id
    max.reset()
    await post(d, callback(`m:pw:${reviewId}`))
    assert.equal(max.payloads.includes(`m:pc:${reviewId}`), true)
    assert.equal((await api()).length, 1)
    await post(d, callback(`m:pc:${reviewId}`, 7))
    assert.equal((await api()).length, 1)
    max.reset()
    await post(d, callback(`m:pc:${reviewId}`))
    assert.match(max.texts.join(), /Отзыв снят с сайта\. Запись сохранена в базе/)
    assert.equal((await api()).length, 0)
    max.reset()
    await post(d, callback(`m:pc:${reviewId}`))
    assert.match(max.texts.join(), /уже снят/)
    max.reset()
    await post(d, dm('/reviews_published', 42))
    assert.match(max.texts.join(), /мини-приложении|Мини-приложение/i)
  })


  it('GET /api/webinars отвечает только на GET и без хранилища даёт 503', async () => {
    const post405 = await handleWebinarsRequest(new Request('https://silkway.local/api/webinars', { method: 'POST' }), { store: createMemoryStore(), log: createLogger() })
    assert.equal(post405.status, 405)
    const none = await handleWebinarsRequest(new Request('https://silkway.local/api/webinars'), { store: null, log: createLogger() })
    assert.equal(none.status, 503)
  })
})
