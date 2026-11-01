import { productionDeps, productionEntryStore } from '../max/productionDeps'
import { handleAdminEntriesRequest } from '../max/adminEntriesHttp'
import { adminAuthDeps } from './adminAuthDeps'

export default {
  async fetch(request: Request): Promise<Response> {
    const deps = productionDeps()
    return handleAdminEntriesRequest(request, { ...adminAuthDeps(deps), entries: productionEntryStore(), log: deps.log })
  },
}
