import { productionDeps } from '../max/productionDeps'
import { handleAdminReviewsRequest } from '../max/adminReviewsHttp'
import { tokenIsValid } from '../max/config'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const token = process.env.MAX_BOT_TOKEN?.trim() ?? ''
    return handleAdminReviewsRequest(request, {
      store: deps.store,
      log: deps.log,
      botToken: tokenIsValid(token) ? token : null,
      moderators: deps.moderators,
      moderatorsConfigured: deps.moderatorsConfigured,
      now: deps.now,
    })
  },
}
