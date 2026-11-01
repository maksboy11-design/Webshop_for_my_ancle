/**
 * Предпубликационная проверка товара «Проверить товар» — правила без AI.
 * Каждый пункт даёт field для jump-to-field в форме.
 */
import type { Product } from '../data/products'
import type { ProductContent } from './blocks'
import { contentToDoc } from './contentDoc'
import { docToPlainText, isDescriptionDoc, isDocEmpty } from './descriptionDoc'
import { readCardFields } from './productCard'
import { readExtras } from './richBlocks'

export type ChecklistSeverity = 'error' | 'warn'

export interface ChecklistItem {
  id: string
  severity: ChecklistSeverity
  /** Ключ поля формы (data-field) для прокрутки. */
  field: string
  message: string
}

export interface ChecklistInput {
  productId: string
  /** Слияние каталог + черновик карточки (как в preview). */
  merged: Pick<
    Product,
    'name' | 'image' | 'gallery' | 'category' | 'brandId' | 'kind' | 'pack' | 'price' | 'description' | 'documents'
  >
  draft: ProductContent | null
  /** Файлы медиатеки со статусом failed, привязанные к товару. */
  failedMediaNames?: readonly string[]
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi

function collectLinks(text: string): string[] {
  return text.match(URL_RE) ?? []
}

function isLikelyBadUrl(raw: string): boolean {
  try {
    const u = new URL(raw.replace(/[),.;]+$/, ''))
    if (!/^https?:$/i.test(u.protocol)) return true
    if (!u.hostname.includes('.')) return true
    return false
  } catch {
    return true
  }
}

/** Чистые правила — без сети и без AI. */
export function checkProduct(input: ChecklistInput): ChecklistItem[] {
  const out: ChecklistItem[] = []
  const card = readCardFields(input.draft?.meta)
  const name = (card.name ?? input.merged.name ?? '').trim()
  if (!name) {
    out.push({ id: 'name', severity: 'error', field: 'name', message: 'Укажите название товара' })
  }

  const image = card.image ?? input.merged.image
  if (!image?.src) {
    out.push({ id: 'main_image', severity: 'error', field: 'image', message: 'Нужно главное фото' })
  } else if (!image.width || !image.height) {
    out.push({ id: 'image_size', severity: 'warn', field: 'image', message: 'У главного фото нет размеров (width/height)' })
  }

  const category = card.category ?? input.merged.category
  const brandId = card.brandId ?? input.merged.brandId
  const kind = card.kind ?? input.merged.kind
  if (!category) out.push({ id: 'category', severity: 'error', field: 'category', message: 'Не выбрана категория' })
  if (!brandId) out.push({ id: 'brand', severity: 'error', field: 'brand', message: 'Не указан бренд' })
  if (!kind) out.push({ id: 'kind', severity: 'error', field: 'kind', message: 'Не указан тип товара' })

  const price = card.price !== undefined ? card.price : input.merged.price
  if (price === null || price === undefined) {
    out.push({ id: 'price', severity: 'warn', field: 'price', message: 'Цена не задана (на сайте будет «уточняется»)' })
  }

  const doc = input.draft ? contentToDoc(input.draft) : isDescriptionDoc(input.merged.description) ? input.merged.description : null
  if (!doc || isDocEmpty(doc)) {
    out.push({ id: 'description', severity: 'warn', field: 'description', message: 'Описание пустое' })
  } else {
    for (let i = 0; i < doc.content.length; i++) {
      const b = doc.content[i]!
      if (b.type === 'heading') {
        const t = (b.content ?? []).filter((n) => n.type === 'text').map((n) => (n as { text: string }).text).join('').trim()
        if (!t) {
          out.push({
            id: `section_empty_${i}`,
            severity: 'warn',
            field: 'description',
            message: `Пустой заголовок в описании (#${i + 1})`,
          })
        }
      } else if (b.type === 'paragraph') {
        const t = (b.content ?? []).filter((n) => n.type === 'text').map((n) => (n as { text: string }).text).join('').trim()
        // Пустые абзацы между блоками — ок; помечаем только если весь документ из пустых — уже isDocEmpty
        void t
      } else if (b.type === 'bulletList' || b.type === 'orderedList') {
        if (!b.content.length) {
          out.push({
            id: `section_empty_${i}`,
            severity: 'warn',
            field: 'description',
            message: `Пустой список в описании (#${i + 1})`,
          })
        }
      }
    }
    const plain = docToPlainText(doc)
    for (const link of collectLinks(plain)) {
      if (isLikelyBadUrl(link)) {
        out.push({
          id: `link_${link.slice(0, 40)}`,
          severity: 'warn',
          field: 'description',
          message: `Подозрительная ссылка: ${link.slice(0, 80)}`,
        })
      }
    }
  }

  for (const g of card.gallery ?? input.merged.gallery ?? []) {
    if (!g.width || !g.height) {
      out.push({
        id: 'gallery_size',
        severity: 'warn',
        field: 'gallery',
        message: 'В галерее есть фото без размеров',
      })
      break
    }
  }

  if (input.failedMediaNames?.length) {
    out.push({
      id: 'invalid_files',
      severity: 'error',
      field: 'media',
      message: `Битые файлы: ${input.failedMediaNames.slice(0, 5).join(', ')}${input.failedMediaNames.length > 5 ? '…' : ''}`,
    })
  }

  const extras = readExtras(input.draft)
  if (extras.showVideos) {
    if (!extras.videos.length) {
      out.push({
        id: 'videos_empty',
        severity: 'warn',
        field: 'videos',
        message: 'Включены «Видео о товаре», но список пуст',
      })
    } else {
      for (const v of extras.videos) {
        if (!v.src) {
          out.push({
            id: `video_${v.key}`,
            severity: 'error',
            field: 'videos',
            message: `Видео «${v.title || v.key}» без источника`,
          })
        }
      }
    }
  }

  for (const b of extras.blocks) {
    const c = b.content
    if (b.type === 'image') {
      const img = c.image
      if (img && typeof img === 'object' && (!('width' in img) || !(img as { width?: number }).width || !(img as { height?: number }).height)) {
        out.push({
          id: `block_img_${b.id}`,
          severity: 'warn',
          field: 'extras',
          message: 'Блок «Фото» без размеров',
        })
      }
    }
    if (b.type === 'specs_table') {
      const rows = Array.isArray(c.rows) ? c.rows : []
      if (!rows.length) {
        const title = typeof c.title === 'string' ? c.title : ''
        out.push({
          id: `specs_empty_${b.id}`,
          severity: 'warn',
          field: 'extras',
          message: `Пустая таблица характеристик${title ? `: ${title}` : ''}`,
        })
      }
    }
  }

  return out
}

export function checklistSummary(items: readonly ChecklistItem[]): { errors: number; warns: number; ok: boolean } {
  let errors = 0
  let warns = 0
  for (const i of items) {
    if (i.severity === 'error') errors++
    else warns++
  }
  return { errors, warns, ok: errors === 0 }
}
