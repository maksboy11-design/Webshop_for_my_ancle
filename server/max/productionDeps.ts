import { Pool } from 'pg'
import { readChatIds, readModeratorIds, secretIsValid, tokenIsValid } from './config'
import { createLogger } from './logger'
import { createMaxClient } from './maxClient'
import { createPostgresStore } from './postgresStore'
import { readMiniAppOpenConfig } from './miniAppOpen'
import type { HandlerDeps } from './webhookHandler'

let pool: Pool | undefined
let poolUrl: string | undefined

function storeFor(databaseUrl: string) {
  if (!pool || poolUrl !== databaseUrl) {
    pool?.end().catch(() => undefined)
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
    })
    poolUrl = databaseUrl
  }
  const active = pool
  return createPostgresStore({
    async connect() {
      const client = await active.connect()
      return {
        query: (text, values) => client.query(text, values as never[]),
        release: () => client.release(),
      }
    },
  })
}

export function productionDeps(env: NodeJS.ProcessEnv = process.env): HandlerDeps {
  const secret = env.MAX_WEBHOOK_SECRET ?? ''
  const secretConfigured = secretIsValid(secret)
  const token = env.MAX_BOT_TOKEN?.trim() ?? ''
  const tokenConfigured = tokenIsValid(token)
  const moderators = readModeratorIds(env.MAX_REVIEW_MODERATOR_IDS)
  const chats = readChatIds(env.MAX_ALLOWED_CHAT_IDS)
  const databaseUrl = env.DATABASE_URL?.trim() ?? ''
  const blobToken = env.BLOB_READ_WRITE_TOKEN?.trim() || null
  return {
    secret: secretConfigured ? secret : null,
    secretConfigured,
    moderators: moderators.ok ? moderators.ids : new Set<string>(),
    moderatorsConfigured: moderators.ok,
    allowedChatIds: chats.ok ? chats.ids : new Set<string>(),
    allowedChatsConfigured: chats.ok,
    store: databaseUrl ? storeFor(databaseUrl) : null,
    max: tokenConfigured ? createMaxClient(token) : null,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: createLogger(),
    rateLimit: { max: 20, windowMs: 10 * 60 * 1000 },
    groupRateLimit: { max: 60, windowMs: 10 * 60 * 1000 },
    sessionTtlMs: 30 * 60 * 1000,
    deliveryBudgetMs: 8_000,
    blobToken,
    youtubeApiKey: env.YOUTUBE_API_KEY?.trim() || null,
    miniApp: readMiniAppOpenConfig(env),
  }
}
