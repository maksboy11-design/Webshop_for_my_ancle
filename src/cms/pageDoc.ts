/**
 * Модель страницы раздела «Страницы» (универсальный редактор).
 * JSON хранит только данные: тексты — в формате описания товара (DescriptionDoc), картинки — mediaId
 * из медиатеки (src/srcSet подставляет сервер), кнопки — внутренний id страницы. Никакого HTML.
 * Реестр типов блоков расширяемый: новый тип = запись в PAGE_BLOCK_TYPES + валидатор + рендер + редактор.
 */
import { canonicalDoc, validateDescriptionDoc, type DescriptionDoc } from './descriptionDoc'
import { checkBlockImage, type BlockImage, type CheckResult, type MediaResolver } from './richBlocks'

export const PAGE_SCHEMA_VERSION = 1
export const PAGE_BLOCKS_MAX = 120
export const PAGE_TITLE_MAX = 160
export const SLUG_MAX = 80

export const PAGE_BLOCK_TYPES = ['text', 'heading', 'image', 'button'] as const
export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number]
export const PAGE_BLOCK_LABEL: Record<PageBlockType, string> = {
  text: 'Текст',
  heading: 'Заголовок раздела',
  image: 'Изображение',
  button: 'Кнопка',
}

export type BlockWidth = 'narrow' | 'normal' | 'wide'
export type BlockAlign = 'left' | 'center' | 'right'
export type ImageAspect = 'auto' | '16:9' | '4:3' | '1:1' | '3:4'
export type ImageRadius = 'none' | 'md' | 'lg'
export type ButtonVariant = 'primary' | 'secondary' | 'soft'
export const WIDTHS: readonly BlockWidth[] = ['narrow', 'normal', 'wide']
export const ALIGNS: readonly BlockAlign[] = ['left', 'center', 'right']
export const ASPECTS: readonly ImageAspect[] = ['auto', '16:9', '4:3', '1:1', '3:4']
export const RADII: readonly ImageRadius[] = ['none', 'md', 'lg']
export const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'soft']

/** Цель кнопки: внутренняя страница по id. 'external' есть только у перенесённых страниц и в редакторе не создаётся. */
export type ButtonTarget = { kind: 'page'; pageId: string } | { kind: 'external'; url: string } | { kind: 'none' }

interface Base {
  id: string
  width: BlockWidth
  align: BlockAlign
}
export type TextBlock = Base & { type: 'text'; doc: DescriptionDoc; card: boolean; label: string }
export type HeadingBlock = Base & { type: 'heading'; text: string; anchor: string; navLabel: string }
export type ImageBlock = Base & { type: 'image'; image: BlockImage | null; aspect: ImageAspect; radius: ImageRadius }
export type ButtonBlock = Base & { type: 'button'; text: string; variant: ButtonVariant; target: ButtonTarget }
export type PageBlock = TextBlock | HeadingBlock | ImageBlock | ButtonBlock

export interface PageDoc {
  version: 1
  /** Подзаголовок под h1. */
  lead: string
  /** Навигация по разделам (чипы из заголовков с якорем). */
  toc: boolean
  blocks: PageBlock[]
}

