import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createLogger } from './logger'
import { createMemoryStore } from './memoryStore'
import { createMaxClient, MaxPermanentError, MaxTemporaryError, type InlineKeyboard, type KeyboardButton, type MaxClient } from './maxClient'

import { notificationKeyboard } from './moderatorNotify'
import { handleReviewsRequest } from './reviewsHttp'
import type { ReviewStore } from './store'
import { handleMaxWebhook, type HandlerDeps } from './webhookHandler'

const SECRET = 'unit-test-secret'
const REVIEW = 'UNIQUE_REVIEW_TEXT_9f3a <script>alert(1)</script>'

function user(id = 7) {
  return { user_id: id, first_name: 'Тест', is_bot: false }
}

function message(text: string | null, mid: string, userId = 7, chatType: 'dialog' | 'chat' = 'dialog', attachments?: unknown[]) {
  return {
    update_type: 'message_created',
    timestamp: 1_700_000_000_000,
    message: {
      sender: user(userId),
      recipient: { chat_id: 99, chat_type: chatType, user_id: userId },
      timestamp: 1_700_000_000_000,
      body: { mid, seq: 1, text, attachments: attachments ?? null },
    },
  }
}

function groupMessage(
  text: string | null,
  mid: string,
  chatId = 99,
  attachments?: unknown[],
  timestamp = 1_700_000_000_000,
) {
  return {
    update_type: 'message_created' as string,
    timestamp,
    message: {
      sender: user(),
      recipient: { chat_id: chatId, chat_type: 'chat' as const, user_id: 7 },
      timestamp,
      body: { mid, seq: 1, text, attachments: attachments ?? null },
    },
  }
}

function callback(callbackId: string, payload: string, userId = 7, timestamp = 1_700_000_000_100) {
  return {
    update_type: 'message_callback',
    timestamp,
    callback: { timestamp, callback_id: callbackId, payload, user: user(userId) },
    message: {
      sender: { user_id: 1, first_name: 'Бот', is_bot: true },
      recipient: { chat_id: 99, chat_type: 'dialog' },
      timestamp: 1_700_000_000_000,
      body: { mid: 'mid.keyboard', seq: 1, text: 'кнопки' },
    },
  }
}

function fakeMax(failOnCall = 0): MaxClient & { texts: string[]; payloads: string[] } {
  const texts: string[] = []
  const payloads: string[] = []
  const keep = (kb: InlineKeyboard | null) => {
    for (const row of kb?.payload.buttons ?? []) {
      for (const b of row) {
        if ('payload' in b && typeof b.payload === 'string') payloads.push(b.payload)
      }
    }
  }
  let call = 0
  const guard = async (text: string | null) => {
    call += 1
    if (call === failOnCall) throw new MaxTemporaryError(503)
    texts.push(text ?? '')
  }
  return {
    texts,
    payloads,
    async sendMessage(input) {
      await guard(input.text)
      keep(input.attachments)
    },
    async answerCallback(input) {
      await guard(input.text)
      keep(input.attachments)
    },
    async getMessage() {
      return null
    },
  }
}

function deps(store: ReviewStore | null, max: MaxClient | null, extra: Partial<HandlerDeps> = {}): HandlerDeps {
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
    rateLimit: { max: 20, windowMs: 600_000 },
    groupRateLimit: { max: 60, windowMs: 600_000 },
    allowedChatIds: new Set<string>(),
    allowedChatsConfigured: false,
    sessionTtlMs: 30 * 60 * 1000,
    deliveryBudgetMs: 60_000,
    blobToken: null,
    ...extra,
  }
}

function post(handlerDeps: HandlerDeps, body: unknown, secret: string | null = SECRET) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret !== null) headers.set('x-max-bot-api-secret', secret)
  return handleMaxWebhook(
    new Request('https://silkway.local/api/max/webhook', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    handlerDeps,
  )
}

async function submit(handlerDeps: HandlerDeps, text = REVIEW, stamp = 1) {
  assert.equal((await post(handlerDeps, message('/review', `mid.review.${stamp}`))).status, 200)
  assert.equal((await post(handlerDeps, callback(`cb.product.${stamp}`, 'p:flagship', 7, 1_700_000_001_000 + stamp))).status, 200)
  assert.equal((await post(handlerDeps, message(text, `mid.text.${stamp}`))).status, 200)
  assert.equal((await post(handlerDeps, callback(`cb.name.${stamp}`, 'skip', 7, 1_700_000_002_000 + stamp))).status, 200)
}

