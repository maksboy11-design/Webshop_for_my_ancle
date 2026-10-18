import { useId, useState } from 'react'
import type { FocusEventHandler, PointerEventHandler, RefCallback } from 'react'
import { PRODUCT_PAGE_URL } from '../../config/routes'
import { formatPrice, type FeaturedProduct } from '../../data/featuredProduct'
import { ArrowRightIcon } from '../icons'
import { ProductImage } from './ProductImage'
import { DevicePlaceholder } from './placeholders'
import styles from './ProductCard.module.css'

interface ProductCardProps {
  product: FeaturedProduct
  id: string
  cardRef: RefCallback<HTMLElement>
  onPointerEnter: PointerEventHandler
  onPointerLeave: PointerEventHandler
  onFocus: FocusEventHandler<HTMLElement>
  onBlur: FocusEventHandler<HTMLElement>
}

const UNAVAILABLE_NOTE = 'Страница товара пока не подключена'

export function ProductCard({ product, id, cardRef, ...handlers }: ProductCardProps) {
  const titleId = useId()
  const [note, setNote] = useState('')

  return (
    <article
      ref={cardRef}
      id={id}
      className={styles.card}
      aria-labelledby={titleId}
      {...handlers}
    >
      <div className={styles.media}>
        <ProductImage slot={product.image} placeholder={<DevicePlaceholder />} />
      </div>

      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {product.title}
        </h2>
        <p className={styles.price}>
          <span className={styles.amount}>{formatPrice(product.price.amount)}</span>
          {product.price.isDemo && <span className={styles.demo}>{product.price.demoLabel}</span>}
        </p>
      </div>

      <p className={styles.description}>{product.description}</p>

      {PRODUCT_PAGE_URL ? (
        <a className={styles.cta} href={PRODUCT_PAGE_URL}>
          <span>{product.ctaLabel}</span>
          <ArrowRightIcon size="1.25rem" />
        </a>
      ) : (
        // Страницы товара ещё нет: кнопка не притворяется ссылкой, а честно сообщает об этом.
        <button
          className={styles.cta}
          type="button"
          aria-disabled="true"
          aria-describedby={`${id}-note`}
          onClick={() => setNote(UNAVAILABLE_NOTE)}
        >
          <span>{product.ctaLabel}</span>
          <ArrowRightIcon size="1.25rem" />
        </button>
      )}

      {/* Зарезервированная строка: сообщение не меняет высоту карточки */}
      <p id={`${id}-note`} className={styles.note} role="status">
        {note}
      </p>
    </article>
  )
}
