/** Чистые помощники рендера страниц (без React): ссылки кнопок и группировка карточек в сетку. */
import { pageHref, type ButtonBlock, type PageBlock } from '../../cms/pageDoc'

export type PageLinks = Record<string, { slug: string; title: string; status?: string; deleted?: boolean }>

export function buttonHref(b: ButtonBlock, links: PageLinks): string | undefined {
  if (b.target.kind === 'external') return b.target.url
  if (b.target.kind === 'page') {
    const l = links[b.target.pageId]
    return l && !l.deleted ? pageHref(l.slug) : undefined
  }
  return undefined
}

/** Соседние «узкие» карточки собираются в сетку (как карточки «Научных фактов»). */
export function groupBlocks(blocks: readonly PageBlock[]): (PageBlock | PageBlock[])[] {
  const out: (PageBlock | PageBlock[])[] = []
  for (const b of blocks) {
    const narrowCard = b.type === 'text' && b.card && b.width === 'narrow'
    const last = out.at(-1)
    if (narrowCard && Array.isArray(last)) last.push(b)
    else out.push(narrowCard ? [b] : b)
  }
  return out
}
