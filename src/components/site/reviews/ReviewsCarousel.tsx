import { useRef, useState } from 'react'
import type { Review } from '../../../cms/types'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { ReviewCard } from './ReviewCard'
import styles from './reviews.module.css'

function columnsFor(tablet: boolean, desktop: boolean) {
  if (desktop) return 3
  if (tablet) return 2
  return 1
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'M14.5 6.5 9 12l5.5 5.5' : 'M9.5 6.5 15 12l-5.5 5.5'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Внешняя карусель листает отзывы по одному.
 * На краях стрелки отключаются: зацикливания в проекте нет.
 */
export function ReviewsCarousel({ reviews }: { reviews: readonly Review[] }) {
  const tablet = useMediaQuery('(min-width: 48rem)')
  const desktop = useMediaQuery('(min-width: 64rem)')
  const columns = columnsFor(tablet, desktop)
  const [start, setStart] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const origin = useRef<number | null>(null)
  const maxStart = Math.max(0, reviews.length - columns)
  const safeStart = Math.min(start, maxStart)
  const movable = maxStart > 0


  const go = (next: number) => {
    stage.current?.querySelectorAll('video').forEach((video) => video.pause())
    setStart(Math.min(maxStart, Math.max(0, next)))
  }

  return (
    <div
      className={styles.stage}
      ref={stage}
      role="region"
      aria-roledescription="карусель"
      aria-label="Подборка отзывов"
      onPointerDown={(event) => {
        if (!movable) return
        origin.current = event.clientX
      }}
      onPointerUp={(event) => {
        if (!movable || origin.current === null) return
        const delta = event.clientX - origin.current
        origin.current = null
        if (Math.abs(delta) < 48) return
        go(safeStart + (delta < 0 ? 1 : -1))
      }}
    >
      <p className={styles.status} aria-live="polite">
        {`Отзывы ${safeStart + 1}–${Math.min(reviews.length, safeStart + columns)} из ${reviews.length}`}
      </p>
      {movable && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.outerPrev}`}
          aria-label="Предыдущие отзывы"
          disabled={safeStart === 0}
          onClick={() => go(safeStart - 1)}
        >
          <Chevron direction="left" />
        </button>
      )}
      <div className={styles.viewport}>
        <div
          className={styles.track}
          style={{
            ['--columns' as string]: columns,
            transform: `translateX(calc(${safeStart} * -1 * (100cqi + var(--space-4)) / ${columns}))`,
          }}
        >
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      </div>
      {movable && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.outerNext}`}
          aria-label="Следующие отзывы"
          disabled={safeStart === maxStart}
          onClick={() => go(safeStart + 1)}
        >
          <Chevron direction="right" />
        </button>
      )}
      {movable && maxStart <= 7 && (
        <div className={styles.dots}>
          {Array.from({ length: maxStart + 1 }, (_, dot) => (
            <button
              key={dot}
              type="button"
              className={styles.dotHit}
              aria-label={`Позиция отзывов ${dot + 1}`}
              aria-current={dot === safeStart}
              onClick={() => go(dot)}
            >
              <span className={styles.dot} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}