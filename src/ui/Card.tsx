import type { ReactNode } from 'react'
import { Press, Rise } from './motion'
import motion from './motion/motion.module.css'
import styles from './card.module.css'

/**
 * Единая карточка SILKWAY.
 * Радиусы и поверхность — из токенов (20/24, #ffffff, плитка #f6f8f0).
 * Наведение и нажатие только через Rise и Press: transform и opacity.
 * FAQ — отдельный аккордеон, не эта карточка.
 */
export type CardVariant = 'product' | 'category' | 'trust' | 'document' | 'media' | 'fact' | 'contact'

export interface CardProps {
  variant: CardVariant
  title: string
  description?: string
  image?: { src: string; alt: string; width?: number; height?: number }
  href?: string
  tag?: string
  footer?: ReactNode
  disabled?: boolean
  loading?: boolean
  headingLevel?: 2 | 3
}

export function Card({
  variant,
  title,
  description,
  image,
  href,
  tag,
  footer,
  disabled,
  loading,
  headingLevel = 3,
}: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const content = (
    <>
      {image && (
        <div className={variant === 'media' ? styles.poster : styles.media}>
          <img
            src={image.src}
            alt={image.alt}
            width={image.width ?? 600}
            height={image.height ?? 600}
            loading="lazy"
          />
        </div>
      )}
      {variant === 'media' && !image && (
        <div className={styles.poster} aria-hidden="true">
          <span className={styles.play}>▶</span>
        </div>
      )}
      <div className={styles.body}>
        {tag && <span className={styles.tag}>{tag}</span>}
        <Heading className={styles.title}>{title}</Heading>
        {description && <p className={styles.description}>{description}</p>}
      </div>
    </>
  )
  const className = `${styles.card} ${styles[variant]}`

  return (
    <Press className={motion.fill}>
      <Rise className={motion.fill}>
        <article
          className={className}
          aria-disabled={disabled || undefined}
          data-loading={loading || undefined}
        >
          {href && !disabled ? (
            <a className={styles.stretch} href={href}>
              {content}
            </a>
          ) : (
            content
          )}
          {footer}
        </article>
      </Rise>
    </Press>
  )
}
