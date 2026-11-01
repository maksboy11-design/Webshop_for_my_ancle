/**
 * Живые данные товаров на сайте: статический каталог сразу (без ожидания сети и без скачков),
 * затем один запрос /api/products?changed=1 и наложение сохранённых правок.
 * Ошибка сети/API — остаёмся на статике и пишем диагностику в консоль.
 */
import { useSyncExternalStore } from 'react'
import { PRODUCTS, resolveSlug, type Product } from '../data/products'
import { fetchGetWithRetry } from '../lib/fetchRetry'
import { readAddedProducts } from './addedProducts'
import { applyPublicData, type PublicProductData } from './productMerge'

type Listener = () => void

let current: readonly Product[] = PRODUCTS
let started = false
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function isPublicData(v: unknown): v is PublicProductData {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.name === 'string' && !!o.image && typeof o.image === 'object'
}

/** Применяет ответ API (используется и в тестах). */
export function applyLiveProducts(list: unknown, added: unknown = []): readonly Product[] {
  const byId = new Map<string, PublicProductData>()
  if (Array.isArray(list)) for (const item of list) if (isPublicData(item)) byId.set(item.id, item)
  const base = byId.size ? PRODUCTS.map((p) => applyPublicData(p, byId.get(p.id))) : PRODUCTS
  const extra = readAddedProducts(added, base)
  return extra.length ? [...base, ...extra] : base
}

export function loadLiveProducts(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  return (fetchImpl === fetch
    ? fetchGetWithRetry('/api/products?changed=1', { headers: { accept: 'application/json' } })
    : fetchImpl('/api/products?changed=1', { headers: { accept: 'application/json' } }))
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { products?: unknown; added?: unknown }
      const hasEdits = Array.isArray(body.products) && body.products.length > 0
      const hasAdded = Array.isArray(body.added) && body.added.length > 0
      if (!hasEdits && !hasAdded) return
      current = applyLiveProducts(body.products, body.added)
      emit()
    })
    .catch((error: unknown) => {
      console.warn('[products] /api/products недоступен, показан статический каталог:', error instanceof Error ? error.message : error)
    })
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = () => current
const serverSnapshot = () => PRODUCTS

export function useProducts(): readonly Product[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

export function useProductById(id: string): Product | undefined {
  return useProducts().find((p) => p.id === id)
}

export function useProductBySlug(slug: string): Product | undefined {
  const s = resolveSlug(slug)
  return useProducts().find((p) => p.slug === s)
}

/** Только для тестов. */
export function resetLiveProductsForTests() {
  current = PRODUCTS
  started = false
  emit()
}
