/**
 * Текст для product_content.search_text / search_tsv (полнотекст russian).
 * Имя, id/SKU, описание, категория, бренд, теги, бейджи — без AI.
 */
import { brandName } from '../data/products'
import type { ProductContent } from './blocks'
import { contentToDoc } from './contentDoc'
import { docToPlainText } from './descriptionDoc'
import { readCardFields } from './productCard'
import { publicExtras } from './richBlocks'

export function buildProductSearchText(productId: string, content: ProductContent | null | undefined): string {
  const card = readCardFields(content?.meta)
  const parts: string[] = [productId]
  if (card.name) parts.push(card.name)
  if (card.pack) parts.push(card.pack)
  if (card.category) parts.push(card.category)
  if (card.brandId) {
    parts.push(card.brandId)
    try {
      parts.push(brandName(card.brandId))
    } catch {
      /* ignore */
    }
  }
  if (card.kind) parts.push(card.kind)
  if (card.tags?.length) parts.push(card.tags.join(' '))
  if (card.badges?.length) parts.push(card.badges.join(' '))
  const doc = content ? contentToDoc(content) : null
  if (doc) parts.push(docToPlainText(doc))
  const extras = publicExtras(content)
  for (const b of extras.blocks) {
    if ('title' in b && b.title) parts.push(b.title)
    if (b.type === 'info' && b.text) parts.push(b.text)
    if (b.type === 'specs_table') for (const r of b.rows) parts.push(`${r.label} ${r.value}`)
    if (b.type === 'benefits') for (const it of b.items) parts.push(`${it.title} ${it.text}`)
    if (b.type === 'image' && b.caption) parts.push(b.caption)
    if (b.type === 'gallery' && b.title) parts.push(b.title)
  }
  for (const v of extras.videos) {
    if (v.title) parts.push(v.title)
    if (v.description) parts.push(v.description)
  }
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000)
}
