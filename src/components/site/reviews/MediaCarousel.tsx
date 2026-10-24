import { useEffect, useRef, useState } from 'react'
import type { ReviewMedia } from '../../../cms/types'
import styles from './reviews.module.css'

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
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

export function MediaCarousel({ media }: { media: readonly ReviewMedia[] }) {
  const [index, setIndex] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  const startX = useRef<number | null>(null)
  const current = Math.min(index, Math.max(0, media.length - 1))
  const slide = media[current]
  const several = media.length > 1

  useEffect(() => {
    const node = frame.current
    return () => {
      node?.querySelectorAll('video').forEach((video) => video.pause())
    }
  }, [current])

  if (!slide) return null

  const go = (next: number) => {
    frame.current?.querySelectorAll('video').forEach((video) => video.pause())
    setIndex(Math.min(media.length - 1, Math.max(0, next)))
  }

  return (
    <div
      className={styles.frame}
      ref={frame}
      role="group"
      aria-roledescription="карусель"
      aria-label="Фото и видео отзыва"
      onPointerDown={(event) => {
        if (!several) return
        startX.current = event.clientX
        event.stopPropagation()
      }}
      onPointerUp={(event) => {
        if (!several || startX.current === null) return
        const delta = event.clientX - startX.current
        startX.current = null
        event.stopPropagation()
        if (delta <= -40) go(current + 1)
        else if (delta >= 40) go(current - 1)
      }}
    >
      <div className={styles.slide} key={`${slide.type}-${slide.src}-${current}`}>
        {slide.type === 'image' ? (
          <img src={slide.src} alt={slide.alt ?? 'Фото из отзыва'} loading="lazy" />
        ) : (
          <video
            controls
            playsInline
            preload="metadata"
            poster={slide.poster ?? undefined}
            src={slide.src}
            aria-label={slide.alt ?? 'Видео из отзыва'}
          />
        )}
      </div>
      {several && (
        <>
          <button
            type="button"
            className={`${styles.arrow} ${styles.inner} ${styles.innerPrev}`}
            aria-label="Предыдущее фото или видео отзыва"
            disabled={current === 0}
            onClick={(event) => {
              event.stopPropagation()
              go(current - 1)
            }}
          >
            <Chevron direction="left" />
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.inner} ${styles.innerNext}`}
            aria-label="Следующее фото или видео отзыва"
            disabled={current === media.length - 1}
            onClick={(event) => {
              event.stopPropagation()
              go(current + 1)
            }}
          >
            <Chevron direction="right" />
          </button>
          <div className={`${styles.dots} ${styles.mediaDots}`}>
            {media.map((item, dot) => (
              <button
                key={`${item.src}-${dot}`}
                type="button"
                className={styles.dotHit}
                aria-label={`Медиа ${dot + 1} из ${media.length}`}
                aria-current={dot === current}
                onClick={(event) => {
                  event.stopPropagation()
                  go(dot)
                }}
              >
                <span className={styles.dot} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}