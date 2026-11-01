/**
 * Секции описания: «Заголовок секции» — отдельный узел heading (level 3), всё после него до следующего
 * заголовка — содержимое этой секции (на сайте — отдельная белая карточка). Чистые функции над блоками
 * документа: создание заголовка из выделения и операции с секциями (переместить, дублировать, удалить).
 */
import { normalizeInline, type DocBlock, type DocHeading, type DocInline, type DocParagraph } from './descriptionDoc'

export interface SectionRange {
  /** Индекс первого блока (заголовка, если есть). */
  start: number
  /** Индекс после последнего блока. */
  end: number
  hasHeading: boolean
}

/** Диапазоны секций. Блоки до первого заголовка — вводная секция без заголовка. */
export function sectionRanges(blocks: readonly DocBlock[]): SectionRange[] {
  const out: SectionRange[] = []
  blocks.forEach((b, i) => {
    if (b.type === 'heading' || out.length === 0) out.push({ start: i, end: i + 1, hasHeading: b.type === 'heading' })
    else out[out.length - 1]!.end = i + 1
  })
  return out
}

/** Индекс секции по индексу блока. */
export function sectionIndexOf(blocks: readonly DocBlock[], blockIndex: number): number {
  return sectionRanges(blocks).findIndex((r) => blockIndex >= r.start && blockIndex < r.end)
}

/**
 * Перемещение секции с заголовком на одну позицию. Вводная секция (без заголовка) остаётся первой:
 * секции с заголовком меняются местами только между собой.
 */
export function moveSection(blocks: readonly DocBlock[], index: number, dir: -1 | 1): DocBlock[] {
  const r = sectionRanges(blocks)
  const j = index + dir
  const a = r[index]
  const b = r[j]
  if (!a || !b || !a.hasHeading || !b.hasHeading) return [...blocks]
  const [first, second] = dir === 1 ? [a, b] : [b, a]
  return [
    ...blocks.slice(0, first.start),
    ...blocks.slice(second.start, second.end),
    ...blocks.slice(first.start, first.end),
    ...blocks.slice(second.end),
  ]
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Копия секции сразу после оригинала. */
export function duplicateSection(blocks: readonly DocBlock[], index: number): DocBlock[] {
  const r = sectionRanges(blocks)[index]
  if (!r) return [...blocks]
  return [...blocks.slice(0, r.end), ...clone(blocks.slice(r.start, r.end)), ...blocks.slice(r.end)]
}

/** Удаление секции целиком (заголовок + содержимое). Пустой документ получает один пустой абзац. */
export function deleteSection(blocks: readonly DocBlock[], index: number): DocBlock[] {
  const r = sectionRanges(blocks)[index]
  if (!r) return [...blocks]
  const out = [...blocks.slice(0, r.start), ...blocks.slice(r.end)]
  return out.length ? out : [{ type: 'paragraph' }]
}

/** Переименование заголовка секции (текст без разметки). */
export function renameSection(blocks: readonly DocBlock[], index: number, title: string): DocBlock[] {
  const r = sectionRanges(blocks)[index]
  if (!r || !r.hasHeading) return [...blocks]
  const h = blocks[r.start] as DocHeading
  const t = title.replace(/[\r\n]+/g, ' ').trim()
  const next: DocHeading = t ? { ...h, content: [{ type: 'text', text: t }] } : { type: 'heading', attrs: h.attrs }
  return [...blocks.slice(0, r.start), next, ...blocks.slice(r.start + 1)]
}

function inlineSize(n: DocInline): number {
  return n.type === "hardBreak" ? 1 : n.text.length
}

/** Делит инлайн-содержимое по смещению (в единицах ProseMirror: символ UTF-16 = 1, hardBreak = 1). */
export function splitInline(content: readonly DocInline[] | undefined, at: number): [DocInline[], DocInline[]] {
  const left: DocInline[] = []
  const right: DocInline[] = []
  let pos = 0
  for (const n of content ?? []) {
    const size = inlineSize(n)
    if (pos + size <= at) left.push(n)
    else if (pos >= at) right.push(n)
    else if (n.type === 'text') {
      const k = at - pos
      left.push({ ...n, text: n.text.slice(0, k) })
      right.push({ ...n, text: n.text.slice(k) })
    }
    pos += size
  }
  return [normalizeInline(left), normalizeInline(right)]
}

function stripEdgeBreaks(c: DocInline[]): DocInline[] {
  const out = [...c]
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  return out
}

const plain = (c: DocInline[]): DocInline[] =>
  normalizeInline(c.map((n) => (n.type === 'text' ? { type: 'text', text: n.text } : n)))

const isBlank = (c: DocInline[]) => c.every((n) => n.type === 'hardBreak' || !n.text.trim())

/**
 * «Заголовок секции» для абзаца/заголовка. С выделением [from, to) (смещения внутри блока) выделенный
 * фрагмент становится отдельным заголовком; текст до него остаётся абзацем, после — новым абзацем.
 * Без выделения (from === to) весь блок становится заголовком, а повторное нажатие на заголовке
 * возвращает обычный абзац (переключатель). Разметка в заголовке снимается (стиль задаёт сайт).
 */
export function headingFromSelection(block: DocParagraph | DocHeading, from: number, to: number): DocBlock[] {
  if (from === to) {
    if (block.type === 'heading') {
      const c = block.content ?? []
      return [c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }]
    }
    const c = plain(stripEdgeBreaks(block.content ?? []))
    return [c.length ? { type: 'heading', attrs: { level: 3 }, content: c } : { type: 'heading', attrs: { level: 3 } }]
  }
  const [a, rest] = splitInline(block.content, Math.min(from, to))
  const [mid, b] = splitInline(rest, Math.abs(to - from))
  const title = plain(stripEdgeBreaks(mid)).map((n) => (n.type === 'text' ? { ...n, text: n.text.trim() } : n))
  if (isBlank(title)) return [block]
  const out: DocBlock[] = []
  const before = stripEdgeBreaks(a)
  const after = stripEdgeBreaks(b)
  const attrs = block.type === 'paragraph' ? block.attrs : undefined
  if (!isBlank(before)) out.push(block.type === 'heading' ? { type: 'heading', attrs: block.attrs, content: before } : { type: 'paragraph', ...(attrs ? { attrs } : {}), content: before })
  out.push({ type: 'heading', attrs: { level: 3 }, content: normalizeInline(title) })
  if (!isBlank(after)) out.push({ type: 'paragraph', content: after })
  return out
}
