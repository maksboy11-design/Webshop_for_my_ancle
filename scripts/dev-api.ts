/**
 * Локальный приём /api без Vercel и без постоянной базы.
 * Память очищается при остановке процесса. В production не используется.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readChatIds, readModeratorIds, secretIsValid } from '../server/max/config'
import { createLogger } from '../server/max/logger'
import { createMemoryStore } from '../server/max/memoryStore'
import type { MaxClient } from '../server/max/maxClient'
import { handleReviewsRequest } from '../server/max/reviewsHttp'
import { handleWebinarsRequest } from '../server/max/webinarsHttp'
import { handleMaxWebhook } from '../server/max/webhookHandler'

if (process.env.VERCEL) {
  console.error('dev-api is local only')
  process.exit(1)
}

const secret = process.env.MAX_WEBHOOK_SECRET ?? ''
if (!secretIsValid(secret)) {
  console.error('Set MAX_WEBHOOK_SECRET to a local value of 5–256 characters [A-Za-z0-9_-]. The value is not printed.')
  process.exit(1)
}

const moderators = readModeratorIds(process.env.MAX_REVIEW_MODERATOR_IDS)
const chats = readChatIds(process.env.MAX_ALLOWED_CHAT_IDS)
const store = createMemoryStore()
const max: MaxClient = {
  async sendMessage() {},
  async answerCallback() {},
  async getMessage() {
    return null
  },
}
const deps = {
  secret,
  secretConfigured: true,
  moderators: moderators.ok ? moderators.ids : new Set<string>(),
  moderatorsConfigured: moderators.ok,
  allowedChatIds: chats.ok ? chats.ids : new Set<string>(),
  allowedChatsConfigured: chats.ok,
  store,
  max,
  now: () => new Date(),
  sleep: async () => {},
  log: createLogger(),
  rateLimit: { max: 20, windowMs: 10 * 60 * 1000 },
  groupRateLimit: { max: 60, windowMs: 10 * 60 * 1000 },
  sessionTtlMs: 30 * 60 * 1000,
  deliveryBudgetMs: 8_000,
  blobToken: process.env.BLOB_READ_WRITE_TOKEN?.trim() || null,
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || null,
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 256 * 1024) {
      const error = new Error('too_large')
      throw error
    }
    chunks.push(buffer)
  }
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const body = Buffer.concat(chunks)
  const host = req.headers.host ?? '127.0.0.1:3001'
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
  })
}

async function write(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

const port = Number(process.env.MAX_DEV_API_PORT ?? 3001)
const server = createServer(async (req, res) => {
  try {
    const request = await toRequest(req)
    const path = new URL(request.url).pathname
    if (path === '/api/max/webhook') {
      await write(res, await handleMaxWebhook(request, deps))
      return
    }
    if (path === '/api/reviews') {
      await write(res, await handleReviewsRequest(request, deps))
      return
    }
    if (path === '/api/webinars') {
      await write(res, await handleWebinarsRequest(request, deps))
      return
    }
    await write(res, new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too_large'
    res.statusCode = tooLarge ? 413 : 500
    res.end(JSON.stringify({ error: tooLarge ? 'payload_too_large' : 'unavailable' }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.info(`local memory api 127.0.0.1:${port}`)
})
