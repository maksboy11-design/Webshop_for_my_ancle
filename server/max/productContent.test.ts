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
const init = (id: string) =>
  signWebAppInitDataForTests({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(id) }) }, TOKEN)

function setup() {
  const content = createMemoryProductContentStore()
  const overrides = createMemoryProductOverrideStore()
  const d = {
    botToken: TOKEN,
    moderators: new Set([MOD]),
    moderatorsConfigured: true,
    now: () => NOW,
    overrides,
    content,
    log: createLogger(),
    encoder: null,
    putBlob: null,
  }
  const call = (q: string, method = 'GET', body?: unknown, user = MOD) =>
    handleAdminProductsRequest(
      new Request(`https://x.test/api/admin/products${q}`, {
        method,
        headers: { 'x-max-init-data': init(user), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      d,
    )
  const pub = async () =>
    (await (
      await handlePublicProductsRequest(new Request('https://x.test/api/products'), { overrides, content, log: createLogger() })
    ).json()) as { products: { id: string; description: unknown }[] }
  return { content, call, pub }
}

const DOC = {
  type: 'doc',
  version: 1,
  numbered: true,
  content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Секция' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] },
  ],
}

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
    const b1 = (await r1.json()) as { content: { draftRev: number; draftDoc: { numbered?: boolean }; hasPublished: boolean } }
    assert.equal(b1.content.draftRev, 1)
    assert.equal(b1.content.draftDoc.numbered, true)
    assert.equal(b1.content.hasPublished, false)
    assert.deepEqual((await pub()).products.find((p) => p.id === 'flagship')!.description, before, 'черновик не виден на сайте')
    // Устаревшая ревизия — конфликт.
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })).status, 409)
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: 0 })).status, 409)
    const p = await call('?id=flagship&publish=1', 'POST', { rev: 1 })
    assert.equal(p.status, 200)
    assert.equal(content.versionLog.length, 1)
    assert.deepEqual(content.activity, ['publish:flagship'])
    const site = (await pub()).products.find((x) => x.id === 'flagship')!.description as { numbered?: boolean; content: unknown[] }
    assert.equal(site.numbered, true)
    assert.equal(site.content.length, 2)
  })
  it('невалидный документ отклоняется', async () => {
    const { call } = setup()
    assert.equal(
      (await call('?id=flagship&content=1', 'PUT', { doc: { type: 'doc', version: 1, content: [{ type: 'image' }] }, rev: 0 })).status,
      400,
    )
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: DOC })).status, 400)
    assert.equal((await call('?id=nope-unknown&content=1')).status, 404)
  })
  it('без хранилища контента — 503, сайт работает по-старому', async () => {
    const { call } = setup()
    void call
    const r = await handleAdminProductsRequest(
      new Request('https://x.test/api/admin/products?id=flagship&content=1', { headers: { 'x-max-init-data': init(MOD) } }),
      {
        botToken: TOKEN,
        moderators: new Set([MOD]),
        moderatorsConfigured: true,
        now: () => NOW,
        overrides: null,
        content: null,
        log: createLogger(),
        encoder: null,
        putBlob: null,
      },
    )
    assert.equal(r.status, 503)
  })
})

describe('дополнительные блоки и видео (?extras=1)', () => {
  it('сохраняются в черновик без публикации; первый черновик берёт текущее описание; сайт видит после publish', async () => {
    const { call, pub } = setup()
    const before = (await pub()).products.find((p) => p.id === 'flagship')!
    const body = {
      rev: 0,
      showVideos: true,
      blocks: [{ id: 'i1', type: 'info', content: { text: 'Важно' } }],
      videos: [{ key: 'v1', link: 'https://youtu.be/dQw4w9WgXcQ', title: 'Обзор' }],
    }
    const r = await call('?id=flagship&content=1&extras=1', 'PUT', body)
    assert.equal(r.status, 200)
    const v = (await r.json()) as {
      content: { draftRev: number; draftDoc: { content: unknown[] } | null; draftExtras: { blocks: unknown[]; videos: { src: string }[] } }
    }
    assert.equal(v.content.draftRev, 1)
    assert.equal(v.content.draftExtras.videos[0]!.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    if (before.description) assert.ok(v.content.draftDoc && v.content.draftDoc.content.length > 0, 'текст описания не потерян')
    const p0 = (await pub()).products.find((p) => p.id === 'flagship') as { extras?: unknown }
    assert.equal(p0.extras, undefined, 'черновик не виден на сайте')
    assert.equal((await call('?id=flagship&content=1&extras=1', 'PUT', body)).status, 409)
    assert.equal(
      (await call('?id=flagship&content=1&extras=1', 'PUT', { ...body, rev: 1, videos: [{ key: 'x', link: 'https://evil.com/v' }] }))
        .status,
      400,
    )
    assert.equal(
      (
        await call('?id=flagship&content=1&extras=1', 'PUT', {
          ...body,
          rev: 1,
          blocks: [{ id: 'g', type: 'image', content: { image: { mediaId: '11111111-1111-4111-8111-111111111111' } } }],
        })
      ).status,
      400,
      'без медиатеки фото не принимается',
    )
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: 1 })).status, 200)
    const p1 = (await pub()).products.find((p) => p.id === 'flagship') as { extras?: { blocks: unknown[]; videos: unknown[] } }
    assert.equal(p1.extras?.blocks.length, 1)
    assert.equal(p1.extras?.videos.length, 1)
  })
})

