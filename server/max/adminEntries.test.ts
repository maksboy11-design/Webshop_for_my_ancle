import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { handleAdminEntriesRequest, type AdminEntriesDeps } from './adminEntriesHttp'
import {
  createMemoryEntryStore,
  missingFields,
  normalizeEntryData,
  publicProductFromEntry,
  publicReviewFromEntry,
  publicWebinarFromEntry,
  statusFor,
  type EntryStore,
} from './cmsEntries'
import { createLogger } from './logger'
import { handlePublicProductsRequest } from './productsHttp'
import { signWebAppInitDataForTests } from './webAppInitData'

const TOKEN = 'admin-entries-test-token'
const MOD = '42'
const NOW = new Date('2026-11-01T12:00:00.000Z')
const auth = (user = MOD) => ({
  'x-max-init-data': signWebAppInitDataForTests({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(user) }) }, TOKEN),
  'content-type': 'application/json',
})

function deps(entries: EntryStore | null = createMemoryEntryStore()): AdminEntriesDeps {
  return { botToken: TOKEN, moderators: new Set([MOD]), moderatorsConfigured: true, now: () => NOW, entries, log: createLogger() }
}

const call = (d: AdminEntriesDeps, method: string, query: string, body?: unknown, user?: string) =>
  handleAdminEntriesRequest(
    new Request(`https://x/api/admin/entries${query}`, { method, headers: auth(user), body: body === undefined ? undefined : JSON.stringify(body) }),
    d,
  )

const FULL_PRODUCT = {
  name: 'Новый товар',
  brandId: 'silkway',
  category: 'care',
  priceRub: '1500',
  imageUrl: 'https://example.com/a.jpg',
  description: 'Первый абзац.\n\nВторой абзац.',
}

describe('cmsEntries: обязательные поля и статус', () => {
  it('пустые поля — черновик, все обязательные — публикация', () => {
    const draft = normalizeEntryData('webinar', { title: 'Тема', youtubeUrl: '', category: '' })
    assert.ok(draft.ok)
    assert.deepEqual(missingFields('webinar', draft.data), ['youtubeUrl', 'category'])
    assert.equal(statusFor('webinar', draft.data), 'draft')
    const full = normalizeEntryData('webinar', { title: 'Тема', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', category: 'doctors' })
    assert.ok(full.ok)
    assert.equal(statusFor('webinar', full.data), 'published')
  })

  it('неверные значения отклоняются с указанием поля', () => {
    assert.deepEqual(normalizeEntryData('product', { brandId: 'nope' }), { ok: false, error: { field: 'brandId', error: 'invalid' } })
    const price = normalizeEntryData('product', { priceRub: '-5' })
    assert.equal(price.ok, false)
    const review = normalizeEntryData('review', { productId: 'нет-такого' })
    assert.equal(review.ok, false)
    const url = normalizeEntryData('webinar', { youtubeUrl: 'https://evil.example/x' })
    assert.equal(url.ok, false)
  })

  it('публичные представления собираются только из полных записей', () => {
    const base = { id: randomUUID(), status: 'published' as const, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), updatedByUserId: MOD }
    const w = publicWebinarFromEntry({ ...base, kind: 'webinar', data: { title: 'T', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', category: 'doctors' } })
    assert.equal(w?.category, 'doctors')
    assert.equal(w?.youtubeVideoId, 'dQw4w9WgXcQ')
    const p = publicProductFromEntry({ ...base, kind: 'product', data: { ...FULL_PRODUCT } })
    assert.match(p?.slug ?? '', /^custom-[0-9a-f]{12}$/)
    assert.equal(p?.description.content.length, 2)
    assert.equal(publicReviewFromEntry({ ...base, kind: 'review', data: { productId: 'flagship', author: 'Анна', text: 'Отлично' } })?.productId, 'flagship')
  })
})

describe('/api/admin/entries', () => {
  it('без initData модератора — 401/403', async () => {
    const d = deps()
    const res = await call(d, 'GET', '?kind=product', undefined, '7')
    assert.equal(res.status, 403)
  })

  it('«Добавить» с пустым полем сохраняет черновик, дозаполнение публикует', async () => {
    const store = createMemoryEntryStore()
    const d = deps(store)
    const created = await call(d, 'POST', '', { kind: 'product', data: { ...FULL_PRODUCT, imageUrl: '' } })
    assert.equal(created.status, 201)
    const { entry } = (await created.json()) as { entry: { id: string; status: string; missing: string[] } }
    assert.equal(entry.status, 'draft')
    assert.deepEqual(entry.missing, ['imageUrl'])

    const pub = await handlePublicProductsRequest(new Request('https://x/api/products'), { overrides: null, entries: store, log: createLogger() })
    assert.equal(((await pub.json()) as { added?: unknown[] }).added, undefined)

    const patched = await call(d, 'PATCH', `?id=${entry.id}`, { data: FULL_PRODUCT })
    assert.equal(patched.status, 200)
    assert.equal(((await patched.json()) as { entry: { status: string } }).entry.status, 'published')

    const pub2 = await handlePublicProductsRequest(new Request('https://x/api/products'), { overrides: null, entries: store, log: createLogger() })
    const body = (await pub2.json()) as { added?: { name: string }[] }
    assert.equal(body.added?.[0]?.name, 'Новый товар')

    const del = await call(d, 'DELETE', `?id=${entry.id}`)
    assert.equal(del.status, 200)
    const again = await call(d, 'PATCH', `?id=${entry.id}`, { data: FULL_PRODUCT })
    assert.equal(((await again.json()) as { entry: { status: string } }).entry.status, 'withdrawn')
    const re = await call(d, 'PATCH', `?id=${entry.id}`, { data: FULL_PRODUCT, republish: true })
    assert.equal(((await re.json()) as { entry: { status: string } }).entry.status, 'published')
  })

  it('без миграции — 503 migration_pending, публичный API работает как раньше', async () => {
    const store = createMemoryEntryStore({ migrated: false })
    const res = await call(deps(store), 'POST', '', { kind: 'review', data: { author: 'Анна' } })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'migration_pending' })
    const pub = await handlePublicProductsRequest(new Request('https://x/api/products'), { overrides: null, entries: store, log: createLogger() })
    assert.equal(pub.status, 200)
    const cats = await call(deps(store), 'GET', `?webinarIds=${randomUUID()}`)
    assert.equal(cats.status, 200)
  })

  it('категория вебинара из бота меняется и читается', async () => {
    const id = randomUUID()
    const d = deps(createMemoryEntryStore({ webinarIds: [id] }))
    assert.equal((await call(d, 'PATCH', `?webinarId=${id}`, { category: 'x' })).status, 400)
    assert.equal((await call(d, 'PATCH', `?webinarId=${id}`, { category: 'doctors' })).status, 200)
    const res = await call(d, 'GET', `?webinarIds=${id}`)
    assert.deepEqual(await res.json(), { categories: { [id]: 'doctors' } })
    assert.equal((await call(d, 'PATCH', `?webinarId=${randomUUID()}`, { category: 'doctors' })).status, 404)
  })
})
