import { useEffect, useState } from 'react'
import { cmsClient } from '../../cms/staticAdapter'
import type { Review } from '../../cms/types'
import styles from './site.module.css'

type Phase = 'loading' | 'empty' | 'error' | 'ready'

function isVisible(review: Review, productId: string): review is Review & { text: string } {
  return review.productId === productId && typeof review.text === 'string' && review.text.trim().length > 0
}

export function ProductReviews({ productId }: { productId: string }) {
  const [state, setState] = useState<{
    productId: string
    phase: Phase
    reviews: Array<Review & { text: string }>
  }>({ productId: '', phase: 'loading', reviews: [] })

  useEffect(() => {
    let cancelled = false
    cmsClient
      .listReviews({ productId })
      .then((items) => {
        if (cancelled) return
        const visible = items.filter((item) => isVisible(item, productId))
        setState({ productId, phase: visible.length === 0 ? 'empty' : 'ready', reviews: visible })
      })
      .catch(() => {
        if (!cancelled) setState({ productId, phase: 'error', reviews: [] })
      })
    return () => {
      cancelled = true
    }
  }, [productId])

  const phase = state.productId === productId ? state.phase : 'loading'
  const reviews = state.productId === productId ? state.reviews : []

  return (
    <section className={styles.section} aria-labelledby="product-reviews" data-testid="product-reviews">
      <h2 className={styles.h2} id="product-reviews">
        Отзывы
      </h2>
      {phase === 'loading' && <p className={styles.lead}>Загрузка отзывов</p>}
      {phase === 'empty' && <p className={styles.lead}>Опубликованных отзывов пока нет.</p>}
      {phase === 'error' && <p className={styles.lead}>Отзывы временно недоступны.</p>}
      {phase === 'ready' && (
        <ul className={styles.reviewList}>
          {reviews.map((review) => (
            <li key={review.id} className={styles.reviewItem}>
              <p className={styles.reviewAuthor}>{review.author ?? 'Имя не указано'}</p>
              <p className={styles.reviewText}>{review.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
