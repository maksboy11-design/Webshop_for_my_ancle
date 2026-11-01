/**
 * Перенос «Научных фактов» (src/data/scienceFacts.ts) в модель страницы.
 * Текст, порядок, заголовки и списки сохраняются дословно; адрес остаётся #science (slug 'science'),
 * ссылка Hero продолжает работать. Используется скриптом scripts/migrate-science-page.ts и тестами.
 */
import type { DescriptionDoc, DocBlock, DocParagraph } from './descriptionDoc'
import type { PageBlock, PageDoc } from './pageDoc'
import { SCIENCE_ARTICLE, SCIENCE_DOC_TITLE, SCIENCE_SECTIONS, SCIENCE_TITLE, type FactBlock } from '../data/scienceFacts'

export const SCIENCE_SLUG = 'science'

const para = (content: DocParagraph['content']): DocParagraph => ({ type: 'paragraph', attrs: { autoBold: false }, content })
function factToDoc(blocks: readonly FactBlock[]): DocBlock[] {
  return blocks.map((b): DocBlock => {
    if (b.kind === 'list')
      return { type: 'bulletList', content: b.items.map((t) => ({ type: 'listItem', content: [para([{ type: 'text', text: t }])] })) }
    if (b.kind === 'term')
      return para([
        { type: 'text', text: b.term, marks: [{ type: 'bold' }] },
        { type: 'text', text: ` ${b.text}` },
      ])
    return para([{ type: 'text', text: b.text }])
  })
}
const doc = (content: DocBlock[]): DescriptionDoc => ({ type: 'doc', version: 1, content })

export function scienceToPage(): { title: string; slug: string; doc: PageDoc } {
  const blocks: PageBlock[] = []
  for (const s of SCIENCE_SECTIONS) {
    blocks.push({
      id: `h-${s.id}`,
      type: 'heading',
      text: s.title,
      anchor: `science-${s.id}`,
      navLabel: s.navLabel,
      width: 'wide',
      align: 'left',
    })
    const multi = s.cards.length > 1
    for (const c of s.cards) {
      const head: DocBlock[] = multi ? [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: c.title }] }] : []
      blocks.push({
        id: `c-${c.id}`,
        type: 'text',
        doc: doc([...head, ...factToDoc(c.blocks)]),
        card: true,
        label: multi ? (c.number ?? '') : '',
        width: multi ? 'narrow' : 'wide',
        align: 'left',
      })
    }
  }
  blocks.push({
    id: 'h-article',
    type: 'heading',
    text: SCIENCE_ARTICLE.title,
    anchor: 'science-article',
    navLabel: 'Статья',
    width: 'wide',
    align: 'left',
  })
  blocks.push({
    id: 'c-article',
    type: 'text',
    doc: doc(factToDoc(SCIENCE_ARTICLE.blocks)),
    card: true,
    label: '',
    width: 'wide',
    align: 'left',
  })
  blocks.push({
    id: 'b-article',
    type: 'button',
    text: SCIENCE_ARTICLE.linkLabel,
    variant: 'primary',
    target: { kind: 'external', url: SCIENCE_ARTICLE.url },
    width: 'normal',
    align: 'left',
  })
  return { title: SCIENCE_TITLE, slug: SCIENCE_SLUG, doc: { version: 1, lead: SCIENCE_DOC_TITLE, toc: true, blocks } }
}

/** Весь текст источника в порядке появления — для проверки «ничего не потеряно». */
export function scienceSourceTexts(): string[] {
  const out: string[] = [SCIENCE_TITLE, SCIENCE_DOC_TITLE]
  const fb = (bs: readonly FactBlock[]) => {
    for (const b of bs) {
      if (b.kind === 'list') out.push(...b.items)
      else if (b.kind === 'term') out.push(b.term, b.text)
      else out.push(b.text)
    }
  }
  for (const s of SCIENCE_SECTIONS) {
    out.push(s.title)
    for (const c of s.cards) {
      if (s.cards.length > 1) out.push(c.title)
      fb(c.blocks)
    }
  }
  out.push(SCIENCE_ARTICLE.title)
  fb(SCIENCE_ARTICLE.blocks)
  out.push(SCIENCE_ARTICLE.linkLabel, SCIENCE_ARTICLE.url)
  return out
}

/** Тексты страницы в порядке появления (та же разбивка, что в scienceSourceTexts). */
export function pageTexts(title: string, d: PageDoc): string[] {
  const out: string[] = [title, d.lead]
  for (const b of d.blocks) {
    if (b.type === 'heading') out.push(b.text)
    else if (b.type === 'button') out.push(b.text, b.target.kind === 'external' ? b.target.url : '')
    else if (b.type === 'text')
      for (const n of b.doc.content) {
        const inl =
          n.type === 'bulletList' || n.type === 'orderedList' ? n.content.map((li) => li.content[0].content ?? []) : [n.content ?? []]
        for (const parts of inl) {
          const texts = parts.map((x) => (x.type === 'text' ? x.text : '\n'))
          if (parts.length === 2 && parts[0]!.type === 'text' && parts[0]!.marks?.length) out.push(texts[0]!, texts[1]!.slice(1))
          else out.push(texts.join(''))
        }
      }
  }
  return out
}
