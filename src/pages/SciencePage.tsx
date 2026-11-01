import type { MouseEvent } from 'react'
import { ROUTES } from '../config/routes'
import { Button, Chip, Tag } from '../components/site/ui'
import site from '../components/site/site.module.css'
import styles from './science.module.css'
import { PageRenderer } from '../components/pages/PageRenderer'
import { usePublicPage } from '../components/pages/publicPage'

const SCIENCE_SLUG = 'science'
import { SCIENCE_ARTICLE, SCIENCE_DOC_TITLE, SCIENCE_SECTIONS, SCIENCE_TITLE, type FactBlock } from '../data/scienceFacts'

const ARTICLE_ID = 'science-article'

function Blocks({ blocks }: { blocks: readonly FactBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'term') {
          return (
            <p key={index}>
              <strong>{block.term}</strong> {block.text}
            </p>
          )
        }
        return <p key={index}>{block.text}</p>
      })}
    </>
  )
}

/** Переход к разделу без смены hash-маршрута. */
function scrollToSection(event: MouseEvent<HTMLElement>, id: string) {
  event.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * «Научные факты». Если в разделе «Страницы» опубликована страница slug=science — показываем её;
 * пока её нет (миграция 010 не применена, страница не перенесена или API недоступен) — исходный контент.
 */
export function SciencePage() {
  const cms = usePublicPage(SCIENCE_SLUG)
  if (cms.state === 'ready') return <PageRenderer title={cms.page.title} doc={cms.page.doc} links={cms.page.links} testId="science-page" />
  return <StaticSciencePage />
}

function StaticSciencePage() {
  return (
    <div className={site.shell} data-testid="science-page">
      <div className={styles.back}>
        <Button href={ROUTES.home} variant="secondary">
          ← На главную
        </Button>
      </div>
      <header className={site.pageHead}>
        <h1 className={site.h1}>{SCIENCE_TITLE}</h1>
        <p className={site.lead}>{SCIENCE_DOC_TITLE}</p>
      </header>

      <nav className={`${site.chipRow} ${styles.toc}`} aria-label="Разделы страницы">
        {SCIENCE_SECTIONS.map((section) => (
          <span key={section.id} onClickCapture={(e) => scrollToSection(e, `science-${section.id}`)}>
            <Chip href={`#science-${section.id}`}>{section.navLabel}</Chip>
          </span>
        ))}
        <span onClickCapture={(e) => scrollToSection(e, ARTICLE_ID)}>
          <Chip href={`#${ARTICLE_ID}`}>Статья</Chip>
        </span>
      </nav>

      {SCIENCE_SECTIONS.map((section) => (
        <section key={section.id} id={`science-${section.id}`} className={styles.section} aria-labelledby={`science-${section.id}-title`}>
          <h2 className={site.h2} id={`science-${section.id}-title`}>
            {section.title}
          </h2>
          <div className={`${site.three} ${styles.cards}`}>
            {section.cards.map((card) => (
              <article
                key={card.id}
                className={`${site.fact} ${styles.card} ${section.cards.length === 1 ? styles.wide : ''}`}
                data-testid="science-card"
              >
                {section.cards.length > 1 && card.number && (
                  <span className={styles.num}>
                    <Tag>{card.number}</Tag>
                  </span>
                )}
                {section.cards.length > 1 && <h3 className={site.h3}>{card.title}</h3>}
                <Blocks blocks={card.blocks} />
              </article>
            ))}
          </div>
        </section>
      ))}

      <section id={ARTICLE_ID} className={styles.article} aria-labelledby={`${ARTICLE_ID}-title`}>
        <article className={`${site.fact} ${styles.card}`} data-testid="science-article">
          <h2 className={site.h2} id={`${ARTICLE_ID}-title`}>
            {SCIENCE_ARTICLE.title}
          </h2>
          <div className={styles.articleBody}>
            <Blocks blocks={SCIENCE_ARTICLE.blocks} />
          </div>
          <div>
            <a className={`${site.btn} ${site.primary}`} href={SCIENCE_ARTICLE.url} target="_blank" rel="noopener noreferrer">
              {SCIENCE_ARTICLE.linkLabel}
            </a>
          </div>
        </article>
      </section>

      <div className={styles.backBottom}>
        <Button href={ROUTES.home} variant="secondary">
          ← На главную
        </Button>
      </div>
    </div>
  )
}
