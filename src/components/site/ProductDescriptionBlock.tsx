import type { DescriptionParagraph, DescriptionSection, ProductDescription } from '../../data/productDescriptions'
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

/** Блок «Описание» на странице товара. Тексты выводятся как есть из данных (дословно из документов заказчика). */
export function ProductDescriptionBlock({ description }: { description: ProductDescription }) {
  return (
    <section className={styles.desc} aria-labelledby="product-description">
      <h2 className={styles.h2} id="product-description">
        Описание
      </h2>
      <div className={styles.descBody}>
        {description.map((section, index) => (
          <Section key={index} section={section} />
        ))}
      </div>
    </section>
  )
}
