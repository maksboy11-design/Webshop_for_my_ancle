/**
 * Живые данные товаров на сайте: статический каталог сразу (без ожидания сети и без скачков),
 * затем один запрос /api/products?changed=1 и наложение сохранённых правок.
 * Ошибка сети/API — остаёмся на статике и пишем диагностику в консоль.
 */
import { useSyncExternalStore } from 'react'
import { PRODUCTS, type Product } from '../data/products'
import { fetchGetWithRetry } from '../lib/fetchRetry'
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
export function applyLiveProducts(list: unknown): readonly Product[] {
  if (!Array.isArray(list)) return PRODUCTS
  const byId = new Map<string, PublicProductData>()
  for (const item of list) if (isPublicData(item)) byId.set(item.id, item)
  return PRODUCTS.map((p) => applyPublicData(p, byId.get(p.id)))
}

export function loadLiveProducts(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  return (fetchImpl === fetch
    ? fetchGetWithRetry('/api/products?changed=1', { headers: { accept: 'application/json' } })
    : fetchImpl('/api/products?changed=1', { headers: { accept: 'application/json' } }))
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { products?: unknown }
      if (!Array.isArray(body.products) || body.products.length === 0) return
      current = applyLiveProducts(body.products)
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
  return useProducts().find((p) => p.slug === slug)
}

/** Только для тестов. */
export function resetLiveProductsForTests() {
  current = PRODUCTS
  started = false
  emit()
}
