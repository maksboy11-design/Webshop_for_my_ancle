/** Модель формы товара: преобразования без изменения текстов (никаких trim/автоисправлений). */
import { PV_TO_RUB, type ProductPrice } from '../data/price'
import {
  canonicalDoc,
  checkDocLimits,
  isDocEmpty,
  toEditableDoc,
  validateDescriptionDoc,
  type AnyDescription,
  type DescriptionDoc,
} from '../cms/descriptionDoc'
import type { ProductImage } from '../data/products'
import type { ProductSet, PublicProductFields } from './adminHttp'

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
  doc: DescriptionDoc
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

/** Описание в форме — один документ редактора. Старые секции конвертируются при открытии (legacyToDoc). */
export function descriptionForCompare(d: AnyDescription | null): DescriptionDoc | null {
  if (!d) return null
  const doc = canonicalDoc(toEditableDoc(d))
  return isDocEmpty(doc) ? null : doc
}

/** Что отправить на сервер: пустой документ = «нет описания» (null). */
export function descriptionToSave(doc: DescriptionDoc): DescriptionDoc | null {
  const r = validateDescriptionDoc(canonicalDoc(doc))
  const value = r.ok ? r.value : canonicalDoc(doc)
  return isDocEmpty(value) ? null : value
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
    doc: toEditableDoc(p.description),
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
  const limits = checkDocLimits(state.doc)
  if (!limits.ok) return { ok: false, field: 'description', message: limits.message }
  const description = descriptionToSave(state.doc)
  if (!same(description, descriptionForCompare(original.description))) set.description = description
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
