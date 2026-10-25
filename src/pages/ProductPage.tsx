import { useState } from 'react'
import { CONTACTS } from '../config/contacts'
import { COPY } from '../content/copy'
import { brandName, PRODUCTS, productBySlug } from '../data/products'
import { ProductCard } from '../components/site/ProductCard'
import { ProductDescriptionBlock } from '../components/site/ProductDescriptionBlock'
import { ProductReviews } from '../components/site/ProductReviews'
import { Accordion, Button, Tag } from '../components/site/ui'
import styles from '../components/site/site.module.css'

const SPEC_ROWS = ['Модель', 'Питание', 'Размеры', 'Режим работы', 'Гарантия']

function MessengerButtons() {
  return (
    <div className={styles.actions}>
      <Button href={CONTACTS.telegram ?? undefined} disabled={!CONTACTS.telegram} variant="primary">
        Узнать цену в Telegram
      </Button>
      <Button href={CONTACTS.max ?? undefined} disabled={!CONTACTS.max} variant="secondary">
        Написать в MAX
      </Button>
    </div>
  )
}

export function ProductPage({ slug }: { slug: string }) {
  const product = productBySlug(slug)
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
  const related = PRODUCTS.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 4)
  const docsItem = { id: 'docs', title: 'Документы', body: <p>{COPY.filePending}</p> }
  // Если есть реальное описание — заглушки «Состав / Способ применения / Противопоказания» не нужны (эти данные уже в описании).
  const supplementItems = product.description
    ? [docsItem]
    : [
        { id: 'composition', title: 'Состав', body: <p>{COPY.textPending}</p> },
        { id: 'use', title: 'Способ применения', body: <p>{COPY.textPending}</p> },
        { id: 'contra', title: 'Противопоказания', body: <p>{COPY.textPending}</p> },
        docsItem,
      ]
  const deviceItems = [
    { id: 'about', title: 'Описание', body: <p>{COPY.deviceNote}</p> },
    {
      id: 'specs',
      title: 'Характеристики',
      body: (
        <table className={styles.specs}>
          <tbody>
            {SPEC_ROWS.map((row) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                <td>{COPY.valuePending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    { id: 'kit', title: 'Комплектация', body: <p>{COPY.textPending}</p> },
    { id: 'docs', title: 'Документы', body: <p>{COPY.filePending}</p> },
  ]

  return (
    <article className={`${styles.shell} ${styles.pageHead}`}>
      <p className={styles.crumbs}>
        <a href="#catalog">Каталог</a> / {product.name}
      </p>
      <div className={styles.productLayout ?? styles.flagship}>
        <div className={styles.gallery}>
          <div className={styles.heroShot}>
            <img src={photo.src} width={photo.width} height={photo.height} alt={product.name} />
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
                <img src={image.src} alt="" width={72} height={72} />
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
          <p className={styles.h3}>{COPY.pricePending}</p>
          {product.kind === 'supplement' && <p className={styles.warn}>{COPY.disclaimer}</p>}
          <p className={styles.lead}>{product.kind === 'device' ? COPY.deviceNote : COPY.supplementNote}</p>
          <MessengerButtons />
        </div>
      </div>
      {product.description && <ProductDescriptionBlock description={product.description} />}
      <div style={{ marginTop: '2rem' }}>
        <Accordion items={product.kind === 'supplement' ? supplementItems : deviceItems} initiallyOpen={product.description ? null : 0} />
      </div>
      <ProductReviews productId={product.id} />
      {product.id === 'flagship' && (
        <section className={styles.section} aria-labelledby="related-reagent">
          <h2 className={styles.h2} id="related-reagent">
            Сопутствующее
          </h2>
          <div className={styles.grid}>
            {PRODUCTS.filter((item) => item.id === 'reagent').map((item) => (
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
          <div className={styles.grid}>
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