describe('этап 5: bulk / trash / duplicate / versions / card', () => {
  it('bulk trash + restore по списку id без load-all', async () => {
    const { call, content } = setup()
    await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })
    const bulk = await call('?bulk=1', 'POST', { ids: ['flagship'], op: 'trash' })
    assert.equal(bulk.status, 200)
    const b = (await bulk.json()) as { ok: string[]; failed: unknown[] }
    assert.deepEqual(b.ok, ['flagship'])
    assert.ok(content.rows.get('flagship')!.deletedAt)
    const listTrash = await call('?trash=1')
    assert.equal(listTrash.status, 200)
    const lt = (await listTrash.json()) as { products: { id: string }[]; cronCleanup: boolean; trashRetentionDays: number }
    assert.equal(lt.cronCleanup, false)
    assert.equal(lt.trashRetentionDays, 30)
    assert.ok(lt.products.some((p) => p.id === 'flagship'))
    const rest = await call('?bulk=1', 'POST', { ids: ['flagship'], op: 'restore' })
    assert.equal(rest.status, 200)
    assert.equal(content.rows.get('flagship')!.deletedAt, null)
  })

  it('bulk add_tags и set_category правят draft.meta', async () => {
    const { call, content } = setup()
    assert.equal((await call('?bulk=1', 'POST', { ids: ['flagship'], op: 'add_tags', tags: ['alpha', 'beta'] })).status, 200)
    assert.equal((await call('?bulk=1', 'POST', { ids: ['flagship'], op: 'set_category', category: 'devices' })).status, 200)
    const meta = content.rows.get('flagship')!.draft.meta as { tags?: string[]; category?: string }
    assert.ok(meta.tags?.includes('alpha'))
    assert.equal(meta.category, 'devices')
  })

  it('дубликат создаёт новый id в draft без публикации', async () => {
    const { call, content, pub } = setup()
    await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })
    const r = await call('?id=flagship&duplicate=1', 'POST', { parts: { card: true, content: true, media: false, documents: false } })
    assert.equal(r.status, 201)
    const body = (await r.json()) as { id: string; content: { status: string; draftRev: number; hasPublished: boolean } }
    assert.match(body.id, /^copy-flagship-/)
    assert.equal(body.content.status, 'draft')
    assert.equal(body.content.hasPublished, false)
    assert.ok(content.rows.has(body.id))
    assert.ok(!(await pub()).products.some((p) => p.id === body.id), 'копия не на сайте')
  })

  it('версия после publish; restore создаёт новую версию и поднимает draftRev', async () => {
    const { call, content } = setup()
    await call('?id=flagship&content=1', 'PUT', { doc: DOC, rev: 0 })
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: 1 })).status, 200)
    const vers = (await (await call('?id=flagship&versions=1')).json()) as { versions: { rev: number; reason: string }[] }
    assert.equal(vers.versions.length, 1)
    assert.equal(vers.versions[0]!.reason, 'publish')
    const doc2 = { ...DOC, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Новое' }] }] }
    assert.equal((await call('?id=flagship&content=1', 'PUT', { doc: doc2, rev: 1 })).status, 200)
    const rest = await call('?id=flagship&restoreVersion=1', 'POST', {})
    assert.equal(rest.status, 200)
    const after = (await rest.json()) as { content: { draftRev: number; draftDoc: { content: { content?: { text?: string }[] }[] } } }
    assert.equal(after.content.draftRev, 3)
    assert.equal(after.content.draftDoc.content[0]!.content![0]!.text, 'Секция')
    assert.ok(content.activity.includes('restoreVersion:flagship:1'))
    assert.equal(content.versionLog.filter((v) => v.productId === 'flagship').length, 2)
  })

  it('card draft не на сайте до publish; preview отдаёт черновик', async () => {
    const { call, pub } = setup()
    const save = await call('?id=flagship&content=1&card=1', 'PUT', {
      rev: 0,
      card: { name: 'Черновик имя', tags: ['t1'], category: 'care' },
    })
    assert.equal(save.status, 200)
    const site = (await pub()).products.find((p) => p.id === 'flagship') as { name?: string }
    assert.notEqual(site.name, 'Черновик имя')
    const prev = await call('?id=flagship&preview=1')
    assert.equal(prev.status, 200)
    const pv = (await prev.json()) as { preview: { name: string }; unpublished: boolean }
    assert.equal(pv.unpublished, true)
    assert.equal(pv.preview.name, 'Черновик имя')
    const c = (await (await call('?id=flagship&content=1')).json()) as { content: { draftRev: number } }
    assert.equal((await call('?id=flagship&publish=1', 'POST', { rev: c.content.draftRev })).status, 200)
  })

  it('purgeExpired удаляет только просроченные в корзине', async () => {
    const { call, content } = setup()
    await call('?id=flagship&trash=1', 'POST', {})
    content.rows.get('flagship')!.deletedAt = '2020-01-01T00:00:00.000Z'
    const r = await call('?purgeExpired=1', 'POST', { keepDays: 30 })
    assert.equal(r.status, 200)
    const body = (await r.json()) as { purged: string[] }
    assert.ok(body.purged.includes('flagship'))
    assert.equal(content.rows.has('flagship'), false)
  })

  it('bulk отклоняет >50 ids и неизвестный op', async () => {
    const { call } = setup()
    const ids = Array.from({ length: 51 }, () => 'flagship')
    assert.equal((await call('?bulk=1', 'POST', { ids, op: 'trash' })).status, 400)
    assert.equal((await call('?bulk=1', 'POST', { ids: ['flagship'], op: 'explode' })).status, 400)
  })
})
