import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleAdminReviewsRequest } from './adminReviewsHttp'
import { createLogger } from './logger'
import { createMemoryStore, setPublishedReviewMediaForTests } from './memoryStore'
import { handleReviewsRequest } from './reviewsHttp'
import { signWebAppInitDataForTests } from './webAppInitData'
import type { PublicReviewMedia } from './attachments'

const TOKEN = 'admin-reviews-test-token'
const MOD = '42'
const NOW = new Date('2024-06-01T12:00:00.000Z')

function initData(userId: string, authDate = Math.floor(NOW.getTime() / 1000)): string {
  return signWebAppInitDataForTests(
    { auth_date: String(authDate), user: JSON.stringify({ id: Number(userId) }) },
    TOKEN,
  )
}

function deps(store = createMemoryStore()) {
  return {
    store,
    log: createLogger(),
    botToken: TOKEN,
    moderators: new Set([MOD]),
    moderatorsConfigured: true,
    now: () => NOW,
  }
}

async function seed(
  store: ReturnType<typeof createMemoryStore>,
  rows: { id: string; productId: string; text: string; author?: string | null; decidedAt?: string }[],
) {
  await store.transaction(async (tx) => {
    for (const row of rows) {
      await tx.insertPending({
        id: row.id,
        productId: row.productId,
        text: row.text,
        author: row.author ?? null,
        receivedAt: '2024-05-01T00:00:00.000Z',
        consentAt: '2024-05-01T00:00:00.000Z',
        idempotencyKey: `k-${row.id}`,
        senderUserId: '9',
      })
      await tx.decide(row.id, 'published', MOD, row.decidedAt ?? '2024-05-02T00:00:00.000Z')
    }
  })
}

