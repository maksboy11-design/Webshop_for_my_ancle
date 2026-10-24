import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createLogger } from './logger'
import { createMemoryStore } from './memoryStore'
import { MaxTemporaryError, type MaxClient } from './maxClient'
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

function fakeMax(failOnCall = 0): MaxClient & { texts: string[] } {
  const texts: string[] = []
  let call = 0
  const guard = async (text: string | null) => {
    call += 1
    if (call === failOnCall) throw new MaxTemporaryError(503)
    texts.push(text ?? '')
  }
  return {
    texts,
    async sendMessage(input) {
      await guard(input.text)
    },
    async answerCallback(input) {
      await guard(input.text)
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
    sessionTtlMs: 30 * 60 * 1000,
    deliveryBudgetMs: 60_000,
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
    assert.deepEqual(Object.keys(published[0] ?? {}).sort(), ['author', 'id', 'productId', 'text'])
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
    assert.deepEqual(Object.keys(payload.reviews[0] ?? {}).sort(), ['author', 'id', 'productId', 'text'])
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
})
