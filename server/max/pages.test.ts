import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLogger } from './logger'
import { handleAdminPagesRequest, handlePublicPagesRequest } from './pagesHttp'
import { createMemoryPagesStore, PagesUnavailableError, type PagesStore } from './pagesStore'
import { signWebAppInitDataForTests } from './webAppInitData'
import { emptyPageDoc, type PageDoc } from '../../src/cms/pageDoc'

/** Раздел «Страницы» на памяти: без БД и без сети. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ответы API в тестах читаются свободно
type Json = Record<string, any>
const TOKEN = 'pages-test-token'
const MOD = '42'
const NOW = new Date('2026-11-01T12:00:00.000Z')
const init = (id: string) =>
  signWebAppInitDataForTests({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(id) }) }, TOKEN)
const log = { info() {}, warn() {}, error() {} } as unknown as ReturnType<typeof createLogger>

function setup(pages: PagesStore | null = createMemoryPagesStore()) {
  const deps = { botToken: TOKEN, moderators: new Set([MOD]), moderatorsConfigured: true, now: () => NOW, pages, media: null, log }
  const call = async (method: string, q: string, body?: unknown, user = MOD) => {
    const r = await handleAdminPagesRequest(
      new Request(`https://x.test/api/admin/pages${q}`, {
        method,
        headers: { 'x-max-init-data': init(user), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      deps,
    )
    return { status: r.status, json: (await r.json()) as Json }
  }
  const pub = async (slug: string) => {
    const r = await handlePublicPagesRequest(new Request(`https://x.test/api/pages?slug=${slug}`), { pages, log })
    return { status: r.status, json: (await r.json()) as Json, cache: r.headers.get('cache-control') }
  }
  return { call, pub, pages }
}

const textDoc = (text: string): PageDoc => ({
  ...emptyPageDoc(),
  blocks: [
    {
      id: 't1',
      type: 'text',
      width: 'normal',
      align: 'left',
      card: false,
      label: '',
      doc: { type: 'doc', version: 1, content: [{ type: 'paragraph', attrs: { autoBold: false }, content: [{ type: 'text', text }] }] },
    },
  ],
})

describe('pages http', () => {
  it('требует модератора', async () => {
    const { call } = setup()
    assert.equal((await call('GET', '?list=1', undefined, '7')).status, 403)
  })

  it('без таблицы — 503 и на сайте, и в админке', async () => {
    const broken: PagesStore = new Proxy({} as PagesStore, {
      get: () => async () => {
        throw new PagesUnavailableError()
      },
    })
    const { call, pub } = setup(broken)
    assert.equal((await call('GET', '?list=1')).json.error, 'pages_unavailable')
    const p = await pub('science')
    assert.equal(p.status, 503)
    assert.equal(p.json.error, 'pages_unavailable')
    assert.equal((await setup(null).pub('science')).status, 503)
  })

  it('создание: slug из названия, уникальный; черновик не публичен', async () => {
    const { call, pub } = setup()
    const a = await call('POST', '?create=1', { title: 'О компании' })
    assert.equal(a.status, 201)
    assert.equal(a.json.page.slug, 'o-kompanii')
    assert.equal(a.json.page.status, 'draft')
    const b = await call('POST', '?create=1', { title: 'О компании' })
    assert.equal(b.json.page.slug, 'o-kompanii-2')
    assert.equal((await pub('o-kompanii')).status, 404)
  })

  it('черновик → публикация → публичный GET отдаёт только опубликованное', async () => {
    const { call, pub } = setup()
    const id = (await call('POST', '?create=1', { title: 'Тест' })).json.page.id
    const s = await call('PUT', `?id=${id}`, { title: 'Тест', slug: 'test-page', doc: textDoc('один'), rev: 1, version: true })
    assert.equal(s.status, 200, JSON.stringify(s.json))
    assert.equal((await pub('test-page')).status, 404)
    assert.equal((await call('POST', `?publish=${id}`, {})).status, 200)
    const p1 = await pub('test-page')
    assert.equal(p1.status, 200)
    assert.match(JSON.stringify(p1.json.page.doc), /один/)
    assert.ok(p1.cache?.includes('s-maxage'))
    // Новый черновик не утекает на сайт до публикации.
    await call('PUT', `?id=${id}`, { title: 'Тест', slug: 'test-page', doc: textDoc('два'), rev: s.json.page.rev })
    assert.match(JSON.stringify((await pub('test-page')).json.page.doc), /один/)
    const view = (await call('GET', `?id=${id}`)).json.page
    assert.equal(view.changed, true)
    await call('POST', `?unpublish=${id}`, {})
    assert.equal((await pub('test-page')).status, 404)
  })

  it('конфликт ревизий → 409 с текущей версией', async () => {
    const { call } = setup()
    const id = (await call('POST', '?create=1', { title: 'К' })).json.page.id
    await call('PUT', `?id=${id}`, { title: 'К', slug: 'k-page', doc: textDoc('a'), rev: 1 })
    const c = await call('PUT', `?id=${id}`, { title: 'К', slug: 'k-page', doc: textDoc('b'), rev: 1 })
    assert.equal(c.status, 409)
    assert.equal(c.json.error, 'conflict')
    assert.equal(c.json.page.rev, 2)
  })

  it('валидация: slug, XSS, внешние ссылки, ссылка на себя', async () => {
    const { call } = setup()
    const id = (await call('POST', '?create=1', { title: 'В' })).json.page.id
    const put = (doc: unknown, slug = 'v-page') => call('PUT', `?id=${id}`, { title: 'В', slug, doc, rev: 1 })
    assert.equal((await put(emptyPageDoc(), 'Bad Slug')).json.error, 'invalid_slug')
    assert.equal((await put(emptyPageDoc(), 'admin')).json.error, 'invalid_slug')
    const btn = (target: unknown) => ({
      ...emptyPageDoc(),
      blocks: [{ id: 'b1', type: 'button', width: 'normal', align: 'left', text: 'Жми', variant: 'primary', target }],
    })
    assert.equal((await put(btn({ kind: 'external', url: 'https://evil.test' }))).json.error, 'external_not_allowed')
    assert.equal((await put(btn({ kind: 'external', url: 'javascript:alert(1)' }))).status, 400)
    assert.equal((await put(btn({ kind: 'page', pageId: id }))).json.error, 'self_link')
    // HTML в тексте хранится как текст; неизвестные марки/узлы отбрасываются или отклоняются.
    const x = await put(textDoc('<img src=x onerror=alert(1)>'))
    assert.equal(x.status, 200)
    assert.equal(x.json.page.doc.blocks[0].doc.content[0].content[0].text, '<img src=x onerror=alert(1)>')
    assert.equal((await put({ ...emptyPageDoc(), blocks: [{ id: 'q', type: 'script', width: 'normal', align: 'left' }] })).status, 400)
  })

  it('кнопки: предупреждения при публикации и защита от удаления цели', async () => {
    const { call } = setup()
    const target = (await call('POST', '?create=1', { title: 'Цель' })).json.page.id
    const src = (await call('POST', '?create=1', { title: 'Источник' })).json.page.id
    const doc = {
      ...emptyPageDoc(),
      blocks: [
        {
          id: 'b1',
          type: 'button',
          width: 'normal',
          align: 'center',
          text: 'Дальше',
          variant: 'primary',
          target: { kind: 'page', pageId: target },
        },
      ],
    }
    assert.equal((await call('PUT', `?id=${src}`, { title: 'Источник', slug: 'istochnik', doc, rev: 1 })).status, 200)
    const p = await call('POST', `?publish=${src}`, {})
    assert.deepEqual(p.json.warnings, [{ blockId: 'b1', pageId: target, problem: 'unpublished' }])
    const g = await call('GET', `?id=${target}`)
    assert.equal(g.json.referencedBy[0].id, src)
    const d = await call('DELETE', `?id=${target}`)
    assert.equal(d.status, 409)
    assert.equal(d.json.error, 'referenced')
    assert.equal((await call('DELETE', `?id=${target}&force=1`)).status, 200)
    assert.equal((await call('GET', '?list=1&trash=1')).json.items.length, 1)
    assert.equal((await call('POST', `?restore=${target}`, {})).status, 200)
  })

  it('публичные ссылки — только на опубликованные страницы', async () => {
    const { call, pub } = setup()
    const target = (await call('POST', '?create=1', { title: 'Цель' })).json.page.id
    const src = (await call('POST', '?create=1', { title: 'Источник' })).json.page.id
    const doc = {
      ...emptyPageDoc(),
      blocks: [
        {
          id: 'b1',
          type: 'button',
          width: 'normal',
          align: 'left',
          text: 'Дальше',
          variant: 'primary',
          target: { kind: 'page', pageId: target },
        },
      ],
    }
    await call('PUT', `?id=${src}`, { title: 'Источник', slug: 'istochnik', doc, rev: 1 })
    await call('POST', `?publish=${src}`, {})
    assert.deepEqual((await pub('istochnik')).json.links, {})
    await call('POST', `?publish=${target}`, {})
    assert.equal((await pub('istochnik')).json.links[target].slug, 'tsel')
  })

  it('публикация цели сообщает о кнопках, которые есть только в черновике других страниц', async () => {
    const { call } = setup()
    const target = (await call('POST', '?create=1', { title: 'Цель' })).json.page.id
    const src = (await call('POST', '?create=1', { title: 'Источник' })).json.page.id
    const rev = (await call('POST', `?publish=${src}`, {})).json.page.rev
    const btn = { id: 'b1', type: 'button', width: 'normal', align: 'left', text: 'Дальше', variant: 'primary', target: { kind: 'page', pageId: target } }
    const s = await call('PUT', `?id=${src}`, { title: 'Источник', slug: 'istochnik', doc: { ...emptyPageDoc(), blocks: [btn] }, rev })
    assert.equal(s.status, 200)
    assert.equal(s.json.page.changed, true)
    const p = await call('POST', `?publish=${target}`, {})
    assert.deepEqual(p.json.pendingBacklinks.map((x: { id: string }) => x.id), [src])
    await call('POST', `?publish=${src}`, {})
    assert.deepEqual((await call('POST', `?publish=${target}`, {})).json.pendingBacklinks, [])
  })

  it('версии: при сохранении с version и публикации; восстановление = новая версия', async () => {
    const { call } = setup()
    const id = (await call('POST', '?create=1', { title: 'Вер' })).json.page.id
    const a = await call('PUT', `?id=${id}`, { title: 'Вер', slug: 'ver', doc: textDoc('первый'), rev: 1, version: true })
    await call('PUT', `?id=${id}`, { title: 'Вер', slug: 'ver', doc: textDoc('автосохранение'), rev: a.json.page.rev })
    await call('POST', `?publish=${id}`, {})
    const v = (await call('GET', `?versions=${id}`)).json.versions as { rev: number; reason: string }[]
    assert.deepEqual(
      v.map((x) => x.reason),
      ['publish', 'save', 'save'],
    )
    const first = v.find((x) => x.reason === 'save')!.rev
    const one = await call('GET', `?versions=${id}&rev=${first}`)
    assert.match(JSON.stringify(one.json.version), /первый/)
    assert.equal((await call('POST', `?restoreVersion=${id}&rev=${first}`, {})).status, 200)
    const after = (await call('GET', `?versions=${id}`)).json.versions as { reason: string; restoredFromRev: number | null }[]
    assert.equal(after[0]!.reason, 'restore')
    assert.equal(after[0]!.restoredFromRev, first)
    assert.match(JSON.stringify((await call('GET', `?id=${id}`)).json.page.doc), /первый/)
  })

  it('дубликат, поиск и фильтр статуса, журнал действий', async () => {
    const { call, pages } = setup()
    const id = (await call('POST', '?create=1', { title: 'Альфа' })).json.page.id
    await call('POST', '?create=1', { title: 'Бета' })
    const dup = await call('POST', `?duplicate=${id}`, {})
    assert.equal(dup.json.page.title, 'Альфа (копия)')
    await call('POST', `?publish=${id}`, {})
    assert.equal((await call('GET', '?list=1&q=альф')).json.total, 2)
    assert.equal((await call('GET', '?list=1&status=published')).json.items[0].id, id)
    assert.equal((await call('GET', '?list=1&limit=1')).json.items.length, 1)
    assert.ok((pages as ReturnType<typeof createMemoryPagesStore>).activity.length >= 4)
  })
})
