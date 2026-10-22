import { CATEGORY_LABELS, COPY } from '../../content/copy'
import { brandName, type Product } from '../../data/products'
import { productHref } from '../../config/hashRoute'
import { Button, Tag } from './ui'
import styles from './site.module.css'

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className={styles.productCard}>
      <a href={productHref(product.slug)}>
        <div className={styles.media}>
          <img
            src={product.image.src}
            width={product.image.width}
            height={product.image.height}
            alt={product.name}
            loading="lazy"
          />
        </div>
        <Tag>{CATEGORY_LABELS[product.category]}</Tag>
        <h3 className={styles.cardName}>{product.name}</h3>
      </a>
      <p className={styles.price}>{product.price === null ? COPY.pricePending : ''}</p>
      <Button href={productHref(product.slug)} variant="soft" block>
        Подробнее
      </Button>
      <p className={styles.note}>{brandName(product.brandId)}</p>
    </article>
  )
}
