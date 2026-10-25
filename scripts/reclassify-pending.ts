/*
 * Однократная переклассификация ожидающих записей группы MAX.
 * Для записей pending с kind text/mixed/image/video заново применяется текущий классификатор
 * (маркер «Отзыв» с эмодзи/разметкой). Подходящие становятся kind='review', чтобы попасть в /reviews_pending.
 * Ничего не публикуется. Идемпотентно. Текст сообщений не выводится.
 *
 * Запуск (по умолчанию dry-run):
 *   npx tsx --env-file=.env.local scripts/reclassify-pending.ts
 *   npx tsx --env-file=.env.local scripts/reclassify-pending.ts --apply
 */
import pg from 'pg'
import { classifyMessage } from '../server/max/classify'
import type { StoredAttachment } from '../server/max/attachments'

const apply = process.argv.includes('--apply')
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim()
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('BEGIN')
  const rows = await client.query<{ id: string; kind: string; body_text: string | null; attachments: unknown }>(
    `SELECT id::text, kind, body_text, attachments
     FROM incoming_content
     WHERE status = 'pending' AND kind IN ('text', 'mixed', 'image', 'video')
     FOR UPDATE`,
  )
  const byKind: Record<string, number> = {}
  const matches: { id: string; publicText: string | null }[] = []
  for (const row of rows.rows) {
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1
    const attachments = Array.isArray(row.attachments) ? (row.attachments as StoredAttachment[]) : []
    const result = classifyMessage(row.body_text, attachments)
    if (result.kind === 'review') matches.push({ id: row.id, publicText: result.publicText })
  }
  console.log(`pending, не review: ${rows.rowCount} ${JSON.stringify(byKind)}`)
  console.log(`станут review: ${matches.length}`, matches.map((item) => item.id.slice(0, 8)).join(' '))
  if (!apply) {
    await client.query('ROLLBACK')
    console.log('dry-run: изменений нет. Для применения добавьте --apply')
  } else {
    let changed = 0
    for (const item of matches) {
      const update = await client.query(
        `UPDATE incoming_content
         SET kind = 'review', public_text = $2
         WHERE id = $1::uuid AND status = 'pending' AND kind IN ('text', 'mixed', 'image', 'video')`,
        [item.id, item.publicText],
      )
      changed += update.rowCount ?? 0
    }
    await client.query('COMMIT')
    console.log(`обновлено: ${changed}`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error('reclassify failed:', error instanceof Error ? error.name : 'error')
  process.exitCode = 1
} finally {
  await client.end()
}