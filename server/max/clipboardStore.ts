/**
 * Хранилище защищённого буфера (шифротекст и конверты ключей). Миграция 012.
 * Сервер не расшифровывает содержимое.
 */
import type { SqlPool } from './postgresStore'
import { CLIPBOARD_CIPHER_MAX, CLIPBOARD_ENTRIES_MAX, CLIPBOARD_TTL_DAYS } from '../../src/admin-reviews/secure-clipboard/types'

export class ClipboardUnavailableError extends Error {
  constructor() {
    super('clipboard tables missing')
    this.name = 'ClipboardUnavailableError'
  }
}

export interface StoredEntry {
  id: string
  userId: string
  ciphertext: string
  encryptedDek: string
  iv: string
  dekIv: string
  formatVersion: number
  pinned: boolean
  byteSize: number
  createdAt: string
  updatedAt: string
}

export interface StoredDevice {
  id: string
  userId: string
  publicKey: string
  wrappedVaultKey: string | null
  wrapIv: string | null
  wrapEphPub: string | null
  deviceName: string
  status: 'pending' | 'trusted' | 'revoked'
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
}

export interface StoredVault {
  userId: string
  vaultVersion: number
  keyEnvelopeVersion: number
  recoveryEnabled: boolean
  recoveryEnvelope: string | null
  recoveryIv: string | null
  createdAt: string
}

export interface ClipboardStore {
  getVault(userId: string): Promise<StoredVault | null>
  upsertVault(v: {
    userId: string
    recoveryEnabled: boolean
    recoveryEnvelope: string | null
    recoveryIv: string | null
    nowIso: string
  }): Promise<StoredVault>
  listDevices(userId: string): Promise<StoredDevice[]>
  getDevice(userId: string, id: string): Promise<StoredDevice | null>
  registerDevice(d: {
    id: string
    userId: string
    publicKey: string
    deviceName: string
    wrappedVaultKey: string | null
    wrapIv: string | null
    wrapEphPub: string | null
    status: 'pending' | 'trusted'
    nowIso: string
  }): Promise<StoredDevice>
  approveDevice(userId: string, id: string, wrap: { wrappedVaultKey: string; wrapIv: string; wrapEphPub: string }, nowIso: string): Promise<StoredDevice | null>
  touchDevice(userId: string, id: string, nowIso: string): Promise<void>
  revokeDevice(userId: string, id: string, nowIso: string): Promise<boolean>
  listEntries(userId: string, offset: number, limit: number): Promise<{ items: StoredEntry[]; total: number }>
  getEntry(userId: string, id: string): Promise<StoredEntry | null>
  createEntry(e: Omit<StoredEntry, 'createdAt' | 'updatedAt'> & { nowIso: string }): Promise<StoredEntry | { error: 'limit' | 'too_large' }>
  setPinned(userId: string, id: string, pinned: boolean, nowIso: string): Promise<StoredEntry | null>
  deleteEntry(userId: string, id: string): Promise<boolean>
  clearEntries(userId: string, onlyUnpinned: boolean): Promise<number>
  prune(userId: string, nowIso: string): Promise<number>
}

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'
const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : String(v))

function mapVault(r: Record<string, unknown>): StoredVault {
  return {
    userId: String(r.user_id),
    vaultVersion: Number(r.vault_version),
    keyEnvelopeVersion: Number(r.key_envelope_version),
    recoveryEnabled: !!r.recovery_enabled,
    recoveryEnvelope: r.recovery_envelope == null ? null : String(r.recovery_envelope),
    recoveryIv: r.recovery_iv == null ? null : String(r.recovery_iv),
    createdAt: iso(r.created_at as string | Date),
  }
}
function mapDevice(r: Record<string, unknown>): StoredDevice {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    publicKey: String(r.public_key),
    wrappedVaultKey: r.wrapped_vault_key == null ? null : String(r.wrapped_vault_key),
    wrapIv: r.wrap_iv == null ? null : String(r.wrap_iv),
    wrapEphPub: r.wrap_eph_pub == null ? null : String(r.wrap_eph_pub),
    deviceName: String(r.device_name ?? ''),
    status: r.status as StoredDevice['status'],
    createdAt: iso(r.created_at as string | Date),
    lastSeenAt: iso(r.last_seen_at as string | Date),
    revokedAt: r.revoked_at == null ? null : iso(r.revoked_at as string | Date),
  }
}
function mapEntry(r: Record<string, unknown>): StoredEntry {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    ciphertext: String(r.ciphertext),
    encryptedDek: String(r.encrypted_dek),
    iv: String(r.iv),
    dekIv: String(r.dek_iv),
    formatVersion: Number(r.format_version),
    pinned: !!r.pinned,
    byteSize: Number(r.byte_size),
    createdAt: iso(r.created_at as string | Date),
    updatedAt: iso(r.updated_at as string | Date),
  }
}

