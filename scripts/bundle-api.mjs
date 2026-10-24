import { build } from 'esbuild'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.VERCEL !== '1') process.exit(0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entries = [
  ['api/reviews.ts', 'api/reviews.js'],
  ['api/max/webhook.ts', 'api/max/webhook.js'],
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
  })
}

for (const [entry, output] of entries) {
  await rename(join(root, entry), join(root, `${entry}.source`))
  await rename(join(temp, output), join(root, output))
}

await rm(temp, { recursive: true, force: true })
