import { useId, useState } from 'react'
import type { FocusEventHandler, PointerEventHandler, ReactNode, RefCallback } from 'react'
import { productHref } from '../../config/hashRoute'
import type { FeaturedProduct } from '../../data/featuredProduct'
import { formatPv, formatRub } from '../../data/price'
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
  /**
   * Адрес страницы товара.
   * undefined — страница флагмана (#product/flagship-device).
   * null — страницы нет, кнопка честно об этом говорит.
   */
  href?: string | null
  /** Заглушка, если у товара нет фото. null — пустая рамка, без чужого рисунка. */
  placeholder?: ReactNode | null
}

const UNAVAILABLE_NOTE = 'Страница товара пока не подключена'

export function ProductCard({
  product,
  id,
  cardRef,
  href,
  placeholder = <DevicePlaceholder />,
  ...handlers
}: ProductCardProps) {
  const titleId = useId()
  const [note, setNote] = useState('')
  const pageHref = href === undefined ? productHref('flagship-device') : href

  return (
    <article
      ref={cardRef}
      id={id}
      className={styles.card}
      aria-labelledby={titleId}
      {...handlers}
    >
      <div className={styles.media}>
        <ProductImage slot={product.image} placeholder={placeholder} />
      </div>

      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {product.title}
        </h2>
      </div>

      {/* Цена на всю ширину карточки: обе цены (₽ и PV) всегда в одну строку */}
      {product.price && (
        <p className={styles.price}>
          <span className={styles.amount} data-price="rub">
            {formatRub(product.price.rub)}
          </span>
          <span className={styles.amount} data-price="pv">
            {formatPv(product.price.pv)}
          </span>
        </p>
      )}

      <p className={styles.description}>{product.description}</p>

      {pageHref ? (
        <a className={styles.cta} href={pageHref}>
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