export function createMemoryClipboardStore(): ClipboardStore & {
  vaults: Map<string, StoredVault>
  devices: Map<string, StoredDevice>
  entries: Map<string, StoredEntry>
} {
  const vaults = new Map<string, StoredVault>()
  const devices = new Map<string, StoredDevice>()
  const entries = new Map<string, StoredEntry>()
  const store: ClipboardStore = {
    async getVault(userId) {
      return vaults.get(userId) ?? null
    },
    async upsertVault({ userId, recoveryEnabled, recoveryEnvelope, recoveryIv, nowIso }) {
      const cur = vaults.get(userId)
      const v: StoredVault = {
        userId,
        vaultVersion: cur?.vaultVersion ?? 1,
        keyEnvelopeVersion: cur?.keyEnvelopeVersion ?? 1,
        recoveryEnabled,
        recoveryEnvelope,
        recoveryIv,
        createdAt: cur?.createdAt ?? nowIso,
      }
      vaults.set(userId, v)
      return v
    },
    async listDevices(userId) {
      return [...devices.values()].filter((d) => d.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async getDevice(userId, id) {
      const d = devices.get(id)
      return d && d.userId === userId ? d : null
    },
    async registerDevice(d) {
      const row: StoredDevice = {
        id: d.id,
        userId: d.userId,
        publicKey: d.publicKey,
        wrappedVaultKey: d.wrappedVaultKey,
        wrapIv: d.wrapIv,
        wrapEphPub: d.wrapEphPub,
        deviceName: d.deviceName.slice(0, 80),
        status: d.status,
        createdAt: d.nowIso,
        lastSeenAt: d.nowIso,
        revokedAt: null,
      }
      devices.set(d.id, row)
      return row
    },
    async approveDevice(userId, id, wrap, nowIso) {
      const d = devices.get(id)
      if (!d || d.userId !== userId || d.status === 'revoked') return null
      const next = { ...d, ...wrap, status: 'trusted' as const, lastSeenAt: nowIso }
      devices.set(id, next)
      return next
    },
    async touchDevice(userId, id, nowIso) {
      const d = devices.get(id)
      if (d && d.userId === userId) devices.set(id, { ...d, lastSeenAt: nowIso })
    },
    async revokeDevice(userId, id, nowIso) {
      const d = devices.get(id)
      if (!d || d.userId !== userId) return false
      devices.set(id, { ...d, status: 'revoked', revokedAt: nowIso, wrappedVaultKey: null, wrapIv: null, wrapEphPub: null })
      return true
    },
    async listEntries(userId, offset, limit) {
      const all = [...entries.values()]
        .filter((e) => e.userId === userId)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
    async getEntry(userId, id) {
      const e = entries.get(id)
      return e && e.userId === userId ? e : null
    },
    async createEntry(e) {
      if (e.byteSize > CLIPBOARD_CIPHER_MAX) return { error: 'too_large' }
      const mine = [...entries.values()].filter((x) => x.userId === e.userId)
      if (mine.length >= CLIPBOARD_ENTRIES_MAX) {
        const old = mine.filter((x) => !x.pinned).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
        if (!old) return { error: 'limit' }
        entries.delete(old.id)
      }
      const row: StoredEntry = {
        id: e.id,
        userId: e.userId,
        ciphertext: e.ciphertext,
        encryptedDek: e.encryptedDek,
        iv: e.iv,
        dekIv: e.dekIv,
        formatVersion: e.formatVersion,
        pinned: e.pinned,
        byteSize: e.byteSize,
        createdAt: e.nowIso,
        updatedAt: e.nowIso,
      }
      entries.set(e.id, row)
      return row
    },
    async setPinned(userId, id, pinned, nowIso) {
      const e = entries.get(id)
      if (!e || e.userId !== userId) return null
      const next = { ...e, pinned, updatedAt: nowIso }
      entries.set(id, next)
      return next
    },
    async deleteEntry(userId, id) {
      const e = entries.get(id)
      if (!e || e.userId !== userId) return false
      entries.delete(id)
      return true
    },
    async clearEntries(userId, onlyUnpinned) {
      let n = 0
      for (const [id, e] of entries) {
        if (e.userId === userId && (!onlyUnpinned || !e.pinned)) {
          entries.delete(id)
          n++
        }
      }
      return n
    },
    async prune(userId, nowIso) {
      const cutoff = Date.parse(nowIso) - CLIPBOARD_TTL_DAYS * 86400_000
      let n = 0
      for (const [id, e] of entries) {
        if (e.userId === userId && !e.pinned && Date.parse(e.createdAt) < cutoff) {
          entries.delete(id)
          n++
        }
      }
      return n
    },
  }
  return Object.assign(store, { vaults, devices, entries })
}

export function createPgClipboardStore(pool: SqlPool): ClipboardStore {
  type C = Awaited<ReturnType<SqlPool['connect']>>
  const withClient = async <T>(fn: (c: C) => Promise<T>): Promise<T> => {
    const c = await pool.connect()
    try {
      return await fn(c)
    } catch (e) {
      if (isMissing(e)) throw new ClipboardUnavailableError()
      throw e
    } finally {
      c.release()
    }
  }
  return {
    async getVault(userId) {
      return withClient(async (c) => {
        const r = await c.query(`SELECT * FROM clipboard_vaults WHERE user_id = $1::bigint`, [userId])
        return r.rows[0] ? mapVault(r.rows[0] as Record<string, unknown>) : null
      })
    },
    async upsertVault({ userId, recoveryEnabled, recoveryEnvelope, recoveryIv, nowIso }) {
      return withClient(async (c) => {
        const r = await c.query(
          `INSERT INTO clipboard_vaults (user_id, recovery_enabled, recovery_envelope, recovery_iv, created_at)
           VALUES ($1::bigint, $2, $3, $4, $5::timestamptz)
           ON CONFLICT (user_id) DO UPDATE SET
             recovery_enabled = EXCLUDED.recovery_enabled,
             recovery_envelope = EXCLUDED.recovery_envelope,
             recovery_iv = EXCLUDED.recovery_iv
           RETURNING *`,
          [userId, recoveryEnabled, recoveryEnvelope, recoveryIv, nowIso],
        )
        return mapVault(r.rows[0] as Record<string, unknown>)
      })
    },
    async listDevices(userId) {
      return withClient(async (c) => {
        const r = await c.query(`SELECT * FROM clipboard_devices WHERE user_id = $1::bigint ORDER BY created_at DESC`, [userId])
        return r.rows.map((row) => mapDevice(row as Record<string, unknown>))
      })
    },
    async getDevice(userId, id) {
      return withClient(async (c) => {
        const r = await c.query(`SELECT * FROM clipboard_devices WHERE user_id = $1::bigint AND id = $2::uuid`, [userId, id])
        return r.rows[0] ? mapDevice(r.rows[0] as Record<string, unknown>) : null
      })
    },
    async registerDevice(d) {
      return withClient(async (c) => {
        const r = await c.query(
          `INSERT INTO clipboard_devices
            (id, user_id, public_key, wrapped_vault_key, wrap_iv, wrap_eph_pub, device_name, status, created_at, last_seen_at)
           VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)
           RETURNING *`,
          [d.id, d.userId, d.publicKey, d.wrappedVaultKey, d.wrapIv, d.wrapEphPub, d.deviceName.slice(0, 80), d.status, d.nowIso],
        )
        return mapDevice(r.rows[0] as Record<string, unknown>)
      })
    },
    async approveDevice(userId, id, wrap, nowIso) {
      return withClient(async (c) => {
        const r = await c.query(
          `UPDATE clipboard_devices SET
             wrapped_vault_key = $3, wrap_iv = $4, wrap_eph_pub = $5, status = 'trusted', last_seen_at = $6::timestamptz
           WHERE user_id = $1::bigint AND id = $2::uuid AND status <> 'revoked'
           RETURNING *`,
          [userId, id, wrap.wrappedVaultKey, wrap.wrapIv, wrap.wrapEphPub, nowIso],
        )
        return r.rows[0] ? mapDevice(r.rows[0] as Record<string, unknown>) : null
      })
    },
    async touchDevice(userId, id, nowIso) {
      await withClient(async (c) => {
        await c.query(`UPDATE clipboard_devices SET last_seen_at = $3::timestamptz WHERE user_id = $1::bigint AND id = $2::uuid`, [
          userId,
          id,
          nowIso,
        ])
      })
    },
    async revokeDevice(userId, id, nowIso) {
      return withClient(async (c) => {
        const r = await c.query(
          `UPDATE clipboard_devices SET status = 'revoked', revoked_at = $3::timestamptz,
             wrapped_vault_key = NULL, wrap_iv = NULL, wrap_eph_pub = NULL
           WHERE user_id = $1::bigint AND id = $2::uuid RETURNING id`,
          [userId, id, nowIso],
        )
        return (r.rowCount ?? 0) > 0
      })
    },
    async listEntries(userId, offset, limit) {
      return withClient(async (c) => {
        const total = await c.query(`SELECT count(*)::int AS n FROM clipboard_entries WHERE user_id = $1::bigint`, [userId])
        const r = await c.query(
          `SELECT * FROM clipboard_entries WHERE user_id = $1::bigint
           ORDER BY pinned DESC, created_at DESC OFFSET $2 LIMIT $3`,
          [userId, offset, limit],
        )
        return { items: r.rows.map((row) => mapEntry(row as Record<string, unknown>)), total: Number((total.rows[0] as { n: number }).n) }
      })
    },
    async getEntry(userId, id) {
      return withClient(async (c) => {
        const r = await c.query(`SELECT * FROM clipboard_entries WHERE user_id = $1::bigint AND id = $2::uuid`, [userId, id])
        return r.rows[0] ? mapEntry(r.rows[0] as Record<string, unknown>) : null
      })
    },
    async createEntry(e) {
      if (e.byteSize > CLIPBOARD_CIPHER_MAX) return { error: 'too_large' }
      return withClient(async (c) => {
        const cnt = await c.query(`SELECT count(*)::int AS n FROM clipboard_entries WHERE user_id = $1::bigint`, [e.userId])
        if (Number((cnt.rows[0] as { n: number }).n) >= CLIPBOARD_ENTRIES_MAX) {
          const old = await c.query(
            `SELECT id FROM clipboard_entries WHERE user_id = $1::bigint AND pinned = false ORDER BY created_at ASC LIMIT 1`,
            [e.userId],
          )
          if (!old.rows[0]) return { error: 'limit' as const }
          await c.query(`DELETE FROM clipboard_entries WHERE id = $1::uuid`, [(old.rows[0] as { id: string }).id])
        }
        const r = await c.query(
          `INSERT INTO clipboard_entries
            (id, user_id, ciphertext, encrypted_dek, iv, dek_iv, format_version, pinned, byte_size, created_at, updated_at)
           VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz)
           RETURNING *`,
          [e.id, e.userId, e.ciphertext, e.encryptedDek, e.iv, e.dekIv, e.formatVersion, e.pinned, e.byteSize, e.nowIso],
        )
        return mapEntry(r.rows[0] as Record<string, unknown>)
      })
    },
    async setPinned(userId, id, pinned, nowIso) {
      return withClient(async (c) => {
        const r = await c.query(
          `UPDATE clipboard_entries SET pinned = $3, updated_at = $4::timestamptz
           WHERE user_id = $1::bigint AND id = $2::uuid RETURNING *`,
          [userId, id, pinned, nowIso],
        )
        return r.rows[0] ? mapEntry(r.rows[0] as Record<string, unknown>) : null
      })
    },
    async deleteEntry(userId, id) {
      return withClient(async (c) => {
        const r = await c.query(`DELETE FROM clipboard_entries WHERE user_id = $1::bigint AND id = $2::uuid RETURNING id`, [userId, id])
        return (r.rowCount ?? 0) > 0
      })
    },
    async clearEntries(userId, onlyUnpinned) {
      return withClient(async (c) => {
        const r = await c.query(
          onlyUnpinned
            ? `DELETE FROM clipboard_entries WHERE user_id = $1::bigint AND pinned = false`
            : `DELETE FROM clipboard_entries WHERE user_id = $1::bigint`,
          [userId],
        )
        return r.rowCount ?? 0
      })
    },
    async prune(userId, nowIso) {
      return withClient(async (c) => {
        const r = await c.query(
          `DELETE FROM clipboard_entries
           WHERE user_id = $1::bigint AND pinned = false
             AND created_at < ($2::timestamptz - ($3::text || ' days')::interval)`,
          [userId, nowIso, String(CLIPBOARD_TTL_DAYS)],
        )
        return r.rowCount ?? 0
      })
    },
  }
}
