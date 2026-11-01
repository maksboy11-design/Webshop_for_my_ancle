import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgPagesStore } from '../max/pagesStore'
import { handlePublicPagesRequest } from '../max/pagesHttp'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handlePublicPagesRequest(request, { pages: url ? createPgPagesStore(sqlPoolFor(url)) : null, log: deps.log })
  },
}
