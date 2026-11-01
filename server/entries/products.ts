import { productionDeps, productionEntryStore, sqlPoolFor } from '../max/productionDeps'
import { createPgProductOverrideStore } from '../max/productOverrideStore'
import { createPgProductContentStore } from '../max/productContentStore'
import { handlePublicProductsRequest } from '../max/productsHttp'
import { createPgMediaStore } from '../max/mediaStore'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handlePublicProductsRequest(request, {
      overrides: url ? createPgProductOverrideStore(sqlPoolFor(url)) : null,
      log: deps.log,
      entries: productionEntryStore(),
      content: url ? createPgProductContentStore(sqlPoolFor(url)) : null,
      media: url ? createPgMediaStore(sqlPoolFor(url)) : null,
    })
  },
}
