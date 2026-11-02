import { productionDeps, sqlPoolFor } from '../max/productionDeps'
import { createPgPagesStore } from '../max/pagesStore'
import { createPgMediaStore } from '../max/mediaStore'
import { createPgClipboardStore } from '../max/clipboardStore'
import { handleAdminPagesRequest } from '../max/pagesHttp'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    const url = process.env.DATABASE_URL?.trim() ?? ''
    return handleAdminPagesRequest(request, {
      ...adminAuthDeps(deps),
      pages: url ? createPgPagesStore(sqlPoolFor(url)) : null,
      media: url ? createPgMediaStore(sqlPoolFor(url)) : null,
      clipboard: url ? createPgClipboardStore(sqlPoolFor(url)) : null,
      log: deps.log,
    })
  },
}
