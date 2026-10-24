import { useState } from 'react'
import type { Review } from '../../../cms/types'
import { productHref } from '../../../config/hashRoute'
import { productById } from '../../../data/products'
import { MediaCarousel } from './MediaCarousel'
import styles from './reviews.module.css'

const TEXT_FOLD = 420

function ReviewText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > TEXT_FOLD
  return (
    <>
      <p className={long && !open ? `${styles.text} ${styles.textClamped}` : styles.text}>{text}</p>
      {long && (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Свернуть' : 'Читать полностью'}
        </button>
      )}
    </>
  )
}

export function ReviewCard({ review }: { review: Review }) {
  const product = productById(review.productId)
  const text = review.text?.trim() ?? ''
  const author = review.author?.trim() ?? ''
  const hasMedia = Boolean(review.media && review.media.length > 0)

  return (
    <article className={styles.card} aria-label={product ? `Отзыв о товаре ${product.name}` : 'Отзыв'}>
      {product ? (
        <a className={styles.product} href={productHref(product.slug)}>
          <span className={styles.thumb}>
            <img src={product.image.src} alt="" width={product.image.width} height={product.image.height} />
          </span>
          <span className={styles.productName}>{product.name}</span>
        </a>
      ) : (
        <p className={styles.missing}>Товар снят с каталога</p>
      )}
      {hasMedia && review.media && <MediaCarousel media={review.media} />}
      {(text || author) && (
        <div className={styles.copy}>
          {text && <h3 className={styles.reviewTitle}>Отзыв покупателя</h3>}
          {text && <ReviewText text={text} />}
          {author && <p className={styles.author}>{author}</p>}
        </div>
      )}
    </article>
  )
}