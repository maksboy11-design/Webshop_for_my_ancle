import { useState } from 'react'
import { COPY } from '../content/copy'
import { brandName } from '../data/products'
import { useProducts } from '../cms/liveProducts'
import { ProductExtraBlocks, ProductExtraButtons, ProductVideos } from '../components/site/ProductExtras'
import { PriceTag } from '../components/site/PriceTag'
import { ProductCard } from '../components/site/ProductCard'
import { ProductDescriptionBlock } from '../components/site/ProductDescriptionBlock'
import { ProductReviews } from '../components/site/ProductReviews'
import { Button, Tag } from '../components/site/ui'
import { isDescriptionDoc, isDocEmpty, type AnyDescription } from '../cms/descriptionDoc'
import styles from '../components/site/site.module.css'

function visibleDescription(description: AnyDescription | null): AnyDescription | null {
  if (isDescriptionDoc(description)) return isDocEmpty(description) ? null : description
  if (!description?.some((section) => Boolean(section.heading || section.paragraphs?.length || section.list?.length))) {
    return null
  }
  return description
}

export function ProductPage({ slug }: { slug: string }) {
  const products = useProducts()
  const product = products.find((item) => item.slug === slug)
  const [shot, setShot] = useState(0)
  if (!product) {
    return (
      <div className={`${styles.shell} ${styles.pageHead}`}>
        <h1 className={styles.h1}>Товар не найден</h1>
        <Button href="#catalog">В каталог</Button>
      </div>
    )
  }
  const photo = product.gallery[shot] ?? product.image
  const related = products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 4)
  const description = visibleDescription(product.description)

  return (
    <article className={`${styles.shell} ${styles.pageHead}`}>
      <p className={styles.crumbs}>
        <a href="#catalog">Каталог</a> / {product.name}
      </p>
      <div className={styles.productLayout ?? styles.flagship}>
        <div className={styles.gallery}>
          <div className={styles.heroShot}>
            <img
              src={photo.src}
              srcSet={photo.srcSet}
              sizes={photo.srcSet ? '(max-width: 760px) 100vw, 50vw' : undefined}
              width={photo.width}
              height={photo.height}
              alt={product.name}
            />
          </div>
          <div className={styles.thumbs}>
            {product.gallery.map((image, index) => (
              <button
                key={image.src}
                className={styles.thumb}
                type="button"
                aria-current={shot === index ? 'true' : undefined}
                aria-label={`Фото ${index + 1}`}
                onClick={() => setShot(index)}
              >
                <img src={image.thumb ?? image.src} alt="" width={72} height={72} />
              </button>
            ))}
            {product.kind === 'device' && product.id === 'flagship' && (
              <div className={styles.placeholder}>{COPY.photoPending}</div>
            )}
          </div>
        </div>
        <div>
          <Tag>{brandName(product.brandId)}</Tag>
          <h1 className={styles.h1}>{product.name}</h1>
          {product.pack && <p className={styles.lead}>{product.pack}</p>}
          <PriceTag price={product.price} size="page" />
          {product.extras?.blocks?.length ? <ProductExtraButtons blocks={product.extras.blocks} /> : null}
          {product.kind === 'supplement' && <p className={styles.warn}>{COPY.disclaimer}</p>}
        </div>
      </div>
      {description && <ProductDescriptionBlock description={description} />}
      {product.extras?.blocks.length ? <ProductExtraBlocks blocks={product.extras.blocks} /> : null}
      {product.extras?.videos.length ? <ProductVideos videos={product.extras.videos} /> : null}
      {product.documents?.length ? (
        <section className={styles.section} aria-labelledby="product-docs">
          <h2 className={styles.h2} id="product-docs">
            Документы
          </h2>
          <ul className={styles.docList}>
            {product.documents.map((doc) => (
              <li key={doc.url}>
                <a href={doc.url} target="_blank" rel="noopener" className={styles.docLink}>
                  {doc.title}
                </a>{' '}
                <span className={styles.docMeta}>PDF, {formatDocSize(doc.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ProductReviews productId={product.id} />
      {product.id === 'flagship' && (
        <section className={styles.section} aria-labelledby="related-reagent">
          <h2 className={styles.h2} id="related-reagent">
            Сопутствующее
          </h2>
          <div className={`${styles.grid} ${styles.gridCards}`}>
            {products.filter((item) => item.id === 'reagent').map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
      {related.length > 0 && (
        <section className={styles.section} aria-labelledby="related">
          <h2 className={styles.h2} id="related">
            {product.kind === 'supplement' ? 'Другие БАДы' : 'С этим смотрят'}
          </h2>
          <div className={`${styles.grid} ${styles.gridCards}`}>
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </article>
  )
}

function formatDocSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`
}
