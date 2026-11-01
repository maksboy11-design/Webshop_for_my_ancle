/**
 * Структурированное описание товара (версия 1) — JSON-модель редактора описаний.
 * Формат совместим с JSON ProseMirror/TipTap (doc → блоки → text с марками), но хранится
 * и проверяется без зависимости от редактора: этим модулем пользуются сервер, сайт и админка.
 *
 * Хранение: в том же jsonb-поле overrides.description, что и старый формат (массив секций).
 * Старый формат — массив, новый — объект { type: 'doc', version: 1, content }. Отличаются по форме,
 * поэтому старые описания читаются как раньше и конвертируются в документ только при открытии в редакторе.
 */
import type { DescriptionSection, ProductDescription } from '../data/productDescriptions'

export type MarkType = 'bold' | 'italic'
export interface DocMark {
  type: MarkType
}
export interface DocText {
  type: 'text'
  text: string
  marks?: DocMark[]
}
export interface DocHardBreak {
  type: 'hardBreak'
}
export type DocInline = DocText | DocHardBreak

export interface DocParagraph {
  type: 'paragraph'
  /** autoBold:false — абзац без автоматического жирного (пользователь снял жирный или старое описание). */
  attrs?: { autoBold?: boolean }
  content?: DocInline[]
}
export interface DocHeading {
  type: 'heading'
  attrs: { level: 3 | 4 }
  content?: DocInline[]
}
export interface DocListItem {
  type: 'listItem'
  content: [DocParagraph]
}
export interface DocList {
  type: 'bulletList' | 'orderedList'
  content: DocListItem[]
}
export type DocBlock = DocParagraph | DocHeading | DocList

export interface DescriptionDoc {
  type: 'doc'
  version: 1
  content: DocBlock[]
  /** Автоматическая нумерация секций (карточек с заголовком) на сайте. По умолчанию выключена. */
  numbered?: boolean
}

/** Любое описание: старые секции или новый документ. */
export type AnyDescription = ProductDescription | DescriptionDoc

/**
 * Лимиты. В MAX описание показывается страницей сайта внутри WebView, а не сообщением бота,
 * поэтому лимит сообщений MAX (4000 символов) к описанию не применяется. Существующий лимит проекта —
 * 6000 символов на один текстовый фрагмент (TEXT_MAX сервера); общий лимит документа введён явно.
 */
export const DOC_TEXT_MAX = 20_000
export const DOC_BLOCK_TEXT_MAX = 6000
export const DOC_BLOCKS_MAX = 400
export const DOC_LIST_ITEMS_MAX = 200
export const DOC_WARN_RATIO = 0.9

export function isList(b: DocBlock): b is DocList {
  return b.type === 'bulletList' || b.type === 'orderedList'
}

export function isDescriptionDoc(v: unknown): v is DescriptionDoc {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (v as { type?: unknown }).type === 'doc'
}

export function emptyDoc(): DescriptionDoc {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph' }] }
}

/** Длина в символах так, как их видит человек (эмодзи и суррогатные пары — один символ). */
export function charLength(s: string): number {
  return Array.from(s).length
}

export function inlineText(content: readonly DocInline[] | undefined, br = '\n'): string {
  return (content ?? []).map((n) => (n.type === 'text' ? n.text : br)).join('')
}

function blockTexts(b: DocBlock): string[] {
  if (isList(b)) return b.content.map((li) => inlineText(li.content[0]?.content))
  return [inlineText(b.content)]
}

/** Видимый текст без разметки: абзацы/пункты через перевод строки. */
export function docToPlainText(doc: DescriptionDoc): string {
  return doc.content.flatMap(blockTexts).join('\n')
}

/** Счётчик: только видимые символы (переводы строк и маркеры списков не считаются). */
export function docCharCount(doc: DescriptionDoc): number {
  return doc.content.flatMap(blockTexts).reduce((sum, t) => sum + charLength(t.replace(/\n/g, '')), 0)
}

export function docLongestBlock(doc: DescriptionDoc): number {
  return Math.max(0, ...doc.content.flatMap(blockTexts).map((t) => charLength(t.replace(/\n/g, ''))))
}

export function isDocEmpty(doc: DescriptionDoc): boolean {
  return docCharCount(doc) === 0
}

export type LimitCheck = { ok: true } | { ok: false; message: string }

