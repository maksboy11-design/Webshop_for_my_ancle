/**
 * API защищённого буфера — вложен в /api/admin/pages?clipboard=… (без новой Vercel-функции).
 * Принимает и отдаёт только шифротекст / конверты ключей / метаданные устройств.
 */
import { randomUUID } from 'node:crypto'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import {
  ClipboardUnavailableError,
  type ClipboardStore,
  type StoredDevice,
  type StoredEntry,
  type StoredVault,
} from './clipboardStore'
import { CLIPBOARD_CIPHER_MAX, CLIPBOARD_ENTRIES_MAX } from '../../src/admin-reviews/secure-clipboard/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const B64 = /^[A-Za-z0-9_-]{8,400000}$/
const JWK = /^\{[\s\S]{20,4000}\}$/

export interface ClipboardHttpDeps {
  clipboard: ClipboardStore | null
  log: Log
}

const viewEntry = (e: StoredEntry) => ({
  id: e.id,
  ciphertext: e.ciphertext,
  encryptedDek: e.encryptedDek,
  iv: e.iv,
  dekIv: e.dekIv,
  formatVersion: e.formatVersion,
  pinned: e.pinned,
  byteSize: e.byteSize,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
})
const viewDevice = (d: StoredDevice) => ({
  id: d.id,
  publicKey: d.publicKey,
  wrappedVaultKey: d.wrappedVaultKey,
  wrapIv: d.wrapIv,
  wrapEphPub: d.wrapEphPub,
  deviceName: d.deviceName,
  status: d.status,
  createdAt: d.createdAt,
  lastSeenAt: d.lastSeenAt,
})
const viewVault = (v: StoredVault) => ({
  vaultVersion: v.vaultVersion,
  keyEnvelopeVersion: v.keyEnvelopeVersion,
  recoveryEnabled: v.recoveryEnabled,
  // Recovery envelope нужен клиенту для восстановления; это не открытый ключ.
  recoveryEnvelope: v.recoveryEnvelope,
  recoveryIv: v.recoveryIv,
  createdAt: v.createdAt,
})

