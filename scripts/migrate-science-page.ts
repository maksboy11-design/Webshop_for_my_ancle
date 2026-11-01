/**
 * Перенос страницы «Научные факты» в раздел «Страницы».
 *
 *   npx tsx scripts/migrate-science-page.ts --dry-run [--out DIR]   — только JSON и отчёт, база не трогается (по умолчанию)
 *   DATABASE_URL=… npx tsx scripts/migrate-science-page.ts --apply  — запись в базу (ТОЛЬКО с разрешения владельца, после миграции 010)
 *
 * --apply создаёт страницу slug=science черновиком и публикует её одним действием; если страница с этим слагом
 * уже есть — ничего не меняет (идемпотентно). Ничего не удаляет. Пока страница не опубликована, сайт
 * показывает «Научные факты» из исходников.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkPageDoc, externalUrls } from '../src/cms/pageDoc'
import { pageTexts, scienceSourceTexts, scienceToPage } from '../src/cms/scienceToPage'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? args[outIdx + 1]! : '/workspace/wb-audit'

const page = scienceToPage()
const checked = await checkPageDoc(page.doc, async () => ({ ok: false, error: 'no_media_expected' }), {
  allowedExternal: externalUrls(page.doc),
})
if (!checked.ok) throw new Error(`invalid doc: ${checked.error} ${checked.field ?? ''}`)
const src = scienceSourceTexts()
const got = pageTexts(page.title, checked.value)
const same = src.length === got.length && src.every((t, i) => t === got[i])
const counts = {
  blocks: checked.value.blocks.length,
  headings: checked.value.blocks.filter((b) => b.type === 'heading').length,
  textBlocks: checked.value.blocks.filter((b) => b.type === 'text').length,
  buttons: checked.value.blocks.filter((b) => b.type === 'button').length,
  lists: checked.value.blocks.reduce(
    (n, b) => n + (b.type === 'text' ? b.doc.content.filter((x) => x.type === 'bulletList').length : 0),
    0,
  ),
  sourceTexts: src.length,
  chars: src.join('').length,
}

await mkdir(outDir, { recursive: true })
await writeFile(
  join(outDir, 'science-page.dry-run.json'),
  JSON.stringify({ title: page.title, slug: page.slug, doc: checked.value }, null, 2),
)
const report = [
  '# Перенос «Научные факты» → раздел «Страницы» (dry-run)',
  '',
  `- Адрес: #science (slug \`${page.slug}\`), ссылка Hero не меняется.`,
  `- Текст источника совпадает дословно и в том же порядке: ${same ? 'ДА' : 'НЕТ'} (${counts.sourceTexts} фрагментов, ${counts.chars} символов).`,
  `- Блоков: ${counts.blocks} (заголовков разделов ${counts.headings}, текстовых карточек ${counts.textBlocks}, кнопок ${counts.buttons}); списков: ${counts.lists}.`,
  '- Внешняя ссылка на статью сохранена как кнопка (в редакторе — только для чтения цели).',
  '- База данных не изменялась. Запись — `--apply`, только после миграции 010 и с разрешения владельца.',
  '',
].join('\n')
await writeFile(join(outDir, 'science-page.dry-run.md'), report)
console.log(report)
if (!same) process.exitCode = 1

if (apply) {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('DATABASE_URL is required for --apply')
  const { sqlPoolFor } = await import('../server/max/productionDeps')
  const { createPgPagesStore } = await import('../server/max/pagesStore')
  const store = createPgPagesStore(sqlPoolFor(url))
  const existing = await store.getBySlug(page.slug)
  if (existing) console.log(`page '${page.slug}' already exists (${existing.status}); nothing changed`)
  else {
    const nowIso = new Date().toISOString()
    const r = await store.create({ id: randomUUID(), title: page.title, slug: page.slug, draft: checked.value, userId: '0', nowIso })
    if (!r.ok) throw new Error(`create failed: ${r.error}`)
    const p = await store.publish(r.value.id, '0', nowIso)
    console.log(p.ok ? `created and published ${r.value.id}` : `publish failed: ${p.error}`)
  }
}
