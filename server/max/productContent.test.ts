import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLogger } from './logger'
import { createMemoryProductOverrideStore } from './productOverrideStore'
import { createMemoryProductContentStore } from './productContentStore'
import { handleAdminProductsRequest, handlePublicProductsRequest } from './productsHttp'
import { signWebAppInitDataForTests } from './webAppInitData'

const TOKEN = 'content-test-token'
const MOD = '42'
const NOW = new Date('2024-06-01T12:00:00.000Z')
const init = (id: string) => signWebAppInitDataForTests({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(id) }) }, TOKEN)

function setup() {
  const content = createMemoryProductContentStore()
  const overrides = createMemoryProductOverrideStore()
  const d = { botToken: TOKEN, moderators: new Set([MOD]), moderatorsConfigured: true, now: () => NOW, overrides, content, log: createLogger(), encoder: null, putBlob: null }
  const call = (q: string, method = 'GET', body?: unknown, user = MOD) =>
    handleAdminProductsRequest(
      new Request(`https://x.test/api/admin/products${q}`, {
        method,
        headers: { 'x-max-init-data': init(user), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      d,
    )
  const pub = async () => (await (await handlePublicProductsRequest(new Request('https://x.test/api/products'), { overrides, content, log: createLogger() })).json()) as { products: { id: string; description: unknown }[] }
  return { content, call, pub }
}

const DOC = { type: 'doc', version: 1, numbered: true, content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Секция' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] }] }

describe('черновик описания (product_content)', () => {
  it('только модератор', async () => {
    const { call } = setup()
    assert.equal((await call('?id=flagship&content=1', 'GET', undefined, '7')).status, 403)
  })
  it('сохранение черновика не меняет сайт; публикация — только явным POST', async () => {
    const { call, pub, content } = setup()
    const before = (await pub()).products.find((p) => p.id === 'flagship')!.description
    const g0 = (await (await call('?id=flagship&content=1')).json()) as { content: { draftRev: number; draftDoc: unknown } }
    assert.equal(g0.content.draftRev, 0)
    assert.equal(g0.content.draftDoc, null)
    const r1 = await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })
    assert.equal(r1.status, 200)
    const b1 = (await r1.json()) as { content: { draftRev: number; draftDoc: { numbered?: boolean } ; hasPublished: boolean } }
    assert.equal(b1.content.draftRev, 1)
    assert.equal(b1.content.draftDoc.numbered, true)
    assert.equal(b1.content.hasPublished, false)
    assert.deepEqual((await pub()).products.find((p) => p.id === 'flagship')!.description, before, 'черновик не виден на сайте')
    // Устаревшая ревизия — конфликт.
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })).status, 409)
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: 0 })).status, 409)
    const p = await call('?id=flagship&publish=1', 'POST', { rev: 1 })
    assert.equal(p.status, 200)
    assert.equal(content.versions.length, 1)
    assert.deepEqual(content.activity, ['publish:flagship'])
    const site = (await pub()).products.find((x) => x.id === 'flagship')!.description as { numbered?: boolean; content: unknown[] }
    assert.equal(site.numbered, true)
    assert.equal(site.content.length, 2)
  })
  it('невалидный документ отклоняется', async () => {
    const { call } = setup()
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: { type: 'doc', version: 1, content: [{ type: 'image' }] }, rev: 0 })).status, 400)
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: DOC })).status, 400)
    assert.equal((await call('?id=nope-unknown&content=1')).status, 404)
  })
  it('без хранилища контента — 503, сайт работает по-старому', async () => {
    const { call } = setup()
    void call
    const r = await handleAdminProductsRequest(
      new Request('https://x.test/api/admin/products?id=flagship&content=1', { headers: { 'x-max-init-data': init(MOD) } }),
      { botToken: TOKEN, moderators: new Set([MOD]), moderatorsConfigured: true, now: () => NOW, overrides: null, content: null, log: createLogger(), encoder: null, putBlob: null },
    )
    assert.equal(r.status, 503)
  })
})

describe('дополнительные блоки и видео (?extras=1)', () => {
  it('сохраняются в черновик без публикации; первый черновик берёт текущее описание; сайт видит после publish', async () => {
    const { call, pub } = setup()
    const before = (await pub()).products.find((p) => p.id === 'flagship')!
    const body = { rev: 0, showVideos: true, blocks: [{ id: 'i1', type: 'info', content: { text: 'Важно' } }], videos: [{ key: 'v1', link: 'https://youtu.be/dQw4w9WgXcQ', title: 'Обзор' }] }
    const r = await call('?id=flagship&content=1&extras=1', 'PUT', body)
    assert.equal(r.status, 200)
    const v = (await r.json()) as { content: { draftRev: number; draftDoc: { content: unknown[] } | null; draftExtras: { blocks: unknown[]; videos: { src: string }[] } } }
    assert.equal(v.content.draftRev, 1)
    assert.equal(v.content.draftExtras.videos[0]!.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    if (before.description) assert.ok(v.content.draftDoc && v.content.draftDoc.content.length > 0, 'текст описания не потерян')
    const p0 = (await pub()).products.find((p) => p.id === 'flagship') as { extras?: unknown }
    assert.equal(p0.extras, undefined, 'черновик не виден на сайте')
    assert.equal((await call('?id=flagship&content=1&extras=1', 'PUT', body)).status, 409)
    assert.equal((await call('?id=flagship&content=1&extras=1', 'PUT', { ...body, rev: 1, videos: [{ key: 'x', link: 'https://evil.com/v' }] })).status, 400)
    assert.equal((await call('?id=flagship&content=1&extras=1', 'PUT', { ...body, rev: 1, blocks: [{ id: 'g', type: 'image', content: { image: { mediaId: '11111111-1111-4111-8111-111111111111' } } }] })).status, 400, 'без медиатеки фото не принимается')
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: 1 })).status, 200)
    const p1 = (await pub()).products.find((p) => p.id === 'flagship') as { extras?: { blocks: unknown[]; videos: unknown[] } }
    assert.equal(p1.extras?.blocks.length, 1)
    assert.equal(p1.extras?.videos.length, 1)
  })
})
