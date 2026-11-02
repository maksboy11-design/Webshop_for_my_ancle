/**
 * Сериализация/десериализация блоков для буфера.
 * Использует схемы страниц и доп. блоков товара; при вставке — новые id.
 */
import {
  PAGE_BLOCK_LABEL,
  PAGE_BLOCK_TYPES,
  pageHref,
  sanitizePublicPageDoc,
  type ButtonBlock,
  type ButtonTarget,
  type ButtonVariant,
  type PageBlock,
} from '../../cms/pageDoc'
import { EXTRA_LABEL, EXTRA_TYPES, type ExtraType } from '../../cms/richBlocks'
import { newBlockId } from '../blocks/arrayOps'
import type { ClipboardPayload, ClipboardScope } from './types'
import { CLIPBOARD_FORMAT } from './types'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const VARIANTS = new Set(['primary', 'secondary', 'soft'])
const ALIGNS = new Set(['left', 'center', 'right'])

function pickVariant(v: unknown): ButtonVariant {
  return VARIANTS.has(String(v)) ? (v as ButtonVariant) : 'primary'
}
function pickAlign(v: unknown): 'left' | 'center' | 'right' {
  return ALIGNS.has(String(v)) ? (v as 'left' | 'center' | 'right') : 'left'
}

function readTarget(raw: unknown): ButtonTarget {
  if (!isObj(raw)) return { kind: 'none' }
  if (raw.kind === 'page' && typeof raw.pageId === 'string') return { kind: 'page', pageId: raw.pageId }
  if (raw.kind === 'external' && typeof raw.url === 'string' && /^https:\/\//i.test(raw.url))
    return { kind: 'external', url: raw.url.slice(0, 500) }
  return { kind: 'none' }
}

/** Извлечь поля кнопки из page-блока или product-content. */
export function extractButtonFields(block: unknown): {
  text: string
  variant: ButtonVariant
  align: 'left' | 'center' | 'right'
  target: ButtonTarget
  href?: string
} | null {
  if (!isObj(block)) return null
  // Page ButtonBlock
  if (block.type === 'button' && typeof block.text === 'string') {
    const text = block.text.trim().slice(0, 80)
    if (!text) return null
    const href = typeof block.href === 'string' ? block.href.slice(0, 500) : undefined
    return {
      text,
      variant: pickVariant(block.variant),
      align: pickAlign(block.align),
      target: readTarget(block.target),
      ...(href ? { href } : {}),
    }
  }
  // Product extra: content nested or flattened public shape
  const c = isObj(block.content) ? block.content : block.type === 'button' ? block : null
  if (!c || (block.type && block.type !== 'button' && !isObj(block.content))) return null
  if (block.type && block.type !== 'button' && !isObj(block.content)) return null
  const src = isObj(block.content) ? block.content : block.type === 'button' ? block : null
  if (!isObj(src) || typeof src.text !== 'string') return null
  const text = src.text.trim().slice(0, 80)
  if (!text) return null
  const href = typeof src.href === 'string' ? src.href.slice(0, 500) : undefined
  return {
    text,
    variant: pickVariant(src.variant),
    align: pickAlign(src.align),
    target: readTarget(src.target),
    ...(href ? { href } : {}),
  }
}

export function payloadFromPageBlock(
  block: PageBlock,
  source: { pageId: string; pageTitle: string },
): ClipboardPayload {
  return {
    v: CLIPBOARD_FORMAT,
    scope: 'page',
    kind: block.type,
    label: PAGE_BLOCK_LABEL[block.type] ?? block.type,
    source: { pageId: source.pageId, pageTitle: source.pageTitle },
    copiedAt: new Date().toISOString(),
    block: structuredClone(block),
  }
}

export function payloadFromProductBlock(
  block: { id: string; type: string; content?: unknown; active?: boolean } & Record<string, unknown>,
  source: { productId: string; productName: string },
): ClipboardPayload {
  const type = String(block.type)
  return {
    v: CLIPBOARD_FORMAT,
    scope: 'product',
    kind: type,
    label: (EXTRA_LABEL as Record<string, string>)[type] ?? (type === 'button' ? 'Кнопка' : type),
    source: { productId: source.productId, productName: source.productName },
    copiedAt: new Date().toISOString(),
    block: structuredClone(block),
  }
}

/** Новый id блока страницы. */
export function remintPageBlock(raw: unknown): PageBlock | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null
  // Кнопка из доп. блоков товара (content.text) → page button
  if (raw.type === 'button' && isObj(raw.content) && typeof raw.content.text === 'string' && typeof raw.text !== 'string') {
    const fields = extractButtonFields(raw)
    if (!fields) return null
    return {
      id: newBlockId('b'),
      type: 'button',
      width: 'normal',
      align: fields.align,
      text: fields.text,
      variant: fields.variant,
      target: fields.target,
    }
  }
  if (raw.type === 'button' && typeof raw.text !== 'string') {
    const fields = extractButtonFields(raw)
    if (!fields) return null
    return {
      id: newBlockId('b'),
      type: 'button',
      width: 'normal',
      align: fields.align,
      text: fields.text,
      variant: fields.variant,
      target: fields.target,
    }
  }
  const clone = structuredClone(raw) as unknown as PageBlock
  clone.id = newBlockId(String(clone.type)[0] ?? 'b')
  return clone
}

