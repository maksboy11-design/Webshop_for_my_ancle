import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authorizeAdmin } from './adminAuth'
import { createLogger } from './logger'
import { handleClipboardRequest } from './clipboardHttp'
import { createMemoryClipboardStore } from './clipboardStore'
import { handleAdminPagesRequest } from './pagesHttp'
import { createMemoryPagesStore } from './pagesStore'
import { signWebAppInitDataForTests } from './webAppInitData'

const TOKEN = 'clipboard-test-token'
const MOD = '7'
const NOW = new Date('2024-06-01T12:00:00.000Z')
const JWK =
  '{"kty":"EC","crv":"P-256","x":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","y":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
const JWK2 =
  '{"kty":"EC","crv":"P-256","x":"ccccccccccccccccccccccccccccccccccccccccccc","y":"ddddddddddddddddddddddddddddddddddddddddddd"}'

function initData(userId: string, authDate = Math.floor(NOW.getTime() / 1000)) {
  return signWebAppInitDataForTests({ auth_date: String(authDate), user: JSON.stringify({ id: Number(userId) }) }, TOKEN)
}

const auth = { 'x-max-init-data': initData(MOD) }

function clipboardDeps(store = createMemoryClipboardStore()) {
  return { clipboard: store, log: createLogger() }
}

describe('clipboard HTTP: только шифротекст', () => {
  it('создаёт vault и устройство без открытых ключей в ответе', async () => {
    const store = createMemoryClipboardStore()
    const deps = clipboardDeps(store)
    const r = await handleClipboardRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&vault=1', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          recoveryEnabled: true,
          recoveryEnvelope: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo',
          recoveryIv: 'YWJjZGVmZ2hpams',
        }),
      }),
      MOD,
      deps,
    )
    assert.equal(r.status, 200, await r.clone().text())
    const body = (await r.json()) as Record<string, unknown>
    assert.equal('vaultKey' in body, false)
    assert.equal('dek' in body, false)
    assert.equal('plaintext' in body, false)

    const d = await handleClipboardRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&devices=1', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: '11111111-1111-4111-8111-111111111111',
          publicKey: JWK,
          deviceName: 'Тест',
          trusted: true,
          wrappedVaultKey: 'd3JhcHBlZGtleXZhbHVl',
          wrapIv: 'd3JhcGl2MTI',
          wrapEphPub: JWK2,
        }),
      }),
      MOD,
      deps,
    )
    assert.equal(d.status, 201, await d.clone().text())
  })

  it('сохраняет запись и не отдаёт plaintext', async () => {
    const store = createMemoryClipboardStore()
    const deps = clipboardDeps(store)
    await store.upsertVault({
      userId: MOD,
      recoveryEnabled: false,
      recoveryEnvelope: null,
      recoveryIv: null,
      nowIso: NOW.toISOString(),
    })
    const ok = await handleClipboardRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&entries=1', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: '22222222-2222-4222-8222-222222222222',
          ciphertext: 'Y2lwaGVydGV4dFNlY3JldA',
          encryptedDek: 'ZW5jZGVrMTIzNA',
          iv: 'aXY0NTY3OQ',
          dekIv: 'ZGVraXY0NTY',
          formatVersion: 1,
          byteSize: 12,
        }),
      }),
      MOD,
      deps,
    )
    assert.equal(ok.status, 201, await ok.clone().text())
    const listed = await handleClipboardRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&entries=1&offset=0&limit=10', { headers: auth }),
      MOD,
      deps,
    )
    assert.equal(listed.status, 200)
    const j = (await listed.json()) as { items: { ciphertext: string }[]; total: number }
    assert.equal(j.total, 1)
    assert.equal(j.items[0]!.ciphertext, 'Y2lwaGVydGV4dFNlY3JldA')
    const raw = JSON.stringify(j)
    assert.ok(!raw.includes('Подробнее'))
    assert.ok(!raw.includes('"type":"button"'))
  })

  it('чужой пользователь не видит записи', async () => {
    const store = createMemoryClipboardStore()
    const deps = clipboardDeps(store)
    await store.upsertVault({
      userId: MOD,
      recoveryEnabled: false,
      recoveryEnvelope: null,
      recoveryIv: null,
      nowIso: NOW.toISOString(),
    })
    await store.createEntry({
      id: '33333333-3333-4333-8333-333333333333',
      userId: MOD,
      ciphertext: 'c2VjcmV0MTIz',
      encryptedDek: 'ZGVrZW5jMTI',
      iv: 'aXY0NTY3OQ',
      dekIv: 'ZGVraXY0NTY',
      formatVersion: 1,
      pinned: false,
      byteSize: 6,
      nowIso: NOW.toISOString(),
    })
    const other = await handleClipboardRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&entries=1', {
        headers: { 'x-max-init-data': initData('99') },
      }),
      '99',
      deps,
    )
    assert.equal(other.status, 200)
    const j = (await other.json()) as { total: number; items: unknown[] }
    assert.equal(j.total, 0)
    assert.equal(j.items.length, 0)
  })
})

describe('clipboard свёрнут в admin/pages', () => {
  it('?clipboard=1 маршрутизируется без отдельной функции', async () => {
    const store = createMemoryClipboardStore()
    const r = await handleAdminPagesRequest(
      new Request('https://x.test/api/admin/pages?clipboard=1&vault=1', { headers: auth }),
      {
        botToken: TOKEN,
        moderators: new Set([MOD]),
        moderatorsConfigured: true,
        now: () => NOW,
        pages: createMemoryPagesStore(),
        media: null,
        clipboard: store,
        log: createLogger(),
      },
    )
    assert.equal(r.status, 404)
    const j = (await r.json()) as { error: string }
    assert.equal(j.error, 'not_found')
  })
})

describe('authorizeAdmin для clipboard', () => {
  it('без initData — 401', async () => {
    const a = await authorizeAdmin(new Request('https://x.test/api/admin/pages?clipboard=1'), {
      botToken: TOKEN,
      moderators: new Set([MOD]),
      moderatorsConfigured: true,
      now: () => NOW,
    })
    assert.equal(a.ok, false)
  })
})
