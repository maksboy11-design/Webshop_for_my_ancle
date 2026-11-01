/**
 * Модульный контент товара (schema_version 2). Общие типы для сайта, Mini App и сервера.
 * Хранится в product_content.draft / .published (jsonb). Неизвестные типы блоков при чтении пропускаются —
 * так новые типы можно добавлять без поломки старых клиентов. Рендер — только из JSON, без innerHTML.
 */
import { isDescriptionDoc, type DescriptionDoc } from './descriptionDoc'

export const CONTENT_SCHEMA_VERSION = 2
export const BLOCKS_MAX = 300
export const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/

export const BLOCK_TYPES = [
  'section_heading',
  'text',
  'bullet_list',
  'ordered_list',
  'image',
  'gallery',
  'video',
  'specs_table',
  'benefits',
  'documents',
  'info',
] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export interface BlockSettings {
  numbered?: boolean
  collapsed?: boolean
  [key: string]: unknown
}

export interface ContentBlock {
  id: string
  type: BlockType
  order: number
  active: boolean
  settings: BlockSettings
  content: Record<string, unknown>
}

export interface ContentMeta {
  showVideos?: boolean
  tags?: string[]
  badges?: string[]
  [key: string]: unknown
}

export interface ProductContent {
  schema_version: number
  meta: ContentMeta
  blocks: ContentBlock[]
}

export function emptyContent(): ProductContent {
  return { schema_version: CONTENT_SCHEMA_VERSION, meta: {}, blocks: [] }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function isBlockType(v: unknown): v is BlockType {
  return typeof v === 'string' && (BLOCK_TYPES as readonly string[]).includes(v)
}

/** Мягкое чтение одного блока: null для неизвестного/битого (пропускается, не роняет страницу). */
export function readBlock(v: unknown): ContentBlock | null {
  if (!isObj(v)) return null
  if (typeof v.id !== 'string' || !BLOCK_ID.test(v.id)) return null
  if (!isBlockType(v.type)) return null
  const order = typeof v.order === 'number' && Number.isFinite(v.order) ? v.order : 0
  const content = isObj(v.content) ? v.content : {}
  if (v.type === 'text' && content.doc !== undefined && !isDescriptionDoc(content.doc)) return null
  return {
    id: v.id,
    type: v.type,
    order,
    active: v.active !== false,
    settings: isObj(v.settings) ? (v.settings as BlockSettings) : {},
    content,
  }
}

/** Читает контент товара; null — если это не схема v2 (тогда используется старое хранилище). */
export function readProductContent(v: unknown): ProductContent | null {
  if (!isObj(v)) return null
  if (typeof v.schema_version !== 'number' || v.schema_version < CONTENT_SCHEMA_VERSION) return null
  const raw = Array.isArray(v.blocks) ? v.blocks.slice(0, BLOCKS_MAX) : []
  const seen = new Set<string>()
  const blocks: ContentBlock[] = []
  for (const item of raw) {
    const b = readBlock(item)
    if (b && !seen.has(b.id)) {
      seen.add(b.id)
      blocks.push(b)
    }
  }
  blocks.sort((a, b) => a.order - b.order)
  return { schema_version: v.schema_version, meta: isObj(v.meta) ? (v.meta as ContentMeta) : {}, blocks }
}

/** Видимые блоки в порядке отображения. */
export function visibleBlocks(c: ProductContent): ContentBlock[] {
  return c.blocks.filter((b) => b.active)
}

export interface Section {
  heading: ContentBlock | null
  blocks: ContentBlock[]
}

/** Группирует блоки в секции: section_heading открывает новую карточку; всё до первого заголовка — секция без заголовка. */
export function groupSections(blocks: readonly ContentBlock[]): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const b of blocks) {
    if (b.type === 'section_heading') {
      cur = { heading: b, blocks: [] }
      out.push(cur)
    } else {
      if (!cur) {
        cur = { heading: null, blocks: [] }
        out.push(cur)
      }
      cur.blocks.push(b)
    }
  }
  return out.filter((s) => s.heading || s.blocks.length > 0)
}

/** Раздел «Видео о товаре» показывается только при включённом переключателе и хотя бы одном готовом видео. */
export function shouldShowVideos(c: ProductContent): boolean {
  if (c.meta.showVideos !== true) return false
  return visibleBlocks(c).some(
    (b) => b.type === 'video' && Array.isArray(b.content.items) && b.content.items.some((i) => isObj(i) && typeof i.src === 'string' && i.src),
  )
}

export type { DescriptionDoc }
