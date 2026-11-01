import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgProductOverrideStore } from '../max/productOverrideStore'
import { createPgProductContentStore } from '../max/productContentStore'
import { handleAdminProductsRequest } from '../max/productsHttp'
import { sharpEncoder, vercelBlobPutter } from '../max/productImages'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handleAdminProductsRequest(request, {
      ...adminAuthDeps(deps),
      overrides: url ? createPgProductOverrideStore(sqlPoolFor(url)) : null,
      log: deps.log,
      encoder: sharpEncoder(),
      putBlob: deps.blobToken ? vercelBlobPutter(deps.blobToken) : null,
      content: url ? createPgProductContentStore(sqlPoolFor(url)) : null,
    })
  },
}
