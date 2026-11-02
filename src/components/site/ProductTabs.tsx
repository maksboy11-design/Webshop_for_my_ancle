/**
 * Вкладки на странице товара (настраиваются в мини-приложении: «Вкладки на странице товара»).
 * Вкладка = блоки и видео с её tab + (по флагу) отзывы только об этом товаре. Пустые вкладки скрыты.
 */
import { useId, useState } from 'react'
import type { ProductTab, PublicExtraBlock, VideoItem } from '../../cms/richBlocks'
import { ProductExtraBlocks, ProductExtraButtons, ProductVideos } from './ProductExtras'
import { ReviewsCarousel } from './reviews/ReviewsCarousel'
import { usePublishedReviews } from './reviews/usePublishedReviews'
import styles from './site.module.css'

export function ProductTabs({
  productId,
  tabs,
  blocks,
  videos,
}: {
  productId: string
  tabs: readonly ProductTab[]
  blocks: readonly PublicExtraBlock[]
  videos: readonly VideoItem[]
}) {
  const wantsReviews = tabs.some((t) => t.reviews)
  const { phase, reviews } = usePublishedReviews(productId)
  const hasReviews = wantsReviews && phase === 'ready' && reviews.length > 0
  const visible = tabs
    .map((t) => ({
      tab: t,
      blocks: blocks.filter((b) => b.tab === t.id),
      videos: videos.filter((v) => v.tab === t.id),
      reviews: t.reviews && hasReviews,
    }))
    .filter((x) => x.blocks.length || x.videos.length || x.reviews)
  const [active, setActive] = useState<string | null>(null)
  const base = useId()
  if (!visible.length) return null
  const cur = visible.find((x) => x.tab.id === active) ?? visible[0]!
  return (
    <section className={styles.section} data-testid="product-tabs">
      <div className={styles.productTabs} role="tablist" aria-label="Разделы о товаре">
        {visible.map((x) => (
          <button
            key={x.tab.id}
            type="button"
            role="tab"
            id={`${base}-t-${x.tab.id}`}
            aria-selected={x === cur}
            aria-controls={`${base}-p-${x.tab.id}`}
            className={styles.productTab}
            onClick={() => setActive(x.tab.id)}
          >
            {x.tab.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-p-${cur.tab.id}`} aria-labelledby={`${base}-t-${cur.tab.id}`}>
        {cur.blocks.length ? <ProductExtraBlocks blocks={cur.blocks} /> : null}
        {cur.blocks.length ? <ProductExtraButtons blocks={cur.blocks} /> : null}
        {cur.videos.length ? <ProductVideos videos={cur.videos} /> : null}
        {cur.reviews ? <ReviewsCarousel reviews={reviews} /> : null}
      </div>
    </section>
  )
}
