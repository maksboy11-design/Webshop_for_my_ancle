import { Button } from '../ui'
import site from '../site.module.css'
import { ReviewsCarousel } from './ReviewsCarousel'
import { usePublishedReviews } from './usePublishedReviews'

export function ReviewsBlock({
  heading,
  headingId,
  level,
  lead,
  productId,
  cta,
  testId,
  pageHead,
  embedded,
}: {
  heading: string
  headingId: string
  level: 'h1' | 'h2'
  lead?: string
  productId?: string
  cta?: { href: string; label: string }
  testId?: string
  pageHead?: boolean
  embedded?: boolean
}) {
  const { phase, reviews } = usePublishedReviews(productId)
  const Heading = level === 'h1' ? 'h1' : 'h2'
  const body = (
    <>
      <div className={pageHead ? site.pageHead : embedded ? undefined : site.shell}>
        <Heading className={level === 'h1' ? site.h1 : site.h2} id={headingId}>
          {heading}
        </Heading>
        {lead && <p className={site.lead}>{lead}</p>}
        {phase === 'loading' && <p className={site.lead}>Загрузка отзывов</p>}
        {phase === 'empty' && <p className={site.lead}>Опубликованных отзывов пока нет.</p>}
        {phase === 'error' && <p className={site.lead}>Отзывы временно недоступны.</p>}
        {phase === 'ready' && <ReviewsCarousel reviews={reviews} />}
        {cta && (
          <div className={site.center}>
            <Button href={cta.href} variant="secondary">
              {cta.label}
            </Button>
          </div>
        )}
      </div>
    </>
  )
  if (embedded) {
    return (
      <section className={site.section} aria-labelledby={headingId} data-testid={testId}>
        {body}
      </section>
    )
  }
  return (
    <section className={pageHead ? undefined : site.section} aria-labelledby={headingId} data-testid={testId}>
      {body}
    </section>
  )
}
