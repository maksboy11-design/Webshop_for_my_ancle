import { productionDeps } from '../max/productionDeps'
import { handleAdminWebinarsRequest } from '../max/adminWebinarsHttp'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    return handleAdminWebinarsRequest(request, {
      ...adminAuthDeps(deps),
      store: deps.store,
      log: deps.log,
      youtube: { apiKey: deps.youtubeApiKey ?? null },
    })
  },
}
