import { useEffect, useState } from 'react'
import { cmsClient } from '../../../cms/staticAdapter'
import type { Review } from '../../../cms/types'

export type ReviewsPhase = 'loading' | 'empty' | 'error' | 'ready'

function isPublishable(review: Review): boolean {
  const text = review.text?.trim() ?? ''
  return text.length > 0 || (review.media?.length ?? 0) > 0
}

export function usePublishedReviews(productId?: string) {
  const [state, setState] = useState<{ productId: string | undefined; phase: ReviewsPhase; reviews: Review[] }>({
    productId: undefined,
    phase: 'loading',
    reviews: [],
  })

  useEffect(() => {
    let cancelled = false
    cmsClient
      .listReviews(productId ? { productId } : undefined)
      .then((items) => {
        if (cancelled) return
        const reviews = items.filter((item) => (productId ? item.productId === productId : true) && isPublishable(item))
        setState({ productId, phase: reviews.length === 0 ? 'empty' : 'ready', reviews })
      })
      .catch(() => {
        if (!cancelled) setState({ productId, phase: 'error', reviews: [] })
      })
    return () => {
      cancelled = true
    }
  }, [productId])

  if (state.productId !== productId) return { phase: 'loading' as const, reviews: [] as Review[] }
  return { phase: state.phase, reviews: state.reviews }
}
