// Регистрирует меню команд бота MAX (PATCH /me/commands).
// Токен берётся только из переменной окружения MAX_BOT_TOKEN вашей сессии и нигде не печатается.
//   PowerShell:  $env:MAX_BOT_TOKEN = '...'; node scripts/max-set-commands.mjs [--with-moderation] [--dry-run] [--clear]
// Меню команд общее для всех пользователей бота: команды модератора в нём увидят все,
// хотя выполнит их только пользователь из MAX_REVIEW_MODERATOR_IDS. Поэтому по умолчанию они не добавляются.
import { readFileSync } from 'node:fs'
import https from 'node:https'
import { getCACertificates } from 'node:tls'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API_ORIGIN = 'https://platform-api2.max.ru'

export const BASE_COMMANDS = [
  { name: 'start', description: 'Начать работу с ботом' },
  { name: 'review', description: 'Оставить отзыв о товаре' },
  { name: 'cancel', description: 'Отменить текущий отзыв' },
  { name: 'whoami', description: 'Показать мой MAX user_id' },
  { name: 'help', description: 'Справка' },
]

export const MODERATION_COMMANDS = [
  { name: 'menu', description: 'Меню модератора' },
  { name: 'reviews_pending', description: 'Очередь отзывов на модерации' },
  { name: 'content_pending', description: 'Прочие сообщения группы' },
]

export function buildCommands(flags) {
  if (flags.has('--clear')) return []
  return flags.has('--with-moderation') ? [...BASE_COMMANDS, ...MODERATION_COMMANDS] : [...BASE_COMMANDS]
}

export async function setCommands({ token, commands, request }) {
  if (!token) throw new Error('Не задана переменная окружения MAX_BOT_TOKEN.')
  const body = JSON.stringify({ commands })
  const response = await request({
    method: 'PATCH',
    url: `${API_ORIGIN}/me/commands`,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body,
  })
  return response.status
}

function rootCa() {
  const here = dirname(fileURLToPath(import.meta.url))
  const pem = readFileSync(join(here, '..', 'server', 'max', 'russian_trusted_root_ca.pem'), 'utf8')
  return [...getCACertificates(), pem]
}

function httpsRequest({ method, url, headers, body }) {
  const target = new URL(url)
  const ca = rootCa()
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method,
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        ca,
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function main() {
  const flags = new Set(process.argv.slice(2))
  const commands = buildCommands(flags)
  const names = commands.map((c) => `/${c.name}`).join(' ') || '(пусто — меню будет очищено)'
  if (flags.has('--dry-run')) {
    console.log(`Dry run, ничего не отправлено. Команды: ${names}`)
    return
  }
  const status = await setCommands({ token: process.env.MAX_BOT_TOKEN, commands, request: httpsRequest })
  if (status >= 200 && status < 300) console.log(`Готово (HTTP ${status}). Команды: ${names}`)
  else {
    console.error(`MAX ответил HTTP ${status}. Меню не изменено.`)
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error && error.message.includes('MAX_BOT_TOKEN') ? error.message : 'Не удалось выполнить запрос к MAX.')
    process.exitCode = 1
  })
}