export function checkDocLimits(doc: DescriptionDoc): LimitCheck {
  const total = docCharCount(doc)
  if (total > DOC_TEXT_MAX) return { ok: false, message: `Описание длиннее лимита: ${total} из ${DOC_TEXT_MAX} символов. Сократите текст — обрезать его автоматически мы не будем.` }
  const longest = docLongestBlock(doc)
  if (longest > DOC_BLOCK_TEXT_MAX) return { ok: false, message: `Один абзац или пункт длиннее ${DOC_BLOCK_TEXT_MAX} символов (${longest}). Разбейте его на несколько.` }
  if (doc.content.length > DOC_BLOCKS_MAX) return { ok: false, message: `Слишком много блоков: ${doc.content.length} из ${DOC_BLOCKS_MAX}.` }
  return { ok: true }
}

// ---------- марки и автожирный ----------

function sameMarks(a: DocMark[] | undefined, b: DocMark[] | undefined) {
  const x = (a ?? []).map((m) => m.type).sort().join()
  const y = (b ?? []).map((m) => m.type).sort().join()
  return x === y
}

function normMarks(marks: readonly DocMark[] | undefined): DocMark[] | undefined {
  const set = new Set((marks ?? []).map((m) => m.type))
  const out: DocMark[] = []
  if (set.has('bold')) out.push({ type: 'bold' })
  if (set.has('italic')) out.push({ type: 'italic' })
  return out.length ? out : undefined
}

/** Склеивает соседние текстовые узлы с одинаковыми марками, убирает пустые. */
export function normalizeInline(content: readonly DocInline[] | undefined): DocInline[] {
  const out: DocInline[] = []
  for (const n of content ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ type: 'hardBreak' })
      continue
    }
    if (!n.text) continue
    const marks = normMarks(n.marks)
    const last = out[out.length - 1]
    if (last && last.type === 'text' && sameMarks(last.marks, marks)) last.text += n.text
    else out.push(marks ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text })
  }
  return out
}

function withMark(content: readonly DocInline[] | undefined, mark: MarkType, on: boolean): DocInline[] {
  return normalizeInline(
    (content ?? []).map((n) => {
      if (n.type !== 'text') return n
      const rest = (n.marks ?? []).filter((m) => m.type !== mark)
      return { ...n, marks: on ? [...rest, { type: mark }] : rest }
    }),
  )
}

export function isAutoBold(p: DocParagraph): boolean {
  return p.attrs?.autoBold !== false
}

/**
 * Автоформатирование: каждый абзац верхнего уровня с autoBold — целиком жирный.
 * Пункты списков, заголовки и абзацы с autoBold:false не трогаются. Идемпотентно.
 */
export function autoBoldDoc(doc: DescriptionDoc): DescriptionDoc {
  return {
    ...doc,
    content: doc.content.map((b) => (b.type === 'paragraph' && isAutoBold(b) ? paragraph(withMark(b.content, 'bold', true)) : b)),
  }
}

function paragraph(content: DocInline[], autoBold = true): DocParagraph {
  const p: DocParagraph = { type: 'paragraph' }
  if (!autoBold) p.attrs = { autoBold: false }
  if (content.length) p.content = content
  return p
}

function txt(text: string, marks?: MarkType[]): DocText {
  return marks?.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text }
}

// ---------- старый формат → документ ----------

/**
 * Конвертация старых секций в документ без потери текста и без изменения вида:
 * обычные абзацы → абзацы без автожирного; «Подпись: текст» → жирная подпись + текст;
 * список с маркерами → маркированный список; список без маркеров (авторская нумерация в тексте) → абзацы.
 */
export function legacyToDoc(desc: ProductDescription): DescriptionDoc {
  const content: DocBlock[] = []
  const lines = (s: string): DocInline[] => {
    const parts = s.split(/\r?\n/)
    const out: DocInline[] = []
    parts.forEach((p, i) => {
      if (i > 0) out.push({ type: 'hardBreak' })
      if (p) out.push(txt(p))
    })
    return out
  }
  for (const s of desc as readonly DescriptionSection[]) {
    if (s.heading || s.number) {
      const text = [s.number, s.heading].filter(Boolean).join(' ')
      content.push({ type: 'heading', attrs: { level: s.level === 'minor' ? 4 : 3 }, content: normalizeInline(lines(text)) })
    }
    for (const p of s.paragraphs ?? []) {
      if (typeof p === 'string') content.push(paragraph(normalizeInline(lines(p)), false))
      else content.push(paragraph(normalizeInline([txt(p.label, ['bold']), txt(' '), ...lines(p.text)]), false))
    }
    if (s.list?.length) {
      if (s.listStyle === 'none') for (const item of s.list) content.push(paragraph(normalizeInline(lines(item)), false))
      else content.push({ type: 'bulletList', content: s.list.map((item) => listItem(normalizeInline(lines(item)))) })
    }
  }
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph' }] }
}

