import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'db', 'migrations')

function safeMessage(error) {
  const message = error instanceof Error ? error.message : 'migration failed'
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
}

function statementsOf(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter(Boolean)
}

async function listVersions() {
  const names = await readdir(dir)
  return names
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => name.slice(0, -'.up.sql'.length))
    .sort()
}

const command = process.argv[2]
if (command !== 'up' && command !== 'down') {
  console.error('Usage: node scripts/db-migrate.mjs up|down')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. The migration was not applied.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })

try {
  await client.connect()
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  )
  const appliedResult = await client.query('SELECT version FROM schema_migrations')
  const applied = appliedResult.rows.map((row) => String(row.version)).sort()
  if (command === 'up') {
    const pending = (await listVersions()).filter((version) => !applied.includes(version))
    if (pending.length === 0) {
      console.log('No pending migrations.')
    }
    for (const version of pending) {
      const sql = await readFile(join(dir, `${version}.up.sql`), 'utf8')
      await client.query('BEGIN')
      try {
        for (const statement of statementsOf(sql)) await client.query(statement)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
        console.log(`Applied ${version}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } else {
    const latest = applied.at(-1)
    if (!latest) {
      console.log('Nothing to roll back.')
    } else {
      const sql = await readFile(join(dir, `${latest}.down.sql`), 'utf8')
      await client.query('BEGIN')
      try {
        for (const statement of statementsOf(sql)) await client.query(statement)
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [latest])
        await client.query('COMMIT')
        console.log(`Rolled back ${latest}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  }
} catch (error) {
  console.error(safeMessage(error))
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
