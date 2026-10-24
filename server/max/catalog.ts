import { PRODUCTS } from '../../src/data/products'

export const PRODUCT_PAGE_SIZE = 6

export function findProduct(id: string) {
  return PRODUCTS.find((item) => item.id === id) ?? null
}

export function productCount(): number {
  return PRODUCTS.length
}

export function productPage(page: number) {
  const pageCount = Math.max(1, Math.ceil(PRODUCTS.length / PRODUCT_PAGE_SIZE))
  const safe = Math.min(Math.max(page, 0), pageCount - 1)
  return {
    page: safe,
    pageCount,
    items: PRODUCTS.slice(safe * PRODUCT_PAGE_SIZE, safe * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE),
  }
}

export function buttonLabel(name: string, id: string): string {
  const flat = (name.trim() || id).replace(/\s+/g, ' ')
  const chars = Array.from(flat)
  if (chars.length <= 120) return chars.join('')
  return `${chars.slice(0, 119).join('')}…`
}