export function toEditableDoc(desc: AnyDescription | null): DescriptionDoc {
  if (!desc) return emptyDoc()
  if (isDescriptionDoc(desc)) return desc
  return legacyToDoc(desc)
}

function listItem(content: DocInline[]): DocListItem {
  return { type: 'listItem', content: [paragraph(content, false)] }
}

// ---------- вставка текста ----------

const BULLET_RE = /^\s*(?:[-–—•●▪*]|·)\s+/
const ORDERED_RE = /^\s*\d{1,3}[.)]\s+/

export function stripListMarker(s: string): string {
  return s.replace(BULLET_RE, '').replace(ORDERED_RE, '')
}

/**
 * Многострочный обычный текст из буфера → блоки. Каждая строка — абзац (автожирный);
 * подряд идущие строки «- …»/«• …» → маркированный список, «1. …» → нумерованный.
 * Пустые строки разделяют блоки и не создают пустых абзацев. HTML не принимается вовсе.
 */
export function textToBlocks(text: string): DocBlock[] {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\t/g, ' ')
  const blocks: DocBlock[] = []
  for (const line of clean.split('\n')) {
    if (line.trim() === '') continue
    const kind = BULLET_RE.test(line) ? 'bulletList' : ORDERED_RE.test(line) ? 'orderedList' : null
    if (kind) {
      const item = listItem(normalizeInline([txt(stripListMarker(line))]))
      const last = blocks[blocks.length - 1]
      if (last && last.type === kind) last.content.push(item)
      else blocks.push({ type: kind, content: [item] })
    } else blocks.push(paragraph(normalizeInline([txt(line)])))
  }
  return blocks
}

// ---------- списки ----------

/** Строки блока: абзац/заголовок делятся по мягким переносам, список — по пунктам. */
function blockLines(b: DocBlock): { content: DocInline[]; autoBold: boolean }[] {
  if (isList(b)) {
    return b.content.map((li) => ({ content: li.content[0]?.content ?? [], autoBold: false }))
  }
  const auto = b.type === 'paragraph' && isAutoBold(b)
  const out: { content: DocInline[]; autoBold: boolean }[] = [{ content: [], autoBold: auto }]
  for (const n of b.content ?? []) {
    if (n.type === 'hardBreak') out.push({ content: [], autoBold: auto })
    else out[out.length - 1]!.content.push(n)
  }
  return out
}

function stripMarkerInline(content: DocInline[]): DocInline[] {
  const first = content[0]
  if (!first || first.type !== 'text') return content
  const stripped = stripListMarker(first.text)
  if (stripped === first.text) return content
  return normalizeInline([{ ...first, text: stripped }, ...content.slice(1)])
}

function trimInline(content: DocInline[]): DocInline[] {
  return normalizeInline(content)
}

export type ListKind = 'bulletList' | 'orderedList'

/**
 * «Автосписок» / «Нумерация» для набора блоков. Каждая непустая строка → отдельный пункт.
 * Если все блоки уже списки этого типа — список снимается (обратно в абзацы с автожирным).
 * Список другого типа меняет тип без вложенности. Маркеры «- », «• », «1. » в начале строк удаляются,
 * чтобы не было двойных маркеров; автожирный с бывших абзацев снимается (в пунктах он не нужен).
 */
export function applyListToBlocks(blocks: readonly DocBlock[], kind: ListKind): DocBlock[] {
  const lines = blocks.flatMap(blockLines)
  const allSame = blocks.length > 0 && blocks.every((b) => b.type === kind)
  if (allSame) {
    return lines.filter((l) => inlineText(l.content).trim() !== '').map((l) => paragraph(withMark(l.content, 'bold', true)))
  }
  const items = lines
    .map((l) => {
      let c = stripMarkerInline(l.content)
      if (l.autoBold) c = withMark(c, 'bold', false)
      return trimInline(c)
    })
    .filter((c) => inlineText(c).trim() !== '')
    .map(listItem)
  if (!items.length) return [...blocks]
  return [{ type: kind, content: items }]
}

/**
 * Границы «текущего блока» без выделения: подряд идущие абзацы вокруг курсора до пустого абзаца,
 * заголовка или списка другого типа. Если курсор в списке — только этот список.
 */
export function currentBlockRange(blocks: readonly DocBlock[], index: number): [number, number] {
  const b = blocks[index]
  if (!b) return [index, index]
  if (b.type !== 'paragraph' || inlineText(b.content).trim() === '') return [index, index]
  const isLine = (x: DocBlock | undefined) => !!x && x.type === 'paragraph' && inlineText(x.content).trim() !== ''
  let from = index
  let to = index
  while (isLine(blocks[from - 1])) from--
  while (isLine(blocks[to + 1])) to++
  return [from, to]
}

