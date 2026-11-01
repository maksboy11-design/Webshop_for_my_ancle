import type { ReactNode } from 'react'
import type { DescriptionParagraph, DescriptionSection } from '../../data/productDescriptions'
import { isDescriptionDoc, type AnyDescription, type DescriptionDoc, type DocBlock, type DocInline } from '../../cms/descriptionDoc'
import styles from './site.module.css'

function Paragraph({ item }: { item: DescriptionParagraph }) {
  if (typeof item === 'string') return <p className={styles.descText}>{item}</p>
  return (
    <p className={styles.descText}>
      <strong>{item.label}</strong> {item.text}
    </p>
  )
}

function Section({ section }: { section: DescriptionSection }) {
  const level = section.level ?? 'major'
  const headingClass = level === 'group' ? styles.descGroup : level === 'minor' ? styles.descMinor : styles.descMajor
  const Heading = level === 'minor' ? 'h4' : 'h3'
  const hasBody = Boolean(section.paragraphs?.length || section.list?.length)
  return (
    <div
      className={`${level === 'group' ? styles.descGroupBox : styles.descSection} ${section.number ? styles.descNumbered : ''}`}
    >
      {section.number && (
        <span className={styles.descNumber} aria-hidden="true">
          {section.number}
        </span>
      )}
      <div className={styles.descContent}>
        {section.heading && <Heading className={headingClass}>{section.heading}</Heading>}
        {hasBody && (
          <>
            {section.paragraphs?.map((item, index) => (
              <Paragraph key={index} item={item} />
            ))}
            {section.list && (
              <ul className={section.listStyle === 'none' ? styles.descListPlain : styles.descList}>
                {section.list.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Безопасный вывод текста документа: только React-узлы (strong/em/br), никакого HTML из данных. */
function Inline({ content }: { content: readonly DocInline[] | undefined }) {
  return (
    <>
      {(content ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />
        let node: ReactNode = n.text
        const marks = new Set((n.marks ?? []).map((m) => m.type))
        if (marks.has('italic')) node = <em>{node}</em>
        if (marks.has('bold')) node = <strong>{node}</strong>
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

function DocBlockView({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'heading':
      return block.attrs.level === 4 ? (
        <h4 className={styles.descMinor}>
          <Inline content={block.content} />
        </h4>
      ) : (
        <h3 className={styles.descMajor}>
          <Inline content={block.content} />
        </h3>
      )
    case 'bulletList':
    case 'orderedList': {
      const List = block.type === 'orderedList' ? 'ol' : 'ul'
      return (
        <List className={block.type === 'orderedList' ? styles.descOrdered : styles.descList}>
          {block.content.map((li, i) => (
            <li key={i}>
              <Inline content={li.content[0]?.content} />
            </li>
          ))}
        </List>
      )
    }
    default:
      return block.content?.length ? (
        <p className={styles.descText}>
          <Inline content={block.content} />
        </p>
      ) : null
  }
}

/** Блоки документа делятся на карточки по заголовкам — как секции старого формата. */
function DocView({ doc }: { doc: DescriptionDoc }) {
  const groups: DocBlock[][] = []
  for (const b of doc.content) {
    if (b.type === 'heading' || groups.length === 0) groups.push([])
    groups[groups.length - 1]!.push(b)
  }
  return (
    <>
      {groups.map((g, i) => (
        <div key={i} className={styles.descSection} data-testid="desc-doc-section">
          <div className={styles.descContent}>
            {g.map((b, j) => (
              <DocBlockView key={j} block={b} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/** Тело описания (без заголовка «Описание») — используется и на сайте, и в предпросмотре админки. */
export function DescriptionContent({ description }: { description: AnyDescription }) {
  return (
    <div className={styles.descBody}>
      {isDescriptionDoc(description) ? (
        <DocView doc={description} />
      ) : (
        description.map((section, index) => <Section key={index} section={section} />)
      )}
    </div>
  )
}

/** Блок «Описание» на странице товара. Тексты выводятся как есть из данных (дословно из документов заказчика). */
export function ProductDescriptionBlock({ description }: { description: AnyDescription }) {
  return (
    <section className={styles.desc} aria-labelledby="product-description">
      <h2 className={styles.h2} id="product-description">
        Описание
      </h2>
      <DescriptionContent description={description} />
    </section>
  )
}
