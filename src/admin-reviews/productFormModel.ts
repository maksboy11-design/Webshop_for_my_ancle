/** Модель формы товара: преобразования без изменения текстов (никаких trim/автоисправлений). */
import { PV_TO_RUB, type ProductPrice } from '../data/price'
import type { DescriptionParagraph, DescriptionSection, ProductDescription } from '../data/productDescriptions'
import type { ProductImage } from '../data/products'
import type { ProductSet, PublicProductFields } from './adminHttp'

let seq = 0
const key = () => `k${++seq}`

export interface EditParagraph {
  key: string
  label: string
  text: string
}
export interface EditItem {
  key: string
  text: string
}
export interface EditSection {
  key: string
  level: 'group' | 'major' | 'minor'
  number: string
  heading: string
  paragraphs: EditParagraph[]
  list: EditItem[]
  listStyle: 'bullet' | 'none'
}

export interface ProductFormState {
  name: string
  packNone: boolean
  pack: string
  priceNone: boolean
  pv: string
  rub: string
  rubAuto: boolean
  image: ProductImage
  gallery: ProductImage[]
  descNone: boolean
  sections: EditSection[]
}

export function rubFromPv(pv: number): number {
  return Math.round(pv * PV_TO_RUB)
}

export function parsePv(raw: string): number | null {
  const t = raw.replace(',', '.').trim()
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

export function parseRub(raw: string): number | null {
  const t = raw.replace(/[\s\u00a0]/g, '')
  if (!/^\d{1,8}$/.test(t)) return null
  return Number(t)
}

export function toEditSection(s: DescriptionSection): EditSection {
  return {
    key: key(),
    level: s.level ?? 'major',
    number: s.number ?? '',
    heading: s.heading ?? '',
    paragraphs: (s.paragraphs ?? []).map((p) =>
      typeof p === 'string' ? { key: key(), label: '', text: p } : { key: key(), label: p.label, text: p.text },
    ),
    list: (s.list ?? []).map((text) => ({ key: key(), text })),
    listStyle: s.listStyle ?? 'bullet',
  }
}

export function emptySection(): EditSection {
  return { key: key(), level: 'major', number: '', heading: '', paragraphs: [], list: [], listStyle: 'bullet' }
}

export function fromEditSection(s: EditSection): DescriptionSection {
  const out: { -readonly [K in keyof DescriptionSection]: DescriptionSection[K] } = {}
  if (s.level !== 'major') out.level = s.level
  if (s.number !== '') out.number = s.number
  if (s.heading !== '') out.heading = s.heading
  if (s.paragraphs.length > 0) {
    out.paragraphs = s.paragraphs.map((p): DescriptionParagraph => (p.label !== '' ? { label: p.label, text: p.text } : p.text))
  }
  if (s.list.length > 0) out.list = s.list.map((i) => i.text)
  if (s.list.length > 0 && s.listStyle === 'none') out.listStyle = 'none'
  return out
}

/** Каноническая форма описания для сравнения (level:'major' и listStyle:'bullet' — значения по умолчанию). */
export function normalizeDescription(d: ProductDescription | null): ProductDescription | null {
  return d ? d.map((s) => fromEditSection(toEditSection(s))) : null
}

export function initialState(p: PublicProductFields): ProductFormState {
  const price = p.price
  return {
    name: p.name,
    packNone: p.pack === null,
    pack: p.pack ?? '',
    priceNone: price === null,
    pv: price ? String(price.pv) : '',
    rub: price ? String(price.rub) : '',
    rubAuto: price ? rubFromPv(price.pv) === price.rub : true,
    image: p.image,
    gallery: p.gallery,
    descNone: p.description === null,
    sections: (p.description ?? []).map(toEditSection),
  }
}

export type BuildResult = { ok: true; set: ProductSet } | { ok: false; field: string; message: string }

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Собирает только изменённые поля. Пустой set — изменений нет. */
export function buildSet(state: ProductFormState, original: PublicProductFields): BuildResult {
  const set: ProductSet = {}
  if (state.name !== original.name) {
    if (state.name.trim() === '') return { ok: false, field: 'name', message: 'Название не может быть пустым.' }
    set.name = state.name
  }
  const pack = state.packNone ? null : state.pack
  if (pack !== original.pack) {
    if (pack !== null && pack.trim() === '') return { ok: false, field: 'pack', message: 'Укажите фасовку или отметьте «Без фасовки».' }
    set.pack = pack
  }
  let price: ProductPrice | null = null
  if (!state.priceNone) {
    const pv = parsePv(state.pv)
    const rub = parseRub(state.rub)
    if (pv === null) return { ok: false, field: 'price', message: 'PV: число, до двух знаков после запятой.' }
    if (rub === null) return { ok: false, field: 'price', message: 'Рубли: целое число.' }
    price = { rub, pv }
  }
  if (!same(price, original.price)) set.price = price
  if (!same(state.image, original.image)) set.image = state.image
  if (!same(state.gallery, original.gallery)) set.gallery = state.gallery
  const description = state.descNone ? null : state.sections.map(fromEditSection)
  if (description) {
    const emptyIdx = description.findIndex((s) => !s.heading && !s.paragraphs && !s.list)
    if (emptyIdx >= 0) return { ok: false, field: 'description', message: `Секция ${emptyIdx + 1} пустая — заполните или удалите её.` }
  }
  if (!same(description, normalizeDescription(original.description))) set.description = description
  return { ok: true, set }
}

export function isDirty(state: ProductFormState, original: PublicProductFields): boolean {
  const r = buildSet(state, original)
  return !r.ok || Object.keys(r.set).length > 0
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