function unavailable(e: unknown, log: Log): Response {
  if (e instanceof ClipboardUnavailableError) {
    log.error('clipboard_unavailable', { errorClass: 'clipboard_table_missing' })
    return jsonResponse(503, { error: 'clipboard_unavailable' })
  }
  log.error('clipboard_storage_failed', { errorClass: e instanceof Error ? e.name : typeof e })
  return jsonResponse(503, { error: 'unavailable' })
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const b = await readLimitedJson(request)
  if (!b.ok) return jsonResponse(b.status, { error: 'bad_request' })
  if (!b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return jsonResponse(400, { error: 'bad_request' })
  return b.value as Record<string, unknown>
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const b64ok = (v: unknown, max = CLIPBOARD_CIPHER_MAX * 2) => typeof v === 'string' && v.length <= max && B64.test(v)

/** Обработчик ?clipboard=… после authorizeAdmin. */
export async function handleClipboardRequest(
  request: Request,
  userId: string,
  deps: ClipboardHttpDeps,
): Promise<Response> {
  if (!deps.clipboard) return jsonResponse(503, { error: 'clipboard_unavailable' })
  const store = deps.clipboard
  const q = new URL(request.url).searchParams
  const nowIso = () => new Date().toISOString()
  const idParam = (name: string) => {
    const v = q.get(name)
    return v && UUID_RE.test(v) ? v.toLowerCase() : null
  }

  try {
    // --- vault ---
    if (q.get('vault') === '1') {
      if (request.method === 'GET') {
        const v = await store.getVault(userId)
        return v ? jsonResponse(200, { vault: viewVault(v) }) : jsonResponse(404, { error: 'not_found' })
      }
      if (request.method === 'POST') {
        const b = await readBody(request)
        if (b instanceof Response) return b
        const recoveryEnabled = b.recoveryEnabled === true
        const recoveryEnvelope = recoveryEnabled ? str(b.recoveryEnvelope, 4000) : null
        const recoveryIv = recoveryEnabled ? str(b.recoveryIv, 64) : null
        if (recoveryEnabled && (!b64ok(recoveryEnvelope, 4000) || !b64ok(recoveryIv, 64)))
          return jsonResponse(400, { error: 'invalid', field: 'recovery' })
        const v = await store.upsertVault({
          userId,
          recoveryEnabled,
          recoveryEnvelope,
          recoveryIv,
          nowIso: nowIso(),
        })
        return jsonResponse(200, { vault: viewVault(v) })
      }
      return jsonResponse(405, { error: 'method_not_allowed' })
    }

    // --- devices ---
    if (q.get('devices') === '1') {
      if (request.method === 'GET') {
        const id = idParam('id')
        if (id) {
          const d = await store.getDevice(userId, id)
          return d ? jsonResponse(200, { device: viewDevice(d) }) : jsonResponse(404, { error: 'not_found' })
        }
        const pending = q.get('pending') === '1'
        const list = await store.listDevices(userId)
        return jsonResponse(200, {
          devices: pending ? list.filter((d) => d.status === 'pending') : list.filter((d) => d.status !== 'revoked'),
        })
      }
      if (request.method === 'POST') {
        const b = await readBody(request)
        if (b instanceof Response) return b
        const approve = idParam('approve')
        if (approve) {
          const wrappedVaultKey = str(b.wrappedVaultKey, 4000)
          const wrapIv = str(b.wrapIv, 64)
          const wrapEphPub = str(b.wrapEphPub, 4000)
          if (!b64ok(wrappedVaultKey, 4000) || !b64ok(wrapIv, 64) || !JWK.test(wrapEphPub))
            return jsonResponse(400, { error: 'invalid', field: 'wrap' })
          const d = await store.approveDevice(userId, approve, { wrappedVaultKey, wrapIv, wrapEphPub }, nowIso())
          return d ? jsonResponse(200, { device: viewDevice(d) }) : jsonResponse(404, { error: 'not_found' })
        }
        const publicKey = str(b.publicKey, 4000)
        if (!JWK.test(publicKey)) return jsonResponse(400, { error: 'invalid', field: 'publicKey' })
        const deviceName = str(b.deviceName, 80) || 'Устройство'
        const id = typeof b.id === 'string' && UUID_RE.test(b.id) ? b.id.toLowerCase() : randomUUID()
        const trusted = b.trusted === true
        const wrappedVaultKey = trusted ? str(b.wrappedVaultKey, 4000) : null
        const wrapIv = trusted ? str(b.wrapIv, 64) : null
        const wrapEphPub = trusted ? str(b.wrapEphPub, 4000) : null
        if (trusted && (!b64ok(wrappedVaultKey, 4000) || !b64ok(wrapIv, 64) || !wrapEphPub || !JWK.test(wrapEphPub)))
          return jsonResponse(400, { error: 'invalid', field: 'wrap' })
        // Первое устройство или явное trusted после recovery — сразу trusted; иначе pending.
        const vault = await store.getVault(userId)
        if (!vault && !trusted) return jsonResponse(400, { error: 'vault_required' })
        const existing = await store.listDevices(userId)
        const status = trusted || existing.filter((d) => d.status === 'trusted').length === 0 ? 'trusted' : 'pending'
        if (status === 'trusted' && !wrappedVaultKey) return jsonResponse(400, { error: 'wrap_required' })
        const d = await store.registerDevice({
          id,
          userId,
          publicKey,
          deviceName,
          wrappedVaultKey: status === 'trusted' ? wrappedVaultKey : null,
          wrapIv: status === 'trusted' ? wrapIv : null,
          wrapEphPub: status === 'trusted' ? wrapEphPub : null,
          status,
          nowIso: nowIso(),
        })
        return jsonResponse(201, { device: viewDevice(d) })
      }
      if (request.method === 'DELETE') {
        const id = idParam('id')
        if (!id) return jsonResponse(400, { error: 'bad_request' })
        const ok = await store.revokeDevice(userId, id, nowIso())
        return ok ? jsonResponse(200, { ok: true }) : jsonResponse(404, { error: 'not_found' })
      }
      if (request.method === 'PUT') {
        const id = idParam('id')
        if (!id) return jsonResponse(400, { error: 'bad_request' })
        await store.touchDevice(userId, id, nowIso())
        return jsonResponse(200, { ok: true })
      }
      return jsonResponse(405, { error: 'method_not_allowed' })
    }

    // --- entries ---
    if (request.method === 'GET') {
      const id = idParam('id')
      if (id) {
        const e = await store.getEntry(userId, id)
        return e ? jsonResponse(200, { entry: viewEntry(e) }) : jsonResponse(404, { error: 'not_found' })
      }
      await store.prune(userId, nowIso())
      const offset = Math.max(0, Math.min(10_000, Number(q.get('offset')) || 0))
      const limit = Math.max(1, Math.min(CLIPBOARD_ENTRIES_MAX, Number(q.get('limit')) || 20))
      const { items, total } = await store.listEntries(userId, offset, limit)
      return jsonResponse(200, { items: items.map(viewEntry), total, offset, limit })
    }

    if (request.method === 'POST') {
      const b = await readBody(request)
      if (b instanceof Response) return b
      const id = typeof b.id === 'string' && UUID_RE.test(b.id) ? b.id.toLowerCase() : randomUUID()
      const ciphertext = str(b.ciphertext, CLIPBOARD_CIPHER_MAX * 2)
      const encryptedDek = str(b.encryptedDek, 1000)
      const iv = str(b.iv, 64)
      const dekIv = str(b.dekIv, 64)
      const formatVersion = Number(b.formatVersion) === 1 ? 1 : 0
      const byteSize = Number(b.byteSize)
      if (!b64ok(ciphertext) || !b64ok(encryptedDek, 1000) || !b64ok(iv, 64) || !b64ok(dekIv, 64) || formatVersion !== 1)
        return jsonResponse(400, { error: 'invalid' })
      if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > CLIPBOARD_CIPHER_MAX)
        return jsonResponse(400, { error: 'invalid', field: 'byteSize' })
      const r = await store.createEntry({
        id,
        userId,
        ciphertext,
        encryptedDek,
        iv,
        dekIv,
        formatVersion,
        pinned: false,
        byteSize,
        nowIso: nowIso(),
      })
      if ('error' in r) return jsonResponse(r.error === 'too_large' ? 413 : 409, { error: r.error })
      return jsonResponse(201, { entry: viewEntry(r) })
    }

    if (request.method === 'PUT') {
      const id = idParam('id')
      if (!id) return jsonResponse(400, { error: 'bad_request' })
      const b = await readBody(request)
      if (b instanceof Response) return b
      if (typeof b.pinned !== 'boolean') return jsonResponse(400, { error: 'invalid', field: 'pinned' })
      const e = await store.setPinned(userId, id, b.pinned, nowIso())
      return e ? jsonResponse(200, { entry: viewEntry(e) }) : jsonResponse(404, { error: 'not_found' })
    }

    if (request.method === 'DELETE') {
      if (q.get('clear') === '1') {
        const n = await store.clearEntries(userId, q.get('unpinned') === '1')
        return jsonResponse(200, { deleted: n })
      }
      const id = idParam('id')
      if (!id) return jsonResponse(400, { error: 'bad_request' })
      const ok = await store.deleteEntry(userId, id)
      return ok ? jsonResponse(200, { ok: true }) : jsonResponse(404, { error: 'not_found' })
    }

    return jsonResponse(405, { error: 'method_not_allowed' })
  } catch (e) {
    return unavailable(e, deps.log)
  }
}
