/**
 * Преобразование документа редактора (DescriptionDoc) ⇄ блоков контента v2 (product_content).
 * heading → section_heading, paragraph → text, bulletList/orderedList → bullet_list/ordered_list.
 * id блоков сохраняются при пересохранении (сопоставление по позиции и типу с прошлым черновиком),
 * чтобы будущие ссылки (медиа блока, история) не «прыгали».
 */
import { CONTENT_SCHEMA_VERSION, readProductContent, type BlockType, type ContentBlock, type ProductContent } from './blocks'
import { validateDescriptionDoc, type DescriptionDoc, type DocBlock, type DocInline } from './descriptionDoc'

const TEXT_TYPES: Record<DocBlock['type'], BlockType> = {
  heading: 'section_heading',
  paragraph: 'text',
  bulletList: 'bullet_list',
  orderedList: 'ordered_list',
}

function newId(used: Set<string>): string {
  for (;;) {
    const id = 'b' + Math.random().toString(36).slice(2, 12)
    if (!used.has(id)) return id
  }
}

/** Документ → контент. prev — прошлый черновик (для сохранения id и прочих блоков/meta). */
export function docToContent(doc: DescriptionDoc, prev?: ProductContent | null): ProductContent {
  const prevText = (prev?.blocks ?? []).filter((b) => Object.values(TEXT_TYPES).includes(b.type))
  const others = (prev?.blocks ?? []).filter((b) => !Object.values(TEXT_TYPES).includes(b.type))
  const used = new Set((prev?.blocks ?? []).map((b) => b.id))
  const taken = new Set<string>()
  const blocks: ContentBlock[] = doc.content.map((b, i) => {
    const type = TEXT_TYPES[b.type]
    const old = prevText[i]
    const id = old && old.type === type && !taken.has(old.id) ? old.id : newId(used)
    used.add(id)
    taken.add(id)
    let content: Record<string, unknown>
    if (b.type === 'heading') content = { level: b.attrs.level, inline: b.content ?? [] }
    else if (b.type === 'paragraph') content = { inline: b.content ?? [], autoBold: b.attrs?.autoBold !== false }
    else content = { items: b.content.map((li) => li.content[0]?.content ?? []) }
    return { id, type, order: i, active: true, settings: old && old.id === id ? old.settings : {}, content }
  })
  // Медиа/прочие блоки будущих этапов не теряются — идут после текста в прежнем порядке.
  others.forEach((b, k) => blocks.push({ ...b, order: blocks.length + k }))
  const meta = { ...(prev?.meta ?? {}) }
  if (doc.numbered) meta.numberSections = true
  else delete meta.numberSections
  return { schema_version: CONTENT_SCHEMA_VERSION, meta, blocks }
}

const inl = (v: unknown): DocInline[] => (Array.isArray(v) ? (v as DocInline[]) : [])

/** Контент → документ (только активные текстовые блоки), строго проверенный. null — пусто/битое. */
export function contentToDoc(raw: unknown): DescriptionDoc | null {
  const c = readProductContent(raw)
  if (!c) return null
  const content: unknown[] = []
  for (const b of c.blocks) {
    if (!b.active) continue
    const x = b.content
    if (b.type === 'section_heading') content.push({ type: 'heading', attrs: { level: x.level === 4 ? 4 : 3 }, content: inl(x.inline) })
    else if (b.type === 'text') content.push({ type: 'paragraph', attrs: { autoBold: x.autoBold !== false }, content: inl(x.inline) })
    else if (b.type === 'bullet_list' || b.type === 'ordered_list') {
      const items = Array.isArray(x.items) ? x.items : []
      if (!items.length) continue
      content.push({
        type: b.type === 'bullet_list' ? 'bulletList' : 'orderedList',
        content: items.map((it) => ({ type: 'listItem', content: [{ type: 'paragraph', attrs: { autoBold: false }, content: inl(it) }] })),
      })
    }
  }
  if (!content.length) return null
  const r = validateDescriptionDoc({ type: 'doc', version: 1, content, ...(c.meta.numberSections === true ? { numbered: true } : {}) })
  return r.ok ? r.value : null
}
