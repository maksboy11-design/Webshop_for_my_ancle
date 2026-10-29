import { tokenIsValid } from '../max/config'
import type { AdminAuthDeps } from '../max/adminAuth'
import type { HandlerDeps } from '../max/webhookHandler'

export function adminAuthDeps(deps: HandlerDeps): AdminAuthDeps {
  const token = process.env.MAX_BOT_TOKEN?.trim() ?? ''
  return {
    botToken: tokenIsValid(token) ? token : null,
    moderators: deps.moderators,
    moderatorsConfigured: deps.moderatorsConfigured,
    now: deps.now,
  }
}
