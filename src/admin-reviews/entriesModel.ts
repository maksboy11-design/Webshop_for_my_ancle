/** Модель кнопки «Добавить» (товары, отзывы, вебинары). Обязательные поля совпадают с server/max/cmsEntries.ts. */
import { BRAND_LABELS, CATEGORY_LABELS } from '../content/copy'
import { PRODUCTS } from '../data/products'

export type EntryKind = 'product' | 'review' | 'webinar'
export type EntryStatus = 'draft' | 'published' | 'withdrawn'

export interface AdminEntry {
  id: string
  kind: EntryKind
  status: EntryStatus
  data: Record<string, string>
  missing: string[]
  createdAt: string
  updatedAt: string
}

export interface FieldDef {
  name: string
  label: string
  required: boolean
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'url'
  options?: readonly { value: string; label: string }[]
  maxLength?: number
}

const brandOptions = Object.entries(BRAND_LABELS).map(([value, label]) => ({
  value,
  label: Object.values(BRAND_LABELS).filter((l) => l === label).length > 1 ? `${label} (${value})` : label,
}))
const categoryOptions = Object.entries(CATEGORY_LABELS)
  .filter(([v]) => v !== 'all')
  .map(([value, label]) => ({ value, label }))

export const WEBINAR_CATEGORY_OPTIONS = [
  { value: 'products', label: 'Вебинар о продукции' },
  { value: 'doctors', label: 'Вебинар с врачами' },
] as const

export const ENTRY_FIELDS: Record<EntryKind, readonly FieldDef[]> = {
  product: [
    { name: 'name', label: 'Название', required: true, type: 'text', maxLength: 200 },
    { name: 'brandId', label: 'Бренд', required: true, type: 'select', options: brandOptions },
    { name: 'category', label: 'Категория', required: true, type: 'select', options: categoryOptions },
    { name: 'priceRub', label: 'Цена, ₽', required: true, type: 'number' },
    { name: 'pricePv', label: 'Цена, PV', required: false, type: 'number' },
    { name: 'pack', label: 'Фасовка', required: false, type: 'text', maxLength: 120 },
    { name: 'imageUrl', label: 'Ссылка на фото (https)', required: true, type: 'url', maxLength: 1000 },
    { name: 'description', label: 'Описание', required: true, type: 'textarea', maxLength: 20000 },
  ],
  review: [
    { name: 'productId', label: 'Товар', required: true, type: 'select', options: PRODUCTS.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'author', label: 'Имя автора', required: true, type: 'text', maxLength: 80 },
    { name: 'text', label: 'Текст отзыва', required: true, type: 'textarea', maxLength: 4000 },
  ],
  webinar: [
    { name: 'title', label: 'Название', required: true, type: 'text', maxLength: 300 },
    { name: 'youtubeUrl', label: 'Ссылка YouTube', required: true, type: 'url', maxLength: 500 },
    { name: 'category', label: 'Категория', required: true, type: 'select', options: WEBINAR_CATEGORY_OPTIONS },
    { name: 'speaker', label: 'Спикер', required: false, type: 'text', maxLength: 200 },
    { name: 'date', label: 'Дата', required: false, type: 'date' },
  ],
}

export const KIND_LABEL: Record<EntryKind, { add: string; list: string; title: (d: Record<string, string>) => string }> = {
  product: { add: 'Добавить товар', list: 'Добавленные товары', title: (d) => d.name || 'Товар без названия' },
  review: { add: 'Добавить отзыв', list: 'Добавленные отзывы', title: (d) => (d.author ? `Отзыв: ${d.author}` : 'Отзыв без автора') },
  webinar: { add: 'Добавить вебинар', list: 'Добавленные вебинары', title: (d) => d.title || 'Вебинар без названия' },
}

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  withdrawn: 'Снят',
}

export function missingRequired(kind: EntryKind, data: Record<string, string>): string[] {
  return ENTRY_FIELDS[kind].filter((f) => f.required && !(data[f.name] ?? '').trim()).map((f) => f.name)
}

export function fieldLabel(kind: EntryKind, name: string): string {
  return ENTRY_FIELDS[kind].find((f) => f.name === name)?.label ?? name
}
