import { productionDeps } from '../max/productionDeps'
import { handleMaxWebhook } from '../max/webhookHandler'

export default {
  async fetch(request: Request): Promise<Response> {
    return handleMaxWebhook(request, productionDeps())
  },
}
