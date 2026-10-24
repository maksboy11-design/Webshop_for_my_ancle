import { ReviewsBlock } from './reviews/ReviewsBlock'

export function ProductReviews({ productId }: { productId: string }) {
  return (
    <ReviewsBlock
      productId={productId}
      heading="Отзывы"
      headingId="product-reviews"
      level="h2"
      testId="product-reviews"
      embedded
    />
  )
}
