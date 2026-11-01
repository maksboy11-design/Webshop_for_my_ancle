import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgMediaStore } from '../max/mediaStore'
import { handleAdminMediaRequest, mediaLimitsFromEnv, sharpVariantEncoder, vercelMediaBlob } from '../max/mediaHttp'
import { isKnownProductId } from '../max/productOverrides'
import { pgContentUsage } from '../max/contentMediaRefs'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handleAdminMediaRequest(request, {
      ...adminAuthDeps(deps),
      media: url ? createPgMediaStore(sqlPoolFor(url)) : null,
      blob: deps.blobToken ? vercelMediaBlob(deps.blobToken) : null,
      encoder: sharpVariantEncoder(),
      log: deps.log,
      limits: mediaLimitsFromEnv(process.env),
      isProduct: isKnownProductId,
      contentUsage: url ? pgContentUsage(sqlPoolFor(url)) : null,
    })
  },
}
