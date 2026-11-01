import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgProductOverrideStore } from '../max/productOverrideStore'
import { createPgProductContentStore } from '../max/productContentStore'
import { handleAdminProductsRequest } from '../max/productsHttp'
import { sharpEncoder, vercelBlobPutter } from '../max/productImages'
import { createPgMediaStore } from '../max/mediaStore'
import { createPgActivityStore } from '../max/cmsActivityStore'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    const pool = url ? sqlPoolFor(url) : null
    return handleAdminProductsRequest(request, {
      ...adminAuthDeps(deps),
      overrides: pool ? createPgProductOverrideStore(pool) : null,
      log: deps.log,
      encoder: sharpEncoder(),
      putBlob: deps.blobToken ? vercelBlobPutter(deps.blobToken) : null,
      content: pool ? createPgProductContentStore(pool) : null,
      media: pool ? createPgMediaStore(pool) : null,
      activity: pool ? createPgActivityStore(pool) : null,
      sqlPool: pool,
    })
  },
}
