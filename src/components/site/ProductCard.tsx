import { CATEGORY_LABELS, COPY } from '../../content/copy'
import { brandName, type Product } from '../../data/products'
import { productHref } from '../../config/hashRoute'
import { Card } from '../../ui/Card'
import { Button } from './ui'
import styles from './site.module.css'

/** Карточка товара — вариант единого Card. */
export function ProductCard({ product }: { product: Product }) {
  return (
    <Card
      variant="product"
      title={product.name}
      tag={CATEGORY_LABELS[product.category]}
      href={productHref(product.slug)}
      image={{
        src: product.image.src,
        alt: product.name,
        width: product.image.width,
        height: product.image.height,
      }}
      footer={
        <>
          <p className={styles.price}>{product.price === null ? COPY.pricePending : ''}</p>
          <Button href={productHref(product.slug)} variant="soft" block>
            Подробнее
          </Button>
          <p className={styles.note}>{brandName(product.brandId)}</p>
        </>
      }
    />
  )
}