export type ProductEditBlock = {
  id: string
  type: ExtraType
  active: boolean
  content: Record<string, unknown>
}

/** Вставка в доп. блоки товара (в т.ч. кнопка со страницы). */
export function remintProductBlock(raw: unknown, opts?: { pageSlugById?: (id: string) => string | undefined }): ProductEditBlock | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null
  const type = raw.type

  if (type === 'button') {
    const fields = extractButtonFields(raw)
    if (!fields) return null
    let href = fields.href
    if (!href && fields.target.kind === 'page' && opts?.pageSlugById) {
      const slug = opts.pageSlugById(fields.target.pageId)
      if (slug) href = pageHref(slug)
    } else if (!href && fields.target.kind === 'external') {
      href = fields.target.url
    }
    return {
      id: newBlockId('b'),
      type: 'button',
      active: true,
      content: {
        text: fields.text,
        variant: fields.variant,
        align: fields.align,
        target: fields.target,
        ...(href ? { href } : {}),
      },
    }
  }

  const allowed = (EXTRA_TYPES as readonly string[]).includes(type)
  if (!allowed) return null
  const content = isObj(raw.content) ? structuredClone(raw.content) : structuredClone(raw)
  if (isObj(content)) {
    delete (content as { type?: unknown }).type
    delete (content as { id?: unknown }).id
    delete (content as { active?: unknown }).active
  }
  return {
    id: newBlockId(type[0] ?? 'b'),
    type: type as ExtraType,
    active: raw.active !== false,
    content: content as Record<string, unknown>,
  }
}

/** Лёгкая клиентская проверка: тип из реестра + sanitizePublicPageDoc не отбрасывает блок. */
export function validatePageBlock(block: PageBlock): boolean {
  if (!(PAGE_BLOCK_TYPES as readonly string[]).includes(block.type)) return false
  if (block.type === 'button' && (!block.text || !block.text.trim())) return false
  const doc = sanitizePublicPageDoc({ version: 1, lead: '', toc: false, blocks: [block] })
  return !!doc && doc.blocks.length === 1 && doc.blocks[0]!.type === block.type
}

export function toPageButtonFromPayload(payload: ClipboardPayload): ButtonBlock | null {
  if (payload.kind !== 'button') return null
  const reminted = remintPageBlock(payload.block)
  return reminted?.type === 'button' ? reminted : null
}

export function previewText(payload: ClipboardPayload): string {
  const b = payload.block
  if (!isObj(b)) return payload.label
  if (typeof b.text === 'string' && b.text.trim()) return b.text.trim().slice(0, 80)
  if (isObj(b.doc)) return payload.label
  if (typeof b.title === 'string' && b.title.trim()) return b.title.trim().slice(0, 80)
  if (isObj(b.content) && typeof b.content.title === 'string') return String(b.content.title).slice(0, 80)
  if (isObj(b.content) && typeof b.content.text === 'string') return String(b.content.text).slice(0, 80)
  return payload.label
}

export function canPasteTo(scope: ClipboardScope, payload: ClipboardPayload): boolean {
  if (scope === 'page') return payload.scope === 'page' || payload.kind === 'button'
  if (payload.kind === 'button') return true
  return payload.scope === 'product' || (EXTRA_TYPES as readonly string[]).includes(payload.kind)
}
