/**
 * Чтение cms_activity_log (миграция 009) для UI журнала.
 */
import type { SqlPool } from './postgresStore'

export interface ActivityEntry {
  id: string
  at: string
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  details: Record<string, unknown>
}

export interface ActivityQuery {
  userId?: string
  action?: string
  entityType?: string
  from?: string
  to?: string
  offset: number
  limit: number
}

export interface ActivityStore {
  list(q: ActivityQuery): Promise<{ total: number; items: ActivityEntry[] }>
}

export class ActivityUnavailableError extends Error {
  constructor() {
    super('cms_activity_log table is missing')
    this.name = 'ActivityUnavailableError'
  }
}

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'

function mapRow(r: Record<string, unknown>): ActivityEntry {
  return {
    id: String(r.id),
    at: new Date(r.at as string | Date).toISOString(),
    userId: r.user_id == null ? null : String(r.user_id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: r.entity_id == null ? null : String(r.entity_id),
    details: (r.details && typeof r.details === 'object' ? r.details : {}) as Record<string, unknown>,
  }
}

export function createMemoryActivityStore(seed: ActivityEntry[] = []): ActivityStore & { rows: ActivityEntry[] } {
  const rows = [...seed]
  return {
    rows,
    async list(q) {
      let all = [...rows]
      if (q.userId) all = all.filter((r) => r.userId === q.userId)
      if (q.action) all = all.filter((r) => r.action === q.action)
      if (q.entityType) all = all.filter((r) => r.entityType === q.entityType)
      if (q.from) all = all.filter((r) => r.at >= q.from!)
      if (q.to) all = all.filter((r) => r.at <= q.to!)
      all.sort((a, b) => b.at.localeCompare(a.at) || Number(b.id) - Number(a.id))
      return { total: all.length, items: all.slice(q.offset, q.offset + q.limit) }
    },
  }
}

export function createPgActivityStore(pool: SqlPool): ActivityStore {
  return {
    async list(q) {
      const client = await pool.connect()
      try {
        const where: string[] = ['TRUE']
        const params: unknown[] = []
        if (q.userId) {
          params.push(q.userId)
          where.push(`user_id = $${params.length}::bigint`)
        }
        if (q.action) {
          params.push(q.action.slice(0, 60))
          where.push(`action = $${params.length}`)
        }
        if (q.entityType) {
          params.push(q.entityType.slice(0, 40))
          where.push(`entity_type = $${params.length}`)
        }
        if (q.from) {
          params.push(q.from)
          where.push(`at >= $${params.length}::timestamptz`)
        }
        if (q.to) {
          params.push(q.to)
          where.push(`at <= $${params.length}::timestamptz`)
        }
        const w = where.join(' AND ')
        const countR = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM cms_activity_log WHERE ${w}`, params)
        const total = Number(countR.rows[0]?.c ?? 0)
        params.push(q.limit, q.offset)
        const r = await client.query<Record<string, unknown>>(
          `SELECT id, at, user_id, action, entity_type, entity_id, details
           FROM cms_activity_log WHERE ${w}
           ORDER BY at DESC, id DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
        return { total, items: r.rows.map((row) => mapRow(row)) }
      } catch (e) {
        if (isMissing(e)) throw new ActivityUnavailableError()
        throw e
      } finally {
        client.release()
      }
    },
  }
}
