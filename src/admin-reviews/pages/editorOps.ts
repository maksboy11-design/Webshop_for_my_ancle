/**
 * Чистая логика редактора страниц: операции над блоками, история отмены (страничная, ограниченная),
 * позиционирование контекстного меню. Без DOM и сети — покрывается unit-тестами.
 */
import { emptyDoc } from '../../cms/descriptionDoc'
import type { BlockAlign, BlockWidth, PageBlock, PageBlockType, PageDoc } from '../../cms/pageDoc'
import { duplicateAt, moveItem, newBlockId, removeAt } from '../blocks/arrayOps'

export function newPageBlock(type: PageBlockType): PageBlock {
  const base = { id: newBlockId(type[0]), width: 'normal' as BlockWidth, align: 'left' as BlockAlign }
  switch (type) {
    case 'text':
      return { ...base, type, doc: emptyDoc(), card: false, label: '' }
    case 'heading':
      return { ...base, type, text: 'Новый раздел', anchor: '', navLabel: '', width: 'wide' }
    case 'image':
      return { ...base, type, image: null, aspect: 'auto', radius: 'md' }
    case 'button':
      return { ...base, type, text: 'Подробнее', variant: 'primary', target: { kind: 'none' } }
  }
}

export const insertBlock = (doc: PageDoc, at: number, b: PageBlock): PageDoc => ({
  ...doc,
  blocks: [...doc.blocks.slice(0, at), b, ...doc.blocks.slice(at)],
})
export const removeBlock = (doc: PageDoc, i: number): PageDoc => ({ ...doc, blocks: removeAt(doc.blocks, i) })
export const duplicateBlock = (doc: PageDoc, i: number): PageDoc => ({
  ...doc,
  blocks: duplicateAt(doc.blocks, i, (b) => ({ ...structuredClone(b), id: newBlockId(b.type[0]) })),
})
export const moveBlock = (doc: PageDoc, from: number, to: number): PageDoc =>
  to < 0 || to >= doc.blocks.length ? doc : { ...doc, blocks: moveItem(doc.blocks, from, to) }
export const updateBlock = (doc: PageDoc, id: string, patch: Partial<PageBlock>): PageDoc => ({
  ...doc,
  blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as PageBlock) : b)),
})
/** Перенос перетаскиванием: индикатор вставки стоит «перед before» (0..length). */
export function dropAt(doc: PageDoc, from: number, before: number): PageDoc {
  const to = before > from ? before - 1 : before
  return to === from ? doc : moveBlock(doc, from, to)
}

/* -------------------------------- история -------------------------------- */

export const HISTORY_LIMIT = 100
/** Правки одного поля подряд (набор текста) склеиваются в один шаг. */
export const COALESCE_MS = 1200

export interface Snapshot {
  title: string
  slug: string
  doc: PageDoc
}
export interface History {
  past: { snap: Snapshot; key: string; at: number }[]
  present: Snapshot
  future: Snapshot[]
}
export const initHistory = (present: Snapshot): History => ({ past: [], present, future: [] })

export function commit(h: History, next: Snapshot, key: string, now: number): History {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h
  const last = h.past.at(-1)
  if (key && last && last.key === key && now - last.at < COALESCE_MS) {
    // Склейка: «прошлое» остаётся тем же, обновляется только время.
    return { past: [...h.past.slice(0, -1), { ...last, at: now }], present: next, future: [] }
  }
  const past = [...h.past, { snap: h.present, key, at: now }]
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] }
}
export function undo(h: History): History {
  const last = h.past.at(-1)
  if (!last) return h
  return { past: h.past.slice(0, -1), present: last.snap, future: [h.present, ...h.future] }
}
export function redo(h: History): History {
  const [next, ...rest] = h.future
  if (!next) return h
  return { past: [...h.past, { snap: h.present, key: '', at: 0 }], present: next, future: rest }
}
/** Внешняя замена (загрузка, восстановление версии, ответ сервера) — без шага истории. */
export const resetHistory = (present: Snapshot): History => initHistory(present)

/* ------------------------------ контекстное меню ------------------------------ */

/** Позиция меню с прижатием к краям экрана (не вылезает за viewport). */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, margin = 8) {
  return {
    left: Math.max(margin, Math.min(x, vw - w - margin)),
    top: Math.max(margin, Math.min(y, vh - h - margin)),
  }
}

/** Двойной тап: два касания ближе по времени и месту. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, cur: { t: number; x: number; y: number }, ms = 350, px = 24) {
  return !!prev && cur.t - prev.t < ms && Math.abs(cur.x - prev.x) < px && Math.abs(cur.y - prev.y) < px
}

/** Текущий черновик для резервной копии (offline-safe). */
export const localKey = (pageId: string) => `silkway-page-draft:${pageId}`