// ---------- проверка (сервер и клиент) ----------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export type DocResult = { ok: true; value: DescriptionDoc } | { ok: false; error: string }

function cleanInline(v: unknown): DocInline[] | string {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > 4000) return 'inline_invalid'
  const out: DocInline[] = []
  for (const n of v) {
    if (!n || typeof n !== 'object') return 'inline_invalid'
    const o = n as Record<string, unknown>
    if (o.type === 'hardBreak') {
      out.push({ type: 'hardBreak' })
      continue
    }
    if (o.type !== 'text' || typeof o.text !== 'string') return 'inline_invalid'
    if (CONTROL.test(o.text) || /[\r\n]/.test(o.text)) return 'control_chars'
    const marks: MarkType[] = []
    if (o.marks !== undefined && o.marks !== null) {
      if (!Array.isArray(o.marks)) return 'mark_invalid'
      for (const m of o.marks) {
        const t = m && typeof m === 'object' ? (m as { type?: unknown }).type : null
        if (t !== 'bold' && t !== 'italic') return 'mark_invalid'
        marks.push(t)
      }
    }
    out.push(txt(o.text, marks))
  }
  return normalizeInline(out)
}

function cleanParagraph(v: unknown): DocParagraph | string {
  if (!v || typeof v !== 'object' || (v as { type?: unknown }).type !== 'paragraph') return 'paragraph_invalid'
  const o = v as Record<string, unknown>
  const content = cleanInline(o.content)
  if (typeof content === 'string') return content
  const attrs = o.attrs as Record<string, unknown> | undefined
  return paragraph(content, !(attrs && typeof attrs === 'object' && attrs.autoBold === false))
}

/** Строгая проверка и пересборка документа: неизвестные узлы/марки/атрибуты отклоняются, HTML не бывает. */
export function validateDescriptionDoc(v: unknown): DocResult {
  if (!isDescriptionDoc(v)) return { ok: false, error: 'doc_invalid' }
  const o = v as unknown as Record<string, unknown>
  if (o.version !== 1) return { ok: false, error: 'doc_version' }
  if (!Array.isArray(o.content) || o.content.length > DOC_BLOCKS_MAX) return { ok: false, error: 'doc_blocks' }
  const content: DocBlock[] = []
  for (const raw of o.content) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'block_invalid' }
    const b = raw as Record<string, unknown>
    if (b.type === 'paragraph') {
      const p = cleanParagraph(b)
      if (typeof p === 'string') return { ok: false, error: p }
      content.push(p)
    } else if (b.type === 'heading') {
      const level = (b.attrs as { level?: unknown } | undefined)?.level
      if (level !== 3 && level !== 4) return { ok: false, error: 'heading_level' }
      const c = cleanInline(b.content)
      if (typeof c === 'string') return { ok: false, error: c }
      content.push(c.length ? { type: 'heading', attrs: { level }, content: c } : { type: 'heading', attrs: { level } })
    } else if (b.type === 'bulletList' || b.type === 'orderedList') {
      if (!Array.isArray(b.content) || b.content.length === 0 || b.content.length > DOC_LIST_ITEMS_MAX) return { ok: false, error: 'list_invalid' }
      const items: DocListItem[] = []
      for (const li of b.content) {
        const l = li as Record<string, unknown> | null
        if (!l || l.type !== 'listItem' || !Array.isArray(l.content) || l.content.length !== 1) return { ok: false, error: 'list_item_invalid' }
        const p = cleanParagraph(l.content[0])
        if (typeof p === 'string') return { ok: false, error: p }
        items.push({ type: 'listItem', content: [paragraph(p.content ?? [], false)] })
      }
      content.push({ type: b.type, content: items })
    } else return { ok: false, error: 'block_type' }
  }
  const doc: DescriptionDoc = { type: 'doc', version: 1, content }
  if (o.numbered === true) doc.numbered = true
  const limits = checkDocLimits(doc)
  if (!limits.ok) return { ok: false, error: 'too_long' }
  return { ok: true, value: doc }
}

/** Каноническая форма для сравнения и сохранения: проверка + автожирный + без хвостовых пустых абзацев. */
export function canonicalDoc(doc: DescriptionDoc): DescriptionDoc {
  const content = autoBoldDoc(doc).content.slice()
  while (content.length > 1) {
    const last = content[content.length - 1]!
    if (last.type === 'paragraph' && !last.content?.length) content.pop()
    else break
  }
  return doc.numbered ? { type: 'doc', version: 1, content, numbered: true } : { type: 'doc', version: 1, content }
}
