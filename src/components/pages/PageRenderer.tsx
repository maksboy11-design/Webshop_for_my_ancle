import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { ROUTES } from '../../config/routes'
import type { DescriptionDoc, DocInline, DocParagraph } from '../../cms/descriptionDoc'
import { type ButtonBlock, type ImageBlock, type PageBlock, type PageDoc, type TextBlock } from '../../cms/pageDoc'
import { Button, Chip, Tag } from '../site/ui'
import site from '../site/site.module.css'
import styles from './page.module.css'
import { buttonHref, groupBlocks, type PageLinks } from './pageLayout'

export type { PageLinks }

/** Цели кнопок: id страницы → слаг. Для публичного сайта — только опубликованные. */

const ASPECT: Record<string, string | undefined> = { '16:9': '16 / 9', '4:3': '4 / 3', '1:1': '1 / 1', '3:4': '3 / 4' }

function Inline({ content }: { content?: readonly DocInline[] }) {
  return (
    <>
      {(content ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />
        let el: ReactNode = n.text
        for (const m of n.marks ?? []) el = m.type === 'bold' ? <strong>{el}</strong> : <em>{el}</em>
        return <span key={i}>{el}</span>
      })}
    </>
  )
}

/** Текст в формате описания товара. Только React-узлы, без HTML-строк (XSS невозможен). */
export function DocText({ doc }: { doc: DescriptionDoc }) {
  return (
    <>
      {doc.content.map((b, i) => {
        if (b.type === 'heading')
          return b.attrs.level === 3 ? (
            <h3 key={i} className={site.h3}>
              <Inline content={b.content} />
            </h3>
          ) : (
            <h4 key={i}>
              <Inline content={b.content} />
            </h4>
          )
        if (b.type === 'bulletList' || b.type === 'orderedList') {
          const L = b.type === 'bulletList' ? 'ul' : 'ol'
          return (
            <L key={i}>
              {b.content.map((li, j) => (
                <li key={j}>
                  <Inline content={li.content[0].content} />
                </li>
              ))}
            </L>
          )
        }
        return (
          <p key={i}>
            <Inline content={(b as DocParagraph).content} />
          </p>
        )
      })}
    </>
  )
}

function TextView({ b, inGrid }: { b: TextBlock; inGrid: boolean }) {
  const cls = [styles.text, b.card ? site.fact : '', inGrid ? (b.width === 'narrow' ? '' : styles.wide) : styles[`w-${b.width}`]]
  return (
    <article className={cls.join(' ')} data-testid="page-text">
      {b.label && (
        <span className={styles.label}>
          <Tag>{b.label}</Tag>
        </span>
      )}
      <DocText doc={b.doc} />
    </article>
  )
}

function ImageView({ b }: { b: ImageBlock }) {
  const cls = `${styles.figure} ${styles[`w-${b.width}`]} ${styles[`a-${b.align}`]} ${styles[`r-${b.radius}`]}`
  if (!b.image)
    return <div className={`${styles.placeholder} ${styles[`w-${b.width}`]} ${styles[`a-${b.align}`]}`}>Изображение не выбрано</div>
  const style: CSSProperties = { aspectRatio: ASPECT[b.aspect] ?? `${b.image.width} / ${b.image.height}` }
  return (
    <figure className={cls} style={style} data-testid="page-image">
      <img
        src={b.image.src}
        srcSet={b.image.srcSet}
        sizes={b.width === 'wide' ? '100vw' : b.width === 'normal' ? '(max-width: 48rem) 100vw, 48rem' : '24rem'}
        width={b.image.width}
        height={b.image.height}
        alt={b.image.alt ?? ''}
        loading="lazy"
        decoding="async"
      />
    </figure>
  )
}

function ButtonView({ b, links, editing }: { b: ButtonBlock; links: PageLinks; editing?: boolean }) {
  const href = buttonHref(b, links)
  const row = `${styles.btnRow} ${styles[`a-${b.align}`]}`
  if (b.target.kind === 'external' && href && !editing) {
    return (
      <div className={row}>
        <a className={`${site.btn} ${site[b.variant]}`} href={href} target="_blank" rel="noopener noreferrer">
          {b.text}
        </a>
      </div>
    )
  }
  return (
    <div className={row} data-testid="page-button">
      {/* В редакторе кнопка не переходит по ссылке. */}
      <Button variant={b.variant} href={editing ? undefined : href} disabled={!editing && !href}>
        {b.text}
      </Button>
    </div>
  )
}

/** Один блок (используется и в редакторе — тот же вид, что на сайте). */
export function PageBlockView({
  block,
  links,
  editing,
  inGrid = false,
}: {
  block: PageBlock
  links: PageLinks
  editing?: boolean
  inGrid?: boolean
}) {
  switch (block.type) {
    case 'heading':
      return (
        <h2 className={`${site.h2} ${styles.heading}`} id={block.anchor || undefined}>
          {block.text}
        </h2>
      )
    case 'text':
      return <TextView b={block} inGrid={inGrid} />
    case 'image':
      return <ImageView b={block} />
    case 'button':
      return <ButtonView b={block} links={links} editing={editing} />
  }
}

function scrollTo(e: MouseEvent<HTMLElement>, id: string) {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function PageRenderer({
  title,
  doc,
  links,
  testId = 'public-page',
}: {
  title: string
  doc: PageDoc
  links: PageLinks
  testId?: string
}) {
  const toc = doc.toc ? doc.blocks.filter((b) => b.type === 'heading' && b.anchor) : []
  return (
    <div className={site.shell} data-testid={testId}>
      <div className={styles.back}>
        <Button href={ROUTES.home} variant="secondary">
          ← На главную
        </Button>
      </div>
      <header className={site.pageHead}>
        <h1 className={site.h1}>{title}</h1>
        {doc.lead && <p className={site.lead}>{doc.lead}</p>}
      </header>
      {toc.length > 0 && (
        <nav className={`${site.chipRow} ${styles.toc}`} aria-label="Разделы страницы">
          {toc.map((h) =>
            h.type === 'heading' ? (
              <span key={h.id} onClickCapture={(e) => scrollTo(e, h.anchor)}>
                <Chip href={`#${h.anchor}`}>{h.navLabel || h.text}</Chip>
              </span>
            ) : null,
          )}
        </nav>
      )}
      <div className={styles.blocks}>
        {groupBlocks(doc.blocks).map((g) =>
          Array.isArray(g) ? (
            <div key={g[0]!.id} className={`${site.three} ${styles.grid}`}>
              {g.map((b) => (
                <PageBlockView key={b.id} block={b} links={links} inGrid />
              ))}
            </div>
          ) : (
            <PageBlockView key={g.id} block={g} links={links} />
          ),
        )}
      </div>
      <div className={styles.backBottom}>
        <Button href={ROUTES.home} variant="secondary">
          ← На главную
        </Button>
      </div>
    </div>
  )
}
