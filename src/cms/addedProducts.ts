/** Новые товары из Mini App (`added` в /api/products). Строгая проверка: всё непонятное отбрасывается. */
import { BRAND_LABELS } from '../content/copy'
import type { Product } from '../data/products'
import { isDescriptionDoc } from './descriptionDoc'

const CATEGORIES = ['supplements', 'devices', 'care', 'bath', 'drinks', 'home', 'accessories'] as const
const ID = /^custom-[0-9a-f]{12}$/

function safeImageSrc(v: unknown): v is string {
  if (typeof v !== 'string') return false
  if (v.startsWith('/products/')) return !v.includes('..')
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}

const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000

export function readAddedProduct(v: unknown): Product | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !ID.test(o.id) || o.slug !== o.id) return null
  if (typeof o.brandId !== 'string' || !(o.brandId in BRAND_LABELS)) return null
  if (typeof o.category !== 'string' || !(CATEGORIES as readonly string[]).includes(o.category)) return null
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  const image = o.image as Record<string, unknown> | null
  if (!image || !safeImageSrc(image.src)) return null
  const price = o.price as Record<string, unknown> | null
  if (!price || !posInt(price.rub) || price.rub === 0 || !posInt(price.pv)) return null
  if (!isDescriptionDoc(o.description)) return null
  const category = o.category as Product['category']
  return {
    id: o.id,
    slug: o.id,
    brandId: o.brandId as Product['brandId'],
    name: o.name,
    pack: typeof o.pack === 'string' && o.pack.trim() ? o.pack : null,
    category,
    form: null,
    kind: category === 'devices' ? 'device' : category === 'supplements' ? 'supplement' : 'goods',
    image: { src: image.src as string, width: 600, height: 600 },
    gallery: [],
    priceListId: null,
    price: { rub: price.rub, pv: price.pv },
    description: o.description,
  }
}

export function readAddedProducts(list: unknown, existing: readonly Product[]): Product[] {
  if (!Array.isArray(list)) return []
  const taken = new Set(existing.map((p) => p.id))
  const out: Product[] = []
  for (const item of list) {
    const p = readAddedProduct(item)
    if (p && !taken.has(p.id)) {
      taken.add(p.id)
      out.push(p)
    }
  }
  return out
}
