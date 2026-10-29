/** Хранилище правок товаров (таблица cms_product_overrides, миграция 005). */
import type { ProductOverride } from '../../src/cms/productMerge'
import type { SqlPool } from './postgresStore'
import { sanitizeStoredOverride } from './productOverrides'

export interface StoredProductOverride {
  productId: string
  overrides: ProductOverride
  updatedAt: string
  updatedByUserId: string | null
}

/** Таблицы нет (миграция 005 не применена) — сайт работает на статике, сохранение недоступно. */
export class ProductOverridesUnavailableError extends Error {
  constructor() {
    super('cms_product_overrides table is missing')
    this.name = 'ProductOverridesUnavailableError'
  }
}

export interface ProductOverrideStore {
  list(): Promise<Map<string, StoredProductOverride>>
  get(productId: string): Promise<StoredProductOverride | null>
  /** Изменение под блокировкой строки: fn получает текущее значение и возвращает новое (или null — отказ). */
  update(
    productId: string,
    userId: string,
    nowIso: string,
    fn: (current: ProductOverride) => ProductOverride | null,
  ): Promise<StoredProductOverride | null>
}

function isMissingTable(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '42P01'
}

interface Row extends Record<string, unknown> {
  product_id: string
  overrides: unknown
  updated_at: string | Date
  updated_by_user_id: string | null
}

function fromRow(row: Row): StoredProductOverride {
  return {
    productId: row.product_id,
    overrides: sanitizeStoredOverride(row.overrides),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedByUserId: row.updated_by_user_id === null ? null : String(row.updated_by_user_id),
  }
}

export function createPgProductOverrideStore(pool: SqlPool): ProductOverrideStore {
  async function run<T>(fn: (q: SqlClientLike) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client)
    } catch (error) {
      if (isMissingTable(error)) throw new ProductOverridesUnavailableError()
      throw error
    } finally {
      client.release()
    }
  }
  type SqlClientLike = Awaited<ReturnType<SqlPool['connect']>>
  const COLS = 'product_id, overrides, updated_at, updated_by_user_id::text AS updated_by_user_id'
  return {
    list: () =>
      run(async (c) => {
        const r = await c.query<Row>(`SELECT ${COLS} FROM cms_product_overrides`)
        return new Map(r.rows.map((row) => [row.product_id, fromRow(row)]))
      }),
    get: (productId) =>
      run(async (c) => {
        const r = await c.query<Row>(`SELECT ${COLS} FROM cms_product_overrides WHERE product_id = $1`, [productId])
        return r.rows[0] ? fromRow(r.rows[0]) : null
      }),
    update: (productId, userId, nowIso, fn) =>
      run(async (c) => {
        await c.query('BEGIN')
        try {
          const r = await c.query<Row>(`SELECT ${COLS} FROM cms_product_overrides WHERE product_id = $1 FOR UPDATE`, [
            productId,
          ])
          const next = fn(r.rows[0] ? fromRow(r.rows[0]).overrides : {})
          if (!next) {
            await c.query('ROLLBACK')
            return null
          }
          const w = await c.query<Row>(
            `INSERT INTO cms_product_overrides (product_id, overrides, updated_at, updated_by_user_id)
             VALUES ($1, $2::jsonb, $3::timestamptz, $4::bigint)
             ON CONFLICT (product_id) DO UPDATE SET overrides = EXCLUDED.overrides,
               updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id
             RETURNING ${COLS}`,
            [productId, JSON.stringify(next), nowIso, userId],
          )
          await c.query('COMMIT')
          return fromRow(w.rows[0]!)
        } catch (error) {
          await c.query('ROLLBACK').catch(() => undefined)
          throw error
        }
      }),
  }
}

export function createMemoryProductOverrideStore(opts: { missingTable?: boolean } = {}): ProductOverrideStore {
  const rows = new Map<string, StoredProductOverride>()
  const check = () => {
    if (opts.missingTable) throw new ProductOverridesUnavailableError()
  }
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    async list() {
      check()
      return new Map([...rows].map(([k, v]) => [k, clone(v)]))
    },
    async get(productId) {
      check()
      const row = rows.get(productId)
      return row ? clone(row) : null
    },
    async update(productId, userId, nowIso, fn) {
      check()
      const next = fn(clone(rows.get(productId)?.overrides ?? {}))
      if (!next) return null
      const row: StoredProductOverride = {
        productId,
        overrides: sanitizeStoredOverride(clone(next)),
        updatedAt: nowIso,
        updatedByUserId: userId,
      }
      rows.set(productId, row)
      return clone(row)
    },
  }
}