export const emptyPageDoc = (): PageDoc => ({ version: 1, lead: '', toc: false, blocks: [] })

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
export const cleanLine = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def)
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANCHOR = /^[a-z0-9][a-z0-9-]{0,63}$/

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}
/** Слаг из заголовка: транслит, a-z0-9 и дефисы. */
export function slugify(title: string): string {
  const s = [...title.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  return s || 'page'
}
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/
/** Слаги, занятые маршрутами сайта. */
export const RESERVED_SLUGS = new Set([
  'home',
  'top',
  'catalog',
  'product',
  'videos',
  'reviews',
  'webinars',
  'about',
  'contacts',
  'privacy',
  'page',
  'admin',
])
export const isValidSlug = (s: string) => SLUG_RE.test(s) && !RESERVED_SLUGS.has(s)

export function isSafeExternalUrl(u: string): boolean {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Same-origin медиатека (/product-media/…) или https (blob / внешние). javascript: и //evil отсекаем. */
export function isSafeMediaSrc(src: string): boolean {
  if (/^\/(?!\/)product-media\//.test(src)) return true
  try {
    const u = new URL(src)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}


const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field })

function target(v: unknown, allowExternal: boolean, f: string): CheckResult<ButtonTarget> {
  if (!isObj(v) || v.kind === 'none') return { ok: true, value: { kind: 'none' } }
  if (v.kind === 'page' && typeof v.pageId === 'string' && UUID_RE.test(v.pageId))
    return { ok: true, value: { kind: 'page', pageId: v.pageId.toLowerCase() } }
  if (v.kind === 'external' && typeof v.url === 'string') {
    if (!allowExternal) return fail('external_not_allowed', f)
    if (!isSafeExternalUrl(v.url) || v.url.length > 600) return fail('invalid_url', f)
    return { ok: true, value: { kind: 'external', url: v.url } }
  }
  return fail('invalid', f)
}

export interface PageCheckOptions {
  /** Внешние ссылки допустимы, только если такая кнопка уже была в сохранённой версии (перенос «Научных фактов»). */
  allowedExternal?: ReadonlySet<string>
}

/** Полная проверка документа (сервер). Картинки резолвятся через медиатеку. */
export async function checkPageDoc(raw: unknown, resolve: MediaResolver, opts: PageCheckOptions = {}): Promise<CheckResult<PageDoc>> {
  if (!isObj(raw)) return fail('invalid', 'doc')
  const list = Array.isArray(raw.blocks) ? raw.blocks : []
  if (list.length > PAGE_BLOCKS_MAX) return fail('too_many', 'blocks')
  const seen = new Set<string>()
  const blocks: PageBlock[] = []
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    const f = `blocks.${i}`
    if (!isObj(b) || typeof b.id !== 'string' || !ID.test(b.id) || seen.has(b.id)) return fail('invalid', `${f}.id`)
    seen.add(b.id)
    const base: Base = { id: b.id, width: pick(b.width, WIDTHS, 'normal'), align: pick(b.align, ALIGNS, 'left') }
    switch (b.type) {
      case 'text': {
        const d = validateDescriptionDoc(b.doc)
        if (!d.ok) return fail(d.error, `${f}.doc`)
        blocks.push({ ...base, type: 'text', doc: canonicalDoc(d.value, { keepTrailingBlank: true }), card: b.card === true, label: cleanLine(b.label, 20) })
        break
      }
      case 'heading': {
        const text = cleanLine(b.text, 300)
        const anchor = typeof b.anchor === 'string' && ANCHOR.test(b.anchor) ? b.anchor : ''
        blocks.push({ ...base, type: 'heading', text, anchor, navLabel: cleanLine(b.navLabel, 60) })
        break
      }
      case 'image': {
        let image: BlockImage | null = null
        if (b.image != null) {
          const r = await checkBlockImage(b.image, resolve, `${f}.image`)
          if (!r.ok) return r
          image = r.value
        }
        blocks.push({ ...base, type: 'image', image, aspect: pick(b.aspect, ASPECTS, 'auto'), radius: pick(b.radius, RADII, 'md') })
        break
      }
      case 'button': {
        const ext =
          isObj(b.target) && b.target.kind === 'external' && typeof b.target.url === 'string' && !!opts.allowedExternal?.has(b.target.url)
        const t = target(b.target, ext, `${f}.target`)
        if (!t.ok) return t
        const text = cleanLine(b.text, 80)
        if (!text) return fail('empty_button', `${f}.text`)
        blocks.push({ ...base, type: 'button', text, variant: pick(b.variant, VARIANTS, 'primary'), target: t.value })
        break
      }
      default:
        return fail('unknown_type', `${f}.type`)
    }
  }
  return { ok: true, value: { version: 1, lead: cleanLine(raw.lead, 400), toc: raw.toc === true, blocks } }
}

/** Мягкая проверка для публичного рендера: битые блоки пропускаются, а не роняют страницу. */
export function sanitizePublicPageDoc(raw: unknown): PageDoc | null {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return null
  const blocks: PageBlock[] = []
  for (const b of raw.blocks.slice(0, PAGE_BLOCKS_MAX)) {
    if (!isObj(b) || typeof b.id !== 'string') continue
    const base: Base = { id: b.id, width: pick(b.width, WIDTHS, 'normal'), align: pick(b.align, ALIGNS, 'left') }
    if (b.type === 'text') {
      const d = validateDescriptionDoc(b.doc)
      if (d.ok) blocks.push({ ...base, type: 'text', doc: d.value, card: b.card === true, label: cleanLine(b.label, 20) })
    } else if (b.type === 'heading') {
      blocks.push({
        ...base,
        type: 'heading',
        text: cleanLine(b.text, 300),
        anchor: typeof b.anchor === 'string' && ANCHOR.test(b.anchor) ? b.anchor : '',
        navLabel: cleanLine(b.navLabel, 60),
      })
    } else if (b.type === 'image') {
      const im =
        isObj(b.image) && typeof b.image.src === 'string' && isSafeMediaSrc(b.image.src) ? (b.image as unknown as BlockImage) : null
      blocks.push({ ...base, type: 'image', image: im, aspect: pick(b.aspect, ASPECTS, 'auto'), radius: pick(b.radius, RADII, 'md') })
    } else if (b.type === 'button') {
      const t = isObj(b.target) ? b.target : {}
      const tgt: ButtonTarget =
        t.kind === 'page' && typeof t.pageId === 'string'
          ? { kind: 'page', pageId: t.pageId }
          : t.kind === 'external' && typeof t.url === 'string' && isSafeExternalUrl(t.url)
            ? { kind: 'external', url: t.url }
            : { kind: 'none' }
      const text = cleanLine(b.text, 80)
      if (text) blocks.push({ ...base, type: 'button', text, variant: pick(b.variant, VARIANTS, 'primary'), target: tgt })
    }
  }
  return { version: 1, lead: cleanLine(raw.lead, 400), toc: raw.toc === true, blocks }
}

/** id страниц, на которые ссылаются кнопки. */
export function linkedPageIds(doc: PageDoc | null | undefined): string[] {
  const out = new Set<string>()
  for (const b of doc?.blocks ?? []) if (b.type === 'button' && b.target.kind === 'page') out.add(b.target.pageId)
  return [...out]
}
export function externalUrls(doc: PageDoc | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const b of doc?.blocks ?? []) if (b.type === 'button' && b.target.kind === 'external') out.add(b.target.url)
  return out
}

/** Публичная ссылка страницы. «Научные факты» живут по старому адресу #science. */
export function pageHref(slug: string): string {
  return slug === 'science' ? '#science' : `#page/${encodeURIComponent(slug)}`
}