describe('admin reviews API', () => {
  it('1–3: поиск без учёта регистра, несколько слов, пустой q', async () => {
    const store = createMemoryStore()
    await seed(store, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        productId: 'flagship',
        text: 'Отличный Водородный прибор',
        author: 'Анна',
      },
      { id: '22222222-2222-4222-8222-222222222222', productId: 'flagship', text: 'просто вода', author: 'Bob' },
    ])
    const d = deps(store)
    const headers = { 'x-max-init-data': initData(MOD) }

    const multi = await handleAdminReviewsRequest(
      new Request('https://x.test/api/admin/reviews?q=' + encodeURIComponent('водородный ПРИБОР'), { headers }),
      d,
    )
    assert.equal(multi.status, 200)
    const multiBody = (await multi.json()) as { total: number; reviews: { id: string }[] }
    assert.equal(multiBody.total, 1)
    assert.equal(multiBody.reviews[0]?.id, '11111111-1111-4111-8111-111111111111')

    const empty = await handleAdminReviewsRequest(new Request('https://x.test/api/admin/reviews?q=', { headers }), d)
    assert.equal(((await empty.json()) as { total: number }).total, 2)
  })

  it('4–8: фильтры photos/videos включая 0; пагинация и порядок', async () => {
    const store = createMemoryStore()
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await seed(store, [
      { id: idA, productId: 'flagship', text: 'с фото', decidedAt: '2024-05-03T00:00:00.000Z' },
      { id: idB, productId: 'flagship', text: 'без медиа', decidedAt: '2024-05-01T00:00:00.000Z' },
    ])
    const media: PublicReviewMedia[] = [
      { type: 'image', src: '/products/device.png', poster: null, alt: null },
      { type: 'image', src: 'https://blob.vercel-storage.com/a.jpg', poster: null, alt: null },
    ]
    assert.equal(setPublishedReviewMediaForTests(store, idA, media), true)

    const d = deps(store)
    const headers = { 'x-max-init-data': initData(MOD) }

    const photos2 = await handleAdminReviewsRequest(
      new Request('https://x.test/api/admin/reviews?photos=2', { headers }),
      d,
    )
    assert.equal(((await photos2.json()) as { total: number }).total, 1)

    const zero = await handleAdminReviewsRequest(
      new Request('https://x.test/api/admin/reviews?photos=0&videos=0', { headers }),
      d,
    )
    assert.equal(((await zero.json()) as { total: number }).total, 1)

    const both = await handleAdminReviewsRequest(
      new Request('https://x.test/api/admin/reviews?q=' + encodeURIComponent('фото') + '&photos=2&videos=0', {
        headers,
      }),
      d,
    )
    assert.equal(((await both.json()) as { total: number }).total, 1)

    const page = await handleAdminReviewsRequest(
      new Request('https://x.test/api/admin/reviews?limit=1&offset=0', { headers }),
      d,
    )
    const pageBody = (await page.json()) as { total: number; reviews: { id: string; photosCount: number }[] }
    assert.equal(pageBody.total, 2)
    assert.equal(pageBody.reviews.length, 1)
    assert.equal(pageBody.reviews[0]?.id, idA)
    assert.equal(pageBody.reviews[0]?.photosCount, 2)
  })

  it('9–10, 20: карточки без/с медиа; детали; недопустимые URL отбрасываются', async () => {
    const store = createMemoryStore()
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await seed(store, [{ id, productId: 'flagship', text: 'полный текст отзыва для подробностей' }])
    assert.equal(
      setPublishedReviewMediaForTests(store, id, [
        { type: 'image', src: 'https://evil.example/x.jpg', poster: null, alt: null },
        { type: 'image', src: '/products/device.png', poster: null, alt: null },
        {
          type: 'video',
          src: 'https://blob.vercel-storage.com/v.mp4',
          poster: 'https://blob.vercel-storage.com/p.jpg',
          alt: null,
        },
      ]),
      true,
    )
    const d = deps(store)
    const headers = { 'x-max-init-data': initData(MOD) }
    const detail = await handleAdminReviewsRequest(
      new Request(`https://x.test/api/admin/reviews?id=${id}`, { headers }),
      d,
    )
    assert.equal(detail.status, 200)
    const body = (await detail.json()) as {
      review: { text: string; media: { src: string; type: string }[]; photosCount: number; videosCount: number }
    }
    assert.equal(body.review.text, 'полный текст отзыва для подробностей')
    assert.equal(body.review.media.length, 2)
    assert.equal(body.review.photosCount, 1)
    assert.equal(body.review.videosCount, 1)
    assert.equal(
      body.review.media.every((m) => m.src.startsWith('/') || m.src.includes('blob.vercel-storage.com')),
      true,
    )
  })

  it('12–13, 16: DELETE withdraw идемпотентен и убирает из публичного API', async () => {
    const store = createMemoryStore()
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await seed(store, [{ id, productId: 'flagship', text: 'на удаление' }])
    const d = deps(store)
    const headers = { 'x-max-init-data': initData(MOD) }

    const del = await handleAdminReviewsRequest(
      new Request(`https://x.test/api/admin/reviews?id=${id}`, { method: 'DELETE', headers }),
      d,
    )
    assert.equal(del.status, 200)

    const publicApi = await handleReviewsRequest(new Request('https://x.test/api/reviews'), {
      store,
      log: createLogger(),
    })
    const publicBody = (await publicApi.json()) as { reviews: { id: string }[] }
    assert.equal(publicBody.reviews.some((r) => r.id === id), false)

    const again = await handleAdminReviewsRequest(
      new Request(`https://x.test/api/admin/reviews?id=${id}`, { method: 'DELETE', headers }),
      d,
    )
    assert.equal(again.status, 409)
  })

  it('17–18: отказ без сессии, с подделкой и просрочкой; чужой user', async () => {
    const d = deps()
    assert.equal((await handleAdminReviewsRequest(new Request('https://x.test/api/admin/reviews'), d)).status, 401)
    assert.equal(
      (
        await handleAdminReviewsRequest(
          new Request('https://x.test/api/admin/reviews', { headers: { 'x-max-init-data': initData(MOD) + 'x' } }),
          d,
        )
      ).status,
      401,
    )
    assert.equal(
      (
        await handleAdminReviewsRequest(
          new Request('https://x.test/api/admin/reviews', {
            headers: { 'x-max-init-data': initData(MOD, Math.floor(NOW.getTime() / 1000) - 4000) },
          }),
          d,
        )
      ).status,
      401,
    )
    assert.equal(
      (
        await handleAdminReviewsRequest(
          new Request('https://x.test/api/admin/reviews', { headers: { 'x-max-init-data': initData('99') } }),
          d,
        )
      ).status,
      403,
    )
  })

  it('19: SQL-инъекция в q не ломает выборку', async () => {
    const store = createMemoryStore()
    await seed(store, [
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', productId: 'flagship', text: 'чистый текст' },
    ])
    const d = deps(store)
    const headers = { 'x-max-init-data': initData(MOD) }
    const injection = await handleAdminReviewsRequest(
      new Request(
        'https://x.test/api/admin/reviews?q=' + encodeURIComponent("'; DROP TABLE product_reviews;--"),
        { headers },
      ),
      d,
    )
    assert.equal(injection.status, 200)
    assert.equal(((await injection.json()) as { total: number }).total, 0)
    const still = await handleAdminReviewsRequest(new Request('https://x.test/api/admin/reviews', { headers }), d)
    assert.equal(((await still.json()) as { total: number }).total, 1)
  })

  describe('PATCH edit', () => {
    const id = '77777777-7777-4777-8777-777777777777'
    const url = `https://x.test/api/admin/reviews/${id}`
    async function setup() {
      const store = createMemoryStore()
      await seed(store, [{ id, productId: 'flagship', text: 'старый текст', author: 'Анна' }])
      setPublishedReviewMediaForTests(store, id, [
        { type: 'image', src: '/products/device.png', poster: null, alt: null },
        { type: 'video', src: 'https://blob.vercel-storage.com/v.mp4', poster: null, alt: null },
      ])
      return store
    }
    function patch(body: unknown, headers: Record<string, string> = { 'x-max-init-data': initData(MOD) }) {
      return new Request(url, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('401 без initData, 403 не модератор, 401 поддельная подпись', async () => {
      const d = deps(await setup())
      assert.equal((await handleAdminReviewsRequest(patch({ text: 'x' }, {}), d)).status, 401)
      assert.equal((await handleAdminReviewsRequest(patch({ text: 'x' }, { 'x-max-init-data': initData('99') }), d)).status, 403)
      assert.equal((await handleAdminReviewsRequest(patch({ text: 'x' }, { 'x-max-init-data': initData(MOD) + 'x' }), d)).status, 401)
    })

    it('валидация: пустой текст, длинный текст/автор, неизвестный товар, пустой patch', async () => {
      const d = deps(await setup())
      const code = async (body: unknown) => {
        const r = await handleAdminReviewsRequest(patch(body), d)
        assert.equal(r.status, 400)
        return ((await r.json()) as { error: string }).error
      }
      assert.equal(await code({ text: '   ' }), 'empty_text')
      assert.equal(await code({ text: 'a'.repeat(2001) }), 'text_too_long')
      assert.equal(await code({ author: 'a'.repeat(81) }), 'author_too_long')
      assert.equal(await code({ productId: 'nope-product' }), 'unknown_product')
      assert.equal(await code({}), 'empty_patch')
      assert.equal(await code({ removeMedia: 'x' }), 'invalid_media')
    })

    it('правит текст, автора, товар, отвязывает медиа; публичный API видит изменения', async () => {
      const store = await setup()
      const d = deps(store)
      const res = await handleAdminReviewsRequest(
        patch({ text: ' новый текст ', author: '', productId: 'astaxanthin', removeMedia: ['https://blob.vercel-storage.com/v.mp4'] }),
        d,
      )
      assert.equal(res.status, 200)
      const body = (await res.json()) as { review: { text: string; author: string | null; productId: string; videosCount: number; photosCount: number } }
      assert.equal(body.review.text, 'новый текст')
      assert.equal(body.review.author, null)
      assert.equal(body.review.productId, 'astaxanthin')
      assert.equal(body.review.videosCount, 0)
      assert.equal(body.review.photosCount, 1)
      const pub = await handleReviewsRequest(new Request('https://x.test/api/reviews?productId=astaxanthin'), { store, log: createLogger() })
      const pubText = await pub.text()
      assert.ok(pubText.includes('новый текст'))
      assert.ok(!pubText.includes('v.mp4'))
    })

    it('404 для неизвестного id, 409 для снятого', async () => {
      const store = await setup()
      const d = deps(store)
      const other = await handleAdminReviewsRequest(
        new Request('https://x.test/api/admin/reviews/88888888-8888-4888-8888-888888888888', {
          method: 'PATCH',
          headers: { 'x-max-init-data': initData(MOD), 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'x' }),
        }),
        d,
      )
      assert.equal(other.status, 404)
      await handleAdminReviewsRequest(new Request(url, { method: 'DELETE', headers: { 'x-max-init-data': initData(MOD) } }), d)
      assert.equal((await handleAdminReviewsRequest(patch({ text: 'x' }), d)).status, 409)
    })

    it('catalog=1 отдаёт реальные товары только модератору', async () => {
      const d = deps(await setup())
      assert.equal((await handleAdminReviewsRequest(new Request('https://x.test/api/admin/reviews?catalog=1'), d)).status, 401)
      const r = await handleAdminReviewsRequest(
        new Request('https://x.test/api/admin/reviews?catalog=1', { headers: { 'x-max-init-data': initData(MOD) } }),
        d,
      )
      const products = ((await r.json()) as { products: { id: string }[] }).products
      assert.ok(products.some((p) => p.id === 'astaxanthin'))
    })
  })
})
