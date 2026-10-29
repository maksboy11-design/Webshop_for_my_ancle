import { productionDeps } from '../max/productionDeps'
import { handleWebinarsRequest } from '../max/webinarsHttp'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    return handleWebinarsRequest(request, { store: deps.store, log: deps.log })
  },
}
