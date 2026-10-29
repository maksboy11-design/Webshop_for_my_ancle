import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { handleAdminWebinarsRequest, parseWebinarEdit, type AdminWebinarsDeps } from './adminWebinarsHttp'
import { createLogger } from './logger'
import { createMemoryStore } from './memoryStore'
import type { NewWebinar, ReviewStore } from './store'
import { signWebAppInitDataForTests } from './webAppInitData'
import type { YoutubeFetch } from './youtubeImport'

const TOKEN = 'admin-webinars-test-token'
const MOD = '42'
const NOW = new Date('2024-06-01T12:00:00.000Z')
const AUTH = {
  'x-max-init-data': signWebAppInitDataForTests(
    { auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(MOD) }) },
    TOKEN,
  ),
  'content-type': 'application/json',
}

function webinar(over: Partial<NewWebinar> = {}): NewWebinar {
  return {
    id: randomUUID(),
    title: 'Вебинар про здоровье',
    speaker: 'Анна',
    eventDate: '2024-05-01',
    sourceType: 'youtube',
    youtubeVideoId: 'dQw4w9WgXcQ',
    startSeconds: null,
    recordingSrc: null,
    youtubeTitle: null,
    youtubePublishedAt: null,
    metadataStatus: 'ok',
    createdAt: '2024-05-01T10:00:00.000Z',
    contentId: randomUUID(),
    sourceChatId: '1',
    sourceMessageMid: 'mid-' + randomUUID(),
    ...over,
  }
}

function ytFetch(items: unknown[]): YoutubeFetch {
  return async () => ({ ok: true, status: 200, json: async () => ({ items }) })
}

async function setup(fetchImpl: YoutubeFetch | null = null) {
  const store: ReviewStore = createMemoryStore()
  const deps: AdminWebinarsDeps = {
    botToken: TOKEN,
    moderators: new Set([MOD]),
    moderatorsConfigured: true,
    now: () => NOW,
    store,
    log: createLogger(),
    youtube: fetchImpl ? { apiKey: 'k', fetch: fetchImpl } : { apiKey: null },
  }
  const pub = webinar()
  const pend = webinar({ youtubeVideoId: 'aaaaaaaaaaa', title: 'Ожидающий', speaker: 'Борис' })
  await store.transaction(async (tx) => {
    await tx.upsertWebinar(pub, '2024-05-01T10:00:00.000Z')
    await tx.publishWebinar(pub.id, MOD, '2024-05-01T11:00:00.000Z')
    await tx.upsertWebinar(pend, '2024-05-01T10:00:00.000Z')
  })
  const call = (path: string, init: RequestInit = {}) =>
    handleAdminWebinarsRequest(new Request(`https://x.test/api/admin/webinars${path}`, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } }), deps)
  return { store, deps, pub, pend, call }
}

describe('parseWebinarEdit', () => {
  it('валидирует поля, ссылку и время старта', () => {
    assert.equal(parseWebinarEdit({ title: '' }).ok, false)
    assert.equal(parseWebinarEdit({ date: '2024-13-40' }).ok, false)
    assert.equal(parseWebinarEdit({ source: { type: 'youtube', url: 'https://evil.example/watch?v=x' } }).ok, false)
    assert.equal(parseWebinarEdit({ source: { type: 'hosted', src: 'http://a.public.blob.vercel-storage.com/x.mp4' } }).ok, false)
    assert.equal(parseWebinarEdit({ source: { type: 'hosted', src: 'https://evil.example/x.mp4' } }).ok, false)
    assert.equal(parseWebinarEdit({ userId: '1' }).ok, false)
    const ok = parseWebinarEdit({ startSeconds: '1:02:03', source: { type: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' } })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.edit.startSeconds, 3723)
  })
})

describe('admin webinars API', () => {
  it('401 без initData', async () => {
    const { deps } = await setup()
    const r = await handleAdminWebinarsRequest(new Request('https://x.test/api/admin/webinars'), deps)
    assert.equal(r.status, 401)
  })

  it('список, фильтр по статусу и поиск', async () => {
    const { call } = await setup()
    const all = (await (await call('')).json()) as { total: number }
    assert.equal(all.total, 2)
    const pending = (await (await call('?status=pending')).json()) as { total: number; webinars: { title: string }[] }
    assert.equal(pending.total, 1)
    assert.equal(pending.webinars[0]!.title, 'Ожидающий')
    const q = (await (await call('?q=борис')).json()) as { total: number }
    assert.equal(q.total, 1)
    assert.equal((await call('?status=bogus')).status, 400)
  })

  it('правка опубликованного отражается в публичном списке; stale → 409', async () => {
    const { call, pub, store } = await setup()
    const before = (await (await call(`/${pub.id}`)).json()) as { webinar: { updatedAt: string } }
    const r = await call(`/${pub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Новое название', startSeconds: 90, expectedUpdatedAt: before.webinar.updatedAt }),
    })
    assert.equal(r.status, 200)
    const list = await store.listPublicWebinars()
    assert.equal(list.find((w) => w.id === pub.id)?.title, 'Новое название')
    const stale = await call(`/${pub.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'X', expectedUpdatedAt: before.webinar.updatedAt }) })
    assert.equal(stale.status, 409)
  })

  it('дубликат ролика → 409', async () => {
    const { call, pend } = await setup()
    const r = await call(`/${pend.id}`, { method: 'PATCH', body: JSON.stringify({ source: { type: 'youtube', url: 'dQw4w9WgXcQ' } }) })
    assert.equal(r.status, 409)
  })

  it('провал проверки YouTube не ломает опубликованную запись', async () => {
    const { call, pub, store } = await setup(ytFetch([]))
    const r = await call(`/${pub.id}`, { method: 'PATCH', body: JSON.stringify({ source: { type: 'youtube', url: 'bbbbbbbbbbb' } }) })
    assert.equal(r.status, 422)
    const body = (await r.json()) as { error: string; metadataText: string }
    assert.equal(body.error, 'verification_failed')
    assert.ok(body.metadataText.length > 0)
    const fresh = await store.transaction((tx) => tx.getWebinar(pub.id))
    assert.equal(fresh?.status, 'published')
    assert.equal(fresh?.youtubeVideoId, 'dQw4w9WgXcQ')
  })

  it('снятие мягкое и идемпотентное, отклонение ожидающего', async () => {
    const { call, pub, pend, store } = await setup()
    const first = (await (await call(`/${pub.id}`, { method: 'DELETE' })).json()) as { status: string }
    assert.equal(first.status, 'withdrawn')
    const again = (await (await call(`/${pub.id}`, { method: 'DELETE' })).json()) as { status: string; already: boolean }
    assert.deepEqual([again.status, again.already], ['withdrawn', true])
    assert.ok(await store.transaction((tx) => tx.getWebinar(pub.id)), 'запись не удалена физически')
    const rej = (await (await call(`/${pend.id}`, { method: 'DELETE' })).json()) as { status: string }
    assert.equal(rej.status, 'rejected')
    const edit = await call(`/${pend.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) })
    assert.equal(edit.status, 409)
    assert.equal((await store.listPublicWebinars()).length, 0)
  })
})
