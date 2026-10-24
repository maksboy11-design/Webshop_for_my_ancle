import { productionDeps } from '../../server/max/productionDeps'
import { handleMaxWebhook } from '../../server/max/webhookHandler'

export default {
  async fetch(request: Request): Promise<Response> {
    return handleMaxWebhook(request, productionDeps())
  },
}
