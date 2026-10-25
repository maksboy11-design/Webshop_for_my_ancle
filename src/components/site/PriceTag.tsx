import { COPY } from '../../content/copy'
import { formatPv, formatRub, type ProductPrice } from '../../data/price'
import styles from './site.module.css'

/**
 * Две равноправные цены рядом: «3 528 ₽» и «42 PV» — один стиль, один размер.
 * Без цены — прежняя заглушка «Цена уточняется».
 */
export function PriceTag({ price, size = 'card' }: { price: ProductPrice | null; size?: 'card' | 'page' }) {
  if (!price) return <p className={size === 'page' ? styles.h3 : styles.price}>{COPY.pricePending}</p>
  return (
    <p className={`${styles.priceRow} ${size === 'page' ? styles.priceRowPage : ''}`} data-testid="price">
      <span className={styles.priceItem} data-price="rub">
        {formatRub(price.rub)}
      </span>
      <span className={styles.priceItem} data-price="pv">
        {formatPv(price.pv)}
      </span>
    </p>
  )
}
