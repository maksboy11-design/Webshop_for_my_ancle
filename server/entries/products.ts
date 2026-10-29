import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgProductOverrideStore } from '../max/productOverrideStore'
import { handlePublicProductsRequest } from '../max/productsHttp'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handlePublicProductsRequest(request, {
      overrides: url ? createPgProductOverrideStore(sqlPoolFor(url)) : null,
      log: deps.log,
    })
  },
}
