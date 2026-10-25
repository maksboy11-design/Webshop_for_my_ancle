import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entries = [
  ['server/entries/reviews.ts', 'api/reviews.js'],
  ['server/entries/webhook.ts', 'api/max/webhook.js'],
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
    external: ['pg'],
    legalComments: 'none',
    // ESM-бандл с CJS-зависимостями (@vercel/blob -> @vercel/oidc -> jose) требует рабочий require.
    // Без этого функция падает при загрузке: Dynamic require of "node:buffer" is not supported.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  })
}

const { rename } = await import('node:fs/promises')
for (const [, output] of entries) {
  await rename(join(temp, output), join(root, output))
}
await rm(temp, { recursive: true, force: true })
