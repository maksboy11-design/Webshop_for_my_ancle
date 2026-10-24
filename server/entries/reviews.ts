import { productionDeps } from '../max/productionDeps'
import { handleReviewsRequest } from '../max/reviewsHttp'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    return handleReviewsRequest(request, { store: deps.store, log: deps.log })
  },
}
