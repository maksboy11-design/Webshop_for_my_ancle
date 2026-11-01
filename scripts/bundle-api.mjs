import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entries = [
  ['server/entries/reviews.ts', 'api/reviews.js'],
  ['server/entries/webhook.ts', 'api/max/webhook.js'],
  ['server/entries/webinars.ts', 'api/webinars.js'],
  ['server/entries/adminReviews.ts', 'api/admin/reviews.js'],
  ['server/entries/products.ts', 'api/products.js'],
  ['server/entries/adminProducts.ts', 'api/admin/products.js'],
  ['server/entries/adminWebinars.ts', 'api/admin/webinars.js'],
  ['server/entries/adminEntries.ts', 'api/admin/entries.js'],
  ['server/entries/adminMedia.ts', 'api/admin/media.js'],
]
const temp = join(root, '.api-bundle')
await rm(temp, { recursive: true, force: true })

for (const [entry, output] of entries) {
  const outfile = join(temp, output)
  await mkdir(dirname(outfile), { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile,
    external: ['pg', 'sharp'],
    legalComments: 'none',
    // ESM-бандл с CJS-зависимостями (@vercel/blob -> @vercel/oidc -> jose) требует рабочий require.
    // Без этого функция падает при загрузке: Dynamic require of "node:buffer" is not supported.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  })
}

// --check: собрать во временную папку и сравнить с закоммиченными api/*.js, ничего не перезаписывая.
if (process.argv.includes('--check')) {
  const { readFile } = await import('node:fs/promises')
  const stale = []
  for (const [, output] of entries) {
    const fresh = await readFile(join(temp, output), 'utf8')
    const current = await readFile(join(root, output), 'utf8').catch(() => '')
    if (fresh !== current) stale.push(output)
  }
  await rm(temp, { recursive: true, force: true })
  if (stale.length) {
    console.error('Устаревшие бандлы (запустите npm run bundle:api): ' + stale.join(', '))
    process.exit(1)
  }
  console.log('api bundles up to date')
  process.exit(0)
}

const { rename } = await import('node:fs/promises')
for (const [, output] of entries) {
  const dest = join(root, output)
  await mkdir(dirname(dest), { recursive: true })
  await rename(join(temp, output), dest)
}
await rm(temp, { recursive: true, force: true })