describe('MAX webhook', { concurrency: 1 }, () => {
  const originalInfo = console.info
  const originalError = console.error
  const lines: string[] = []

  afterEach(() => {
    console.info = originalInfo
    console.error = originalError
  })

  function captureLogs() {
    lines.length = 0
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
  }

  it('принимает верный секрет и сохраняет отзыв только после согласия', async () => {
    captureLogs()
    const store = createMemoryStore()
    const max = fakeMax()
    const handlerDeps = deps(store, max)
    await submit(handlerDeps, REVIEW, 1)
    assert.equal((await post(handlerDeps, callback('cb.no', 'no', 7, 1_700_000_000_102))).status, 200)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 0)
    assert.equal((await post(handlerDeps, callback('cb.yes', 'yes', 7, 1_700_000_000_103))).status, 200)
    const pending = await store.transaction((tx) => tx.listPending(10))
    assert.equal(pending.length, 0)

    await submit(handlerDeps, REVIEW, 2)
    assert.equal((await post(handlerDeps, callback('cb.yes2', 'yes', 7, 1_700_000_000_104))).status, 200)
    const saved = await store.transaction((tx) => tx.listPending(10))
    assert.equal(saved.length, 1)
    assert.equal(saved[0]?.text, REVIEW)
    assert.equal(saved[0]?.author, null)
    assert.equal((await store.listPublished('flagship')).length, 0)
    assert.equal(lines.join('\n').includes(REVIEW), false)
    assert.equal(lines.join('\n').includes(SECRET), false)
  })

  it('отклоняет отсутствующий и неверный секрет, не читая хранилище', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax())
    const missing = await post(handlerDeps, message('/review', 'mid.a'), null)
    const wrong = await post(handlerDeps, message('/review', 'mid.b'), 'wrong-secret')
    assert.equal(missing.status, 401)
    assert.equal(wrong.status, 401)
    assert.equal((await store.transaction((tx) => tx.countPending())).valueOf(), 0)
  })

  it('отклоняет некорректный JSON и слишком большое тело', async () => {
    const handlerDeps = deps(createMemoryStore(), fakeMax())
    const broken = await post(handlerDeps, '{')
    assert.equal(broken.status, 400)
    const huge = await handleMaxWebhook(
      new Request('https://silkway.local/api/max/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': SECRET },
        body: `{"update_type":"bot_started","pad":"${'x'.repeat(300_000)}"}`,
      }),
      handlerDeps,
    )
    assert.equal(huge.status, 413)
  })

  it('игнорирует неподдерживаемый тип и чужой чат', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax())
    const ignored = await post(handlerDeps, { update_type: 'dialog_muted', timestamp: 1 })
    assert.equal(ignored.status, 200)
    const group = await post(handlerDeps, message(REVIEW, 'mid.group', 7, 'chat'))
    assert.equal(group.status, 200)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 0)
  })

  it('не сохраняет отзыв для неизвестного товара и опасный текст хранит как текст', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax())
    await post(handlerDeps, message('/review', 'mid.review'))
    const invalid = await post(handlerDeps, callback('cb.bad', 'p:not-a-product'))
    assert.equal(invalid.status, 200)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 0)
    const hostile = `'); DROP TABLE product_reviews; --`
    await submit(handlerDeps, hostile)
    await post(handlerDeps, callback('cb.yes', 'yes', 7, 1_700_000_000_105))
    const pending = await store.transaction((tx) => tx.listPending(10))
    assert.equal(pending[0]?.text, hostile)
    assert.equal(pending[0]?.productId, 'flagship')
  })

  it('повторная доставка не создаёт второй отзыв', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax())
    await submit(handlerDeps)
    const yes = callback('cb.yes', 'yes', 7, 1_700_000_000_106)
    assert.equal((await post(handlerDeps, yes)).status, 200)
    assert.equal((await post(handlerDeps, yes)).status, 200)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 1)
  })

  it('при ошибке базы не подтверждает событие', async () => {
    const store: ReviewStore = {
      transaction() {
        throw new Error('db down')
      },
      listPublished: async () => [],
      listPendingOutbox: async () => [],
      claimSend: async () => 'missing',
      deleteOutbox: async () => {},
      releaseOutbox: async () => {},
      getGroupContent: async () => null,
      updateGroupAttachments: async () => {},
      listPublicWebinars: async () => [],
    }
    captureLogs()
    const response = await post(deps(store, fakeMax()), message('/review', 'mid.db'))
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(JSON.stringify(body).includes('db down'), false)
    assert.equal(lines.join('\n').includes('db down'), false)
  })

  it('обычный пользователь и пустой список модераторов не публикуют отзыв', async () => {
    const store = createMemoryStore()
    const max = fakeMax()
    const handlerDeps = deps(store, max)
    await submit(handlerDeps)
    await post(handlerDeps, callback('cb.yes', 'yes', 7, 1_700_000_000_107))
    const id = (await store.transaction((tx) => tx.listPending(1)))[0]?.id
    assert.ok(id)
    await post(handlerDeps, message(`/review_approve ${id}`, 'mid.user', 7))
    assert.equal((await store.listPublished(null)).length, 0)
    const closed = deps(store, max, { moderatorsConfigured: false, moderators: new Set() })
    await post(closed, message(`/review_approve ${id}`, 'mid.closed', 42))
    assert.equal((await store.listPublished(null)).length, 0)
    await post(handlerDeps, message(`/review_approve ${id}`, 'mid.mod', 42))
    const published = await store.listPublished('flagship')
    assert.equal(published.length, 1)
    assert.deepEqual(Object.keys(published[0] ?? {}).sort(), ['author', 'id', 'media', 'productId', 'text'])
    assert.deepEqual(published[0]?.media, [])
    const rejectedStore = createMemoryStore()
    const rejectedDeps = deps(rejectedStore, fakeMax())
    await submit(rejectedDeps, 'Текст для отклонения')
    await post(rejectedDeps, callback('cb.yes', 'yes', 7, 1_700_000_000_108))
    const rejectId = (await rejectedStore.transaction((tx) => tx.listPending(1)))[0]?.id
    await post(rejectedDeps, message(`/review_reject ${rejectId}`, 'mid.reject', 42))
    assert.equal((await rejectedStore.listPublished(null)).length, 0)
  })

  it('повторяет отправку ответа MAX после временной ошибки и не теряет отзыв', async () => {
    const store = createMemoryStore()
    const max = fakeMax(5)
    const handlerDeps = deps(store, max)
    await submit(handlerDeps)
    const yes = callback('cb.yes', 'yes', 7, 1_700_000_000_109)
    assert.equal((await post(handlerDeps, yes)).status, 503)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 1)
    assert.equal((await post(handlerDeps, yes)).status, 200)
    assert.equal((await store.transaction((tx) => tx.listPending(10))).length, 1)
    assert.equal(max.texts.some((text) => text.includes('принят на модерацию')), true)
  })

  it('публичный API читает только опубликованные отзывы и не принимает POST', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax())
    await submit(handlerDeps, REVIEW)
    await post(handlerDeps, callback('cb.yes', 'yes', 7, 1_700_000_000_110))
    const hidden = await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=flagship'), {
      store,
      log: createLogger(),
    })
    assert.equal(hidden.status, 200)
    assert.deepEqual(await hidden.json(), { reviews: [] })
    const id = (await store.transaction((tx) => tx.listPending(1)))[0]?.id
    await post(handlerDeps, message(`/review_approve ${id}`, 'mid.pub', 42))
    const visible = await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=flagship'), {
      store,
      log: createLogger(),
    })
    const payload = (await visible.json()) as { reviews: Record<string, unknown>[] }
    assert.equal(payload.reviews.length, 1)
    assert.deepEqual(Object.keys(payload.reviews[0] ?? {}).sort(), ['author', 'id', 'media', 'productId', 'text'])
    assert.deepEqual(payload.reviews[0]?.media, [])
    assert.equal(payload.reviews[0]?.text, REVIEW)
    const other = await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=tea'), {
      store,
      log: createLogger(),
    })
    assert.deepEqual(await other.json(), { reviews: [] })
    const unknown = await handleReviewsRequest(new Request("https://silkway.local/api/reviews?productId=flagship'%20OR%201=1"), {
      store,
      log: createLogger(),
    })
    assert.equal(unknown.status, 400)
    const posted = await handleReviewsRequest(
      new Request('https://silkway.local/api/reviews', { method: 'POST', body: '{}' }),
      { store, log: createLogger() },
    )
    assert.equal(posted.status, 405)
  })

  it('принимает отзыв только из разрешённой группы и не публикует его сам', async () => {
    captureLogs()
    const store = createMemoryStore()
    const max = fakeMax()
    const handlerDeps = deps(store, max, { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    const foreign = await post(handlerDeps, groupMessage('Отзыв: чужая группа', 'mid.foreign', 100))
    assert.equal(foreign.status, 200)
    assert.equal(await store.transaction((tx) => tx.findGroupMessage('100', 'mid.foreign')), null)

    const created = await post(handlerDeps, groupMessage('  ОТЗЫВ: Всё понравилось', 'mid.review'))
    assert.equal(created.status, 200)
    assert.equal((await post(handlerDeps, groupMessage('  ОТЗЫВ: Всё понравилось', 'mid.review'))).status, 200)
    const saved = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.review'))
    assert.equal(saved?.kind, 'review')
    assert.equal(saved?.publicText, 'Всё понравилось')
    assert.equal(saved?.status, 'pending')
    assert.equal((await store.listPublished('flagship')).length, 0)

    const ordinary = await post(handlerDeps, groupMessage('Отзывчивый сервис и наш отзыв о товаре', 'mid.word'))
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.word')))?.kind, 'text')
    assert.equal((await store.transaction((tx) => tx.listPendingGroup(10))).length, 1)

    const id = saved?.id
    assert.ok(id)
    await post(handlerDeps, message(`/review_approve ${id}`, 'mid.user', 7))
    await post(handlerDeps, message(`/review_approve ${id}`, 'mid.mod-short', 42))
    assert.equal((await store.listPublished(null)).length, 0)
    await post(handlerDeps, message(`/review_approve ${id} flagship`, 'mid.mod', 42))
    const published = await store.listPublished('flagship')
    assert.equal(published.length, 1)
    assert.equal(published[0]?.text, 'Всё понравилось')
    assert.equal(JSON.stringify(published[0]).includes('sender'), false)
    const logged = lines.join('\n')
    assert.equal(logged.includes('Всё понравилось'), false)
    assert.equal(logged.includes(SECRET), false)
    assert.equal(ordinary.status, 200)
  })

  it('сохраняет фото и видео вместе с текстом и не скачивает url', async () => {
    captureLogs()
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    const image = { type: 'image', payload: { photo_id: 5, token: 'img-token-test', url: 'http://127.0.0.1/secret.jpg' } }
    const video = { type: 'video', payload: { token: 'vid-token-test', url: 'http://169.254.169.254/latest', width: 320, height: 240, duration: 4 } }
    const file = { type: 'file', payload: { url: 'http://127.0.0.1/file.bin', token: 'file-token' } }
    assert.equal((await post(handlerDeps, groupMessage('Отзыв', 'mid.photo', 99, [image]))).status, 200)
    const photo = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.photo'))
    assert.equal(photo?.kind, 'review')
    assert.equal(photo?.publicText, null)
    assert.equal(photo?.attachments[0]?.token, 'img-token-test')
    assert.equal(JSON.stringify(photo?.attachments).includes('127.0.0.1'), false)
    const photoId = photo?.id
    assert.ok(photoId)
    const denied = await post(handlerDeps, message(`/review_approve ${photoId} flagship`, 'mid.photo-approve', 42))
    assert.equal(denied.status, 200)
    assert.equal((await store.listPublished(null)).length, 0)

    assert.equal((await post(handlerDeps, groupMessage('ОТЗЫВ:', 'mid.video', 99, [video]))).status, 200)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.video')))?.kind, 'review')
    assert.equal((await post(handlerDeps, groupMessage('Смотрите', 'mid.mixed', 99, [image, video]))).status, 200)
    const mixed = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.mixed'))
    assert.equal(mixed?.kind, 'mixed')
    assert.equal(mixed?.attachments.length, 2)
    assert.equal((await post(handlerDeps, groupMessage(null, 'mid.only-image', 99, [image]))).status, 200)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.only-image')))?.kind, 'image')
    assert.equal((await post(handlerDeps, groupMessage(null, 'mid.only-video', 99, [video]))).status, 200)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.only-video')))?.kind, 'video')
    assert.equal((await post(handlerDeps, groupMessage('Отзыв', 'mid.empty'))).status, 200)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.empty')))?.status, 'empty')
    assert.equal((await post(handlerDeps, groupMessage(null, 'mid.file', 99, [file]))).status, 200)
    const unsupported = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.file'))
    assert.equal(unsupported?.kind, 'unsupported')
    assert.equal(JSON.stringify(unsupported).includes('file-token'), false)
    assert.equal(lines.join('\n').includes('img-token-test'), false)
    assert.equal(lines.join('\n').includes('vid-token-test'), false)
  })

  it('редактирует и снимает с публикации исходную запись группы', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    await post(handlerDeps, groupMessage('Отзыв: Первая версия', 'mid.sync', 99, undefined, 1_700_000_003_000))
    const id = (await store.transaction((tx) => tx.findGroupMessage('99', 'mid.sync')))?.id
    assert.ok(id)
    await post(handlerDeps, message(`/review_approve ${id} flagship`, 'mid.sync-approve', 42))
    assert.equal((await store.listPublished('flagship')).length, 1)
    const edited = groupMessage('Отзыв: Вторая версия', 'mid.sync', 99, undefined, 1_700_000_003_100)
    edited.update_type = 'message_edited'
    assert.equal((await post(handlerDeps, edited)).status, 200)
    assert.equal((await store.listPublished('flagship')).length, 0)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.sync')))?.publicText, 'Вторая версия')
    assert.equal((await store.transaction((tx) => tx.listPendingGroup(5))).length, 1)
    await post(handlerDeps, message(`/review_approve ${id} flagship`, 'mid.sync-approve-2', 42))
    assert.equal((await store.listPublished('flagship'))[0]?.text, 'Вторая версия')
    const removed = {
      update_type: 'message_removed',
      timestamp: 1_700_000_003_200,
      message_id: 'mid.sync',
      chat_id: 99,
      user_id: 7,
    }
    assert.equal((await post(handlerDeps, removed)).status, 200)
    assert.equal((await post(handlerDeps, removed)).status, 200)
    assert.equal((await store.listPublished('flagship')).length, 0)
    assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.sync')))?.status, 'removed')
  })

  it('при перегрузе группы не подтверждает новое сообщение', async () => {
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax(), {
      allowedChatIds: new Set(['99']),
      allowedChatsConfigured: true,
      groupRateLimit: { max: 1, windowMs: 600_000 },
    })
    assert.equal((await post(handlerDeps, groupMessage('Обычный текст', 'mid.one'))).status, 200)
    const deferred = await post(handlerDeps, groupMessage('Отзыв: второй', 'mid.two', 99, undefined, 1_700_000_004_000))
    assert.equal(deferred.status, 503)
    assert.equal(await store.transaction((tx) => tx.findGroupMessage('99', 'mid.two')), null)
  })

  it('цепочка: эмодзи-отзыв из группы → очередь → одобрение → публичный API', async () => {
    captureLogs()
    const store = createMemoryStore()
    const max = fakeMax()
    const handlerDeps = deps(store, max, { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    const image = { type: 'image', payload: { photo_id: 5, token: 'img-token-chain', url: 'https://i.oneme.ru/a.jpg' } }
    const other = { type: 'image', payload: { photo_id: 6, token: 'img-token-two', url: 'https://i.oneme.ru/b.jpg' } }
    const text = '🩵Отзыв от партнера: ЦЕПОЧКА_ТЕКСТ_77'
    assert.equal((await post(handlerDeps, groupMessage(text, 'mid.chain', 99, [image, other]))).status, 200)
    // повторная доставка того же события не создаёт дубль
    assert.equal((await post(handlerDeps, groupMessage(text, 'mid.chain', 99, [image, other]))).status, 200)
    const saved = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.chain'))
    assert.equal(saved?.kind, 'review')
    assert.equal(saved?.status, 'pending')
    assert.equal(saved?.attachments.length, 2)
    assert.equal(saved?.publicText, 'от партнера: ЦЕПОЧКА_ТЕКСТ_77')
    assert.equal((await store.transaction((tx) => tx.listPendingGroup(10))).length, 1)
    // до решения модератора публичный API пуст
    const before = await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=flagship'), { store, log: createLogger() })
    assert.deepEqual(await before.json(), { reviews: [] })
    // модератор видит запись в очереди, обычный участник — нет
    await post(handlerDeps, message('/reviews_pending', 'mid.q-user', 7))
    // новый отзыв один раз ушёл модератору; повторная доставка не дублирует DM
    assert.equal(max.texts.filter((item) => item.includes('ЦЕПОЧКА_ТЕКСТ_77')).length, 1)
    max.texts.length = 0
    await post(handlerDeps, message('/reviews_pending', 'mid.q-user2', 7))
    assert.equal(max.texts.some((item) => item.includes('ЦЕПОЧКА_ТЕКСТ_77')), false)
    await post(handlerDeps, message('/reviews_pending', 'mid.q-mod', 42))
    assert.equal(max.texts.some((item) => item.includes('ЦЕПОЧКА_ТЕКСТ_77')), true)
    await post(handlerDeps, message(`/review_approve ${saved?.id} flagship`, 'mid.chain-approve', 42))
    const after = await handleReviewsRequest(new Request('https://silkway.local/api/reviews?productId=flagship'), { store, log: createLogger() })
    const payload = (await after.json()) as { reviews: { text: string }[] }
    assert.equal(payload.reviews.length, 1)
    assert.equal(payload.reviews[0]?.text, 'от партнера: ЦЕПОЧКА_ТЕКСТ_77')
    const logged = lines.join('\n')
    assert.equal(logged.includes('ЦЕПОЧКА_ТЕКСТ_77'), false)
    assert.equal(logged.includes('img-token-chain'), false)
    assert.equal(logged.includes('"event":"group_intake"'), true)
    assert.equal(logged.includes('"kind":"review"'), true)
  })

  it('прочий контент группы виден модератору только для просмотра и не публикуется', async () => {
    captureLogs()
    const store = createMemoryStore()
    const max = fakeMax()
    const handlerDeps = deps(store, max, { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    await post(handlerDeps, groupMessage('Наш отзыв без маркера ПРОЧЕЕ_88', 'mid.plain'))
    const saved = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.plain'))
    assert.equal(saved?.kind, 'text')
    await post(handlerDeps, message('/content_pending', 'mid.c-user', 7))
    assert.equal(max.texts.some((item) => item.includes('ПРОЧЕЕ_88')), false)
    await post(handlerDeps, message('/content_pending', 'mid.c-mod', 42))
    assert.equal(max.texts.some((item) => item.includes('ПРОЧЕЕ_88')), true)
    await post(handlerDeps, message(`/review_approve ${saved?.id} flagship`, 'mid.plain-approve', 42))
    assert.equal((await store.listPublished(null)).length, 0)
    assert.equal((await store.transaction((tx) => tx.listPendingGroup(5, 'review'))).length, 0)
  })

  it('сбой хранилища даёт 503 и безопасную диагностику без текста сообщения', async () => {
    captureLogs()
    const real = createMemoryStore()
    const broken: ReviewStore = {
      ...real,
      transaction: async () => {
        throw Object.assign(new Error('ПРОВАЛ_ТЕКСТ_ОШИБКИ host=secret'), { code: 'ECONNRESET' })
      },
    }
    const handlerDeps = deps(broken, fakeMax(), { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    const response = await post(handlerDeps, groupMessage('Отзыв: ТЕКСТ_СООБЩЕНИЯ_55', 'mid.fail'))
    assert.equal(response.status, 503)
    const logged = lines.join('\n')
    assert.equal(logged.includes('"event":"storage_failed"'), true)
    assert.equal(logged.includes('"errorClass":"Error:ECONNRESET"'), true)
    assert.equal(logged.includes('ПРОВАЛ_ТЕКСТ_ОШИБКИ'), false)
    assert.equal(logged.includes('ТЕКСТ_СООБЩЕНИЯ_55'), false)
  })

  it('отзыв из чужого чата не сохраняется и в диагностике помечен как не из разрешённой группы', async () => {
    captureLogs()
    const store = createMemoryStore()
    const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set(['99']), allowedChatsConfigured: true })
    assert.equal((await post(handlerDeps, groupMessage('Отзыв: чужой', 'mid.alien', 555))).status, 200)
    assert.equal(await store.transaction((tx) => tx.findGroupMessage('555', 'mid.alien')), null)
    assert.equal(lines.join('\n').includes('"allowed":false'), true)
  })
  describe('диалог модератора и обычного пользователя', () => {
    const allowed = { allowedChatIds: new Set(['99']), allowedChatsConfigured: true }

    async function seedGroup(store: ReviewStore, handlerDeps: HandlerDeps, text: string, mid: string) {
      await post(handlerDeps, groupMessage(text, mid))
      const row = await store.transaction((tx) => tx.findGroupMessage('99', mid))
      assert.ok(row)
      return row.id
    }

    it('/start у модератора показывает меню с кнопками, у клиента — обычную справку', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max)
      await post(handlerDeps, message('/start', 'mid.s-mod', 42))
      assert.equal(max.texts[0]?.includes('Меню модератора'), true)
      assert.deepEqual(max.payloads, ['m:q', 'm:c', 'm:pl:0', 'm:wq:0', 'm:wl:0'])
      max.texts.length = 0
      max.payloads.length = 0
      await post(handlerDeps, message('/start', 'mid.s-user', 7))
      assert.equal(max.texts[0]?.includes('Меню модератора'), false)
      assert.deepEqual(max.payloads, [])
    })

    it('/menu, /moderate, /reviews_pending и /content_pending недоступны обычному пользователю', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max)
      for (const [i, command] of ['/menu', '/moderate', '/reviews_pending', '/content_pending'].entries()) {
        await post(handlerDeps, message(command, 'mid.denied.' + i, 7))
      }
      assert.deepEqual(max.texts, Array(4).fill('Команда недоступна.'))
      assert.deepEqual(max.payloads, [])
    })

    it('команды модератора работают при активной сессии отзыва и сессия не теряется', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      await seedGroup(store, handlerDeps, 'Отзыв: проверка сессии', 'mid.sess')
      assert.equal((await post(handlerDeps, message('/review', 'mid.mod-review', 42))).status, 200)
      assert.equal((await post(handlerDeps, callback('cb.mod.product', 'p:flagship', 42, 1_700_000_001_000))).status, 200)
      max.texts.length = 0
      await post(handlerDeps, message('/reviews_pending', 'mid.mod-queue', 42))
      assert.equal(max.texts.some((text) => text.includes('Группа, ожидает решения')), true)
      assert.equal(max.texts.some((text) => text.includes('Напишите текст отзыва')), false)
      max.texts.length = 0
      await post(handlerDeps, message('/menu', 'mid.mod-menu', 42))
      assert.equal(max.texts[0]?.includes('Меню модератора'), true)
      // сессия жива: следующий обычный текст всё ещё идёт в черновик отзыва
      max.texts.length = 0
      await post(handlerDeps, message('Мой отзыв модератора', 'mid.mod-text', 42))
      assert.equal(max.texts[0]?.includes('Укажите имя для сайта'), true)
    })

    it('опечатка в команде у модератора даёт справку и меню, у клиента — обычный отказ', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max)
      await post(handlerDeps, message('/revievs_pending', 'mid.typo-mod', 42))
      assert.equal(max.texts[0]?.includes('/reviews_pending'), true)
      assert.deepEqual(max.payloads, ['m:q', 'm:c', 'm:pl:0', 'm:wq:0', 'm:wl:0'])
      max.texts.length = 0
      await post(handlerDeps, message('/revievs_pending', 'mid.typo-user', 7))
      assert.equal(max.texts[0], 'Такая команда не поддерживается. Доступны /start, /review и /cancel.')
    })

    it('/whoami и /moderator_id отвечают только собственным id и только в личке', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      await post(handlerDeps, message('/whoami', 'mid.who-1', 7))
      await post(handlerDeps, message('/moderator_id', 'mid.who-2', 7))
      assert.equal(max.texts[0]?.includes('Ваш MAX user_id: 7.'), true)
      assert.equal(max.texts[1]?.includes('Ваш MAX user_id: 7.'), true)
      assert.equal(max.texts[0]?.includes('MAX_REVIEW_MODERATOR_IDS'), true)
      assert.equal(max.texts[0]?.includes('42'), false)
      max.texts.length = 0
      await post(handlerDeps, message('/whoami', 'mid.who-group', 7, 'chat'))
      assert.equal(max.texts.some((text) => text.includes('Ваш MAX user_id')), false)
    })

    it('кнопки модератора: очередь, отклонить, опубликовать с выбором товара', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      const first = await seedGroup(store, handlerDeps, 'Отзыв: КНОПКА_ОДИН', 'mid.btn-1')
      const second = await seedGroup(store, handlerDeps, 'Отзыв: КНОПКА_ДВА', 'mid.btn-2')
      await seedGroup(store, handlerDeps, 'Обычный текст группы', 'mid.btn-other')
      let stamp = 1_700_000_010_000
      const press = (payload: string, userId = 42) => post(handlerDeps, callback('cb.btn.' + stamp, payload, userId, stamp++))
      await press('m:q')
      assert.equal(max.payloads.includes('m:a:' + first), true)
      assert.equal(max.payloads.includes('m:r:' + second), true)
      max.texts.length = 0
      max.payloads.length = 0
      await press('m:c')
      assert.equal(max.texts.some((text) => text.includes('Обычный текст группы')), true)
      max.payloads.length = 0
      await press('m:a:' + first)
      assert.equal(max.payloads.includes('m:p:' + first + ':flagship'), true)
      assert.equal((await store.listPublished('flagship')).length, 0)
      await press('m:p:' + first + ':flagship')
      assert.equal((await store.listPublished('flagship')).length, 1)
      await press('m:r:' + second)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.btn-2')))?.status, 'rejected')
      assert.equal((await store.listPublished('flagship')).length, 1)
    })

    it('кнопки модератора недоступны обычному пользователю', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      const id = await seedGroup(store, handlerDeps, 'Отзыв: ЧУЖАЯ_КНОПКА', 'mid.deny-btn')
      max.texts.length = 0
      let stamp = 1_700_000_020_000
      for (const payload of ['m:q', 'm:c', 'm:a:' + id, 'm:r:' + id, 'm:p:' + id + ':flagship']) {
        assert.equal((await post(handlerDeps, callback('cb.deny.' + stamp, payload, 7, stamp++))).status, 200)
      }
      assert.deepEqual(max.texts, Array(5).fill('Команда недоступна.'))
      const row = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.deny-btn'))
      assert.equal(row?.status, 'pending')
      assert.equal((await store.listPublished('flagship')).length, 0)
    })

    it('модератор с некорректным payload ничего не меняет', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      const id = await seedGroup(store, handlerDeps, 'Отзыв: ПЛОХОЙ_PAYLOAD', 'mid.bad-payload')
      let stamp = 1_700_000_030_000
      const bad = [
        'm:a:not-a-uuid',
        'm:r:',
        'm:p:' + id + ':no-such-product',
        'm:p:' + id,
        'm:n:' + id + ':999999',
        'm:n:' + id + ':abc',
        'm:q:extra',
        'm:z:' + id,
        'm:',
      ]
      for (const payload of bad) {
        assert.equal((await post(handlerDeps, callback('cb.bad.' + stamp, payload, 42, stamp++))).status, 200)
      }
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.bad-payload')))?.status, 'pending')
      assert.equal((await store.listPublished('flagship')).length, 0)
    })
  })

  describe('удаление сообщения в группе', () => {
    const REAL_GROUP = '-79180936426178'
    const removedEvent = (chatId: unknown, messageId: unknown, timestamp = 1_700_000_040_000) => ({
      update_type: 'message_removed',
      timestamp,
      message_id: messageId,
      chat_id: chatId,
      user_id: 7,
    })

    it('отрицательный числовой chat_id разрешённой группы снимает запись и публикацию', async () => {
      const store = createMemoryStore()
      const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set([REAL_GROUP]), allowedChatsConfigured: true })
      const created = groupMessage('Отзыв: удаляемый', 'mid.rm-1', -79180936426178)
      assert.equal((await post(handlerDeps, created)).status, 200)
      const id = (await store.transaction((tx) => tx.findGroupMessage(REAL_GROUP, 'mid.rm-1')))?.id
      assert.ok(id)
      await post(handlerDeps, message('/review_approve ' + id + ' flagship', 'mid.rm-approve', 42))
      assert.equal((await store.listPublished('flagship')).length, 1)
      assert.equal((await post(handlerDeps, removedEvent(-79180936426178, 'mid.rm-1'))).status, 200)
      assert.equal((await store.listPublished('flagship')).length, 0)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage(REAL_GROUP, 'mid.rm-1')))?.status, 'removed')
    })

    it('удаление в чужом чате или в личке отвергается и не трогает записи группы', async () => {
      captureLogs()
      const store = createMemoryStore()
      const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set([REAL_GROUP]), allowedChatsConfigured: true })
      await post(handlerDeps, groupMessage('Отзыв: остаётся', 'mid.rm-2', -79180936426178))
      assert.equal((await post(handlerDeps, removedEvent(-555, 'mid.rm-2'))).status, 200)
      assert.equal((await post(handlerDeps, removedEvent(12345, 'mid.rm-2', 1_700_000_040_100))).status, 200)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage(REAL_GROUP, 'mid.rm-2')))?.status, 'pending')
      const logged = lines.join('\n')
      assert.equal(logged.includes('"updateType":"message_removed","allowed":false'), true)
      assert.equal(logged.includes('"chatSign":"negative"'), true)
      assert.equal(logged.includes('"chatSign":"positive"'), true)
      assert.equal(logged.includes('79180936426178'), false)
      assert.equal(logged.includes('12345'), false)
    })

    it('chat_id строкой не принимается и запись не меняется', async () => {
      const store = createMemoryStore()
      const handlerDeps = deps(store, fakeMax(), { allowedChatIds: new Set([REAL_GROUP]), allowedChatsConfigured: true })
      await post(handlerDeps, groupMessage('Отзыв: строковый id', 'mid.rm-3', -79180936426178))
      const response = await post(handlerDeps, removedEvent(REAL_GROUP, 'mid.rm-3'))
      assert.notEqual(response.status, 503)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage(REAL_GROUP, 'mid.rm-3')))?.status, 'pending')
    })
  })

  describe('уведомление модераторов о новом отзыве', () => {
    const allowed = { allowedChatIds: new Set(['99']), allowedChatsConfigured: true }
    const photo = { type: 'image', payload: { photo_id: 5, token: 'img-token-n', url: 'https://i.oneme.ru/a.jpg' } }
    const clip = { type: 'video', payload: { token: 'vid-token-n', url: 'https://vd.okcdn.ru/v.mp4', duration: 12 } }
    const HEAD = '==НОВЫЙ ОТЗЫВ В ГРУППЕ==\n\n==КОНТЕНТ (ИЗОБРАЖЕНИЯ И ВИДЕО)==\n\n'

    interface Sent {
      userId: string | null
      chatId: string | null
      text: string
      media: unknown[]
      buttons: KeyboardButton[][]
    }

    function recordingMax(options: { failMedia?: 'permanent' | 'temporary'; failOnce?: boolean } = {}) {
      const sent: Sent[] = []
      let failed = false
      const max: MaxClient = {
        async sendMessage(input) {
          const media = input.attachments?.media ?? []
          if (media.length > 0 && options.failMedia && !(options.failOnce && failed)) {
            failed = true
            throw options.failMedia === 'permanent' ? new MaxPermanentError(400) : new MaxTemporaryError(503)
          }
          sent.push({
            userId: input.userId,
            chatId: input.chatId,
            text: input.text,
            media,
            buttons: input.attachments?.payload.buttons ?? [],
          })
        },
        async answerCallback() {},
        async getMessage() {
          return null
        },
      }
      return { max, sent }
    }

    it('при review intake уходит DM с форматом и 2 кнопками', async () => {
      captureLogs()
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, allowed)
      const response = await post(handlerDeps, groupMessage('🩵Отзыв: Крем супер, рекомендую', 'mid.n-1', 99, [photo, clip]))
      assert.equal(response.status, 200)
      const row = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-1'))
      assert.ok(row)
      assert.equal(sent.length, 1)
      const dm = sent[0]
      assert.equal(dm?.userId, '42')
      assert.equal(dm?.chatId, null)
      assert.equal(
        dm?.text,
        HEAD + 'Приложено к сообщению: фото — 1, видео — 1.\n\n==ТЕКСТ ОТЗЫВА==\n\nКрем супер, рекомендую',
      )
      assert.deepEqual(dm?.media, [
        { type: 'image', token: 'img-token-n', url: null },
        { type: 'video', token: 'vid-token-n', url: null },
      ])
      assert.deepEqual(dm?.buttons, [
        [
          { type: 'callback', text: 'Отклонить', payload: `m:r:${row.id}` },
          { type: 'callback', text: 'Опубликовать', payload: `m:a:${row.id}` },
        ],
      ])
      // текст и id пользователей в логи не попадают
      const logged = lines.join('\n')
      assert.equal(logged.includes('Крем супер'), false)
      assert.equal(logged.includes('"notified":1'), true)
      assert.equal(logged.includes('img-token-n'), false)
    })

    it('отзыв без медиа: блок контента сообщает, что медиа нет; вложений нет', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      await post(deps(store, max, allowed), groupMessage('Отзыв: Только текст', 'mid.n-2'))
      assert.equal(sent[0]?.text, HEAD + 'Изображений и видео нет.\n\n==ТЕКСТ ОТЗЫВА==\n\nТолько текст')
      assert.deepEqual(sent[0]?.media, [])
      assert.equal(sent[0]?.buttons[0]?.length, 2)
    })

    it('кнопки из уведомления работают: «Опубликовать» открывает выбор товара, «Отклонить» отклоняет', async () => {
      const store = createMemoryStore()
      const max = fakeMax()
      const handlerDeps = deps(store, max, allowed)
      await post(handlerDeps, groupMessage('Отзыв: Через уведомление', 'mid.n-3'))
      const row = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-3'))
      assert.ok(row)
      assert.deepEqual(max.payloads, [`m:r:${row.id}`, `m:a:${row.id}`])
      max.texts.length = 0
      max.payloads.length = 0
      await post(handlerDeps, callback('cb.n-a', `m:a:${row.id}`, 42, 1_700_000_050_000))
      assert.equal(max.texts[0]?.includes('Выберите товар'), true)
      await post(handlerDeps, callback('cb.n-p', `m:p:${row.id}:flagship`, 42, 1_700_000_050_100))
      assert.equal((await store.listPublished('flagship')).length, 1)
      await post(handlerDeps, groupMessage('Отзыв: Второй', 'mid.n-3b'))
      const second = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-3b'))
      await post(handlerDeps, callback('cb.n-r', `m:r:${second?.id}`, 42, 1_700_000_050_200))
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-3b')))?.status, 'rejected')
    })

    it('не отправляется для обычного текста, медиа без маркера, смеси и чужой группы', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, allowed)
      await post(handlerDeps, groupMessage('Просто сообщение без маркера', 'mid.n-t'))
      await post(handlerDeps, groupMessage(null, 'mid.n-i', 99, [photo]))
      await post(handlerDeps, groupMessage('Красивое фото', 'mid.n-m', 99, [photo]))
      await post(handlerDeps, groupMessage('Отзыв: чужая группа', 'mid.n-f', 100))
      assert.equal(sent.length, 0)
      assert.equal((await store.transaction((tx) => tx.listPendingGroup(10, 'other'))).length, 3)
    })

    it('пустой список модераторов: ничего не отправляется, запись сохраняется, лог без секретов', async () => {
      captureLogs()
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, { ...allowed, moderators: new Set<string>(), moderatorsConfigured: false })
      assert.equal((await post(handlerDeps, groupMessage('Отзыв: никому не уйдёт', 'mid.n-e'))).status, 200)
      assert.equal(sent.length, 0)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-e')))?.status, 'pending')
      const logged = lines.join('\n')
      assert.equal(logged.includes('moderator_notify_skipped'), true)
      assert.equal(logged.includes('никому не уйдёт'), false)
    })

    it('несколько модераторов получают по одному сообщению, повторная доставка вебхука не дублирует DM', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, { ...allowed, moderators: new Set(['42', '43']) })
      const event = groupMessage('Отзыв: Для двоих', 'mid.n-two')
      assert.equal((await post(handlerDeps, event)).status, 200)
      assert.equal((await post(handlerDeps, event)).status, 200)
      assert.deepEqual(sent.map((item) => item.userId).sort(), ['42', '43'])
    })

    it('правка ожидающего отзыва не шлёт второе уведомление; текст берётся из записи', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, allowed)
      await post(handlerDeps, groupMessage('Отзыв: Первая версия', 'mid.n-ed', 99, undefined, 1_700_000_060_000))
      const edited = groupMessage('Отзыв: Вторая версия', 'mid.n-ed', 99, undefined, 1_700_000_060_100)
      edited.update_type = 'message_edited'
      assert.equal((await post(handlerDeps, edited)).status, 200)
      assert.equal(sent.length, 1)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-ed')))?.publicText, 'Вторая версия')
    })

    it('правка обычного сообщения, ставшего отзывом, и возврат опубликованного в очередь дают новое уведомление', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax()
      const handlerDeps = deps(store, max, allowed)
      await post(handlerDeps, groupMessage('Просто текст', 'mid.n-up', 99, undefined, 1_700_000_061_000))
      assert.equal(sent.length, 0)
      const edited = groupMessage('Отзыв: Теперь это отзыв', 'mid.n-up', 99, undefined, 1_700_000_061_100)
      edited.update_type = 'message_edited'
      await post(handlerDeps, edited)
      assert.equal(sent.length, 1)
      assert.equal(sent[0]?.text.endsWith('Теперь это отзыв'), true)
      const row = await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-up'))
      {
        const first = sent[0]?.buttons[0]?.[0]
        assert.equal(first && 'payload' in first ? first.payload : null, `m:r:${row?.id}`)
      }
    })

    it('временная ошибка MAX: 503 и повтор вебхука доставляет уведомление один раз', async () => {
      const store = createMemoryStore()
      const sent: string[] = []
      let calls = 0
      const max: MaxClient = {
        async sendMessage(input) {
          calls += 1
          if (calls === 1) throw new MaxTemporaryError(503)
          sent.push(input.text)
        },
        async answerCallback() {},
        async getMessage() {
          return null
        },
      }
      const handlerDeps = deps(store, max, allowed)
      const event = groupMessage('Отзыв: Повтор после сбоя', 'mid.n-retry')
      assert.equal((await post(handlerDeps, event)).status, 503)
      assert.equal((await store.transaction((tx) => tx.findGroupMessage('99', 'mid.n-retry')))?.status, 'pending')
      assert.equal((await post(handlerDeps, event)).status, 200)
      assert.equal((await post(handlerDeps, event)).status, 200)
      assert.equal(sent.length, 1)
    })

    it('если MAX отклонил вложения, шлём тот же формат без вложений и с кнопками', async () => {
      const store = createMemoryStore()
      const { max, sent } = recordingMax({ failMedia: 'permanent' })
      const handlerDeps = deps(store, max, allowed)
      assert.equal((await post(handlerDeps, groupMessage('Отзыв: Не прикрепилось', 'mid.n-fb', 99, [photo]))).status, 200)
      assert.equal(sent.length, 1)
      assert.equal(sent[0]?.media.length, 0)
      assert.equal(sent[0]?.text.startsWith(HEAD + 'Не удалось приложить медиа'), true)
      assert.equal(sent[0]?.text.endsWith('==ТЕКСТ ОТЗЫВА==\n\nНе прикрепилось'), true)
      assert.equal(sent[0]?.buttons[0]?.length, 2)
    })

    it('в запрос MAX медиа уходят вложениями перед клавиатурой, служебные поля не попадают в API', async () => {
      const bodies: { attachments: { type: string; payload: unknown }[]; text: string }[] = []
      const client = createMaxClient('token-x', async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      })
      const keyboard = notificationKeyboard('11111111-1111-4111-8111-111111111111')
      await client.sendMessage({
        chatId: null,
        userId: '42',
        text: 'x',
        attachments: {
          ...keyboard,
          fallbackText: 'f',
          media: [
            { type: 'image', token: 't1', url: 'https://blob.example/a.jpg' },
            { type: 'image', token: 't2', url: null },
            { type: 'video', token: 'v1', url: 'https://blob.example/v.mp4' },
          ],
        },
      })
      const attachments = bodies[0]?.attachments
      assert.deepEqual(
        attachments?.map((item) => item.type),
        ['image', 'image', 'video', 'inline_keyboard'],
      )
      assert.deepEqual(attachments?.[0]?.payload, { url: 'https://blob.example/a.jpg' })
      assert.deepEqual(attachments?.[1]?.payload, { token: 't2' })
      assert.deepEqual(attachments?.[2]?.payload, { token: 'v1' })
      assert.equal(JSON.stringify(bodies[0]).includes('fallbackText'), false)
      assert.equal(JSON.stringify(bodies[0]).includes('"media"'), false)
    })
  })
})
