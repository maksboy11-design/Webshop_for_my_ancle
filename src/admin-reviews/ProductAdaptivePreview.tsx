/**
 * Адаптивный предпросмотр черновика: Desktop / Tablet / Mobile.
 * Рендерит реальные компоненты сайта (карточка + блоки описания/видео).
 */
import { useEffect, useMemo, useState } from 'react'
import { brandName, productById, type Product } from '../data/products'
import { productsApi, type PublicProductFields } from './adminHttp'
import { ProductCard } from '../components/site/ProductCard'
import { ProductDescriptionBlock } from '../components/site/ProductDescriptionBlock'
import { ProductExtraBlocks, ProductVideos } from '../components/site/ProductExtras'
import { PriceTag } from '../components/site/PriceTag'
import { Tag } from '../components/site/ui'
import { isDescriptionDoc, isDocEmpty, type AnyDescription } from '../cms/descriptionDoc'
import type { PublicProductData } from '../cms/productMerge'
import site from '../components/site/site.module.css'
import styles from './App.module.css'
import admin from './Admin.module.css'

type Viewport = 'desktop' | 'tablet' | 'mobile'
const WIDTH: Record<Viewport, number> = { desktop: 1100, tablet: 768, mobile: 390 }

function visibleDescription(description: AnyDescription | null): AnyDescription | null {
  if (isDescriptionDoc(description)) return isDocEmpty(description) ? null : description
  if (!description?.some((section) => Boolean(section.heading || section.paragraphs?.length || section.list?.length))) {
    return null
  }
  return description
}

function toProduct(preview: PublicProductFields & Partial<PublicProductData>, productId: string): Product {
  const base = productById(productId)
  const brandId = (preview.brandId as Product['brandId'] | undefined) || base?.brandId || 'halos'
  const category = (preview.category as Product['category'] | undefined) || base?.category || 'supplements'
  return {
    id: productId,
    slug: base?.slug ?? productId,
    brandId,
    name: preview.name || base?.name || productId,
    pack: preview.pack ?? base?.pack ?? null,
    category,
    form: base?.form ?? null,
    kind: base?.kind ?? 'goods',
    image: preview.image ?? base?.image ?? { src: '/products/catalog/placeholder.webp', width: 600, height: 600 },
    gallery: preview.gallery?.length ? preview.gallery : (base?.gallery ?? []),
    priceListId: base?.priceListId ?? null,
    price: preview.price ?? base?.price ?? null,
    description: preview.description ?? base?.description ?? null,
    documents: preview.documents ?? base?.documents,
    extras: preview.extras ?? base?.extras,
    tags: preview.tags ?? base?.tags,
    badges: preview.badges ?? base?.badges,
  }
}

export function ProductAdaptivePreview({ initData, productId }: { initData: string; productId: string }) {
  const [vp, setVp] = useState<Viewport>('desktop')
  const [data, setData] = useState<(PublicProductFields & Partial<PublicProductData>) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void productsApi
      .preview(initData, productId)
      .then((r) => {
        if (!alive) return
        setData(r.preview as PublicProductFields & Partial<PublicProductData>)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'preview_failed')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [initData, productId])

  const product = useMemo(() => (data ? toProduct(data, productId) : null), [data, productId])
  const description = product ? visibleDescription(product.description) : null
  const extras = product?.extras

  return (
    <div className={admin.fieldset} data-testid="product-adaptive-preview">
      <p className={admin.legend}>Предпросмотр черновика</p>
      <div className={styles.actionsRow} style={{ marginBottom: 8 }}>
        {(['desktop', 'tablet', 'mobile'] as Viewport[]).map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.btn} ${vp === v ? '' : styles.btnGhost}`}
            aria-pressed={vp === v}
            onClick={() => setVp(v)}
          >
            {v === 'desktop' ? 'Desktop' : v === 'tablet' ? 'Tablet' : 'Mobile'}
          </button>
        ))}
      </div>
      {loading ? <p className={styles.meta}>Загрузка…</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {product ? (
        <div
          style={{
            width: '100%',
            overflow: 'auto',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 8,
            background: 'var(--bg, #fff)',
          }}
        >
          <div style={{ width: WIDTH[vp], maxWidth: '100%', margin: '0 auto', padding: 12 }} data-viewport={vp}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <Tag>{brandName(product.brandId)}</Tag>
                <h1 className={site.h1}>{product.name}</h1>
                {product.pack ? <p className={site.lead}>{product.pack}</p> : null}
                <PriceTag price={product.price} size="page" />
              </div>
              <div className={site.gallery}>
                <img
                  src={product.image.src}
                  srcSet={product.image.srcSet}
                  width={product.image.width}
                  height={product.image.height}
                  alt={product.name}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            </div>
            {description ? <ProductDescriptionBlock description={description} /> : null}
            {extras?.blocks?.length ? <ProductExtraBlocks blocks={extras.blocks} /> : null}
            {extras?.videos?.length ? <ProductVideos videos={extras.videos} /> : null}
            <div style={{ marginTop: 16 }}>
              <p className={styles.meta}>Карточка каталога:</p>
              <ProductCard product={product} />
            </div>
            <p className={styles.meta} style={{ marginTop: 8 }}>
              Черновик · не опубликован · {vp} (~{WIDTH[vp]}px)
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
