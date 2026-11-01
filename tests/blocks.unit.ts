import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupSections, readProductContent, shouldShowVideos, visibleBlocks } from '../src/cms/blocks'
import { PRODUCTS, SLUG_ALIASES, productBySlug, productById } from '../src/data/products'

test('legacy/невалидный контент → null (fallback на старое хранилище)', () => {
  assert.equal(readProductContent(null), null)
  assert.equal(readProductContent({ type: 'doc', version: 1, content: [] }), null)
  assert.equal(readProductContent({ schema_version: 1, blocks: [] }), null)
})

test('неизвестные/дублирующиеся блоки пропускаются, порядок по order', () => {
  const c = readProductContent({
    schema_version: 2,
    meta: {},
    blocks: [
      { id: 'b', type: 'text', order: 2, content: {} },
      { id: 'a', type: 'section_heading', order: 1, content: { text: 'A' } },
      { id: 'x', type: 'future_type', order: 0 },
      { id: 'a', type: 'text', order: 3 },
      { id: 'c', type: 'text', order: 4, active: false },
    ],
  })!
  assert.deepEqual(c.blocks.map((b) => b.id), ['a', 'b', 'c'])
  assert.deepEqual(visibleBlocks(c).map((b) => b.id), ['a', 'b'])
  const s = groupSections(visibleBlocks(c))
  assert.equal(s.length, 1)
  assert.equal(s[0].heading?.id, 'a')
})

test('видео: выключено / пусто / есть', () => {
  const base = { schema_version: 2, blocks: [{ id: 'v', type: 'video', order: 0, content: { items: [] } }] }
  assert.equal(shouldShowVideos(readProductContent({ ...base, meta: { showVideos: false } })!), false)
  assert.equal(shouldShowVideos(readProductContent({ ...base, meta: { showVideos: true } })!), false)
  const full = { ...base, meta: { showVideos: true } }
  full.blocks[0].content.items = [{ src: 'https://x.blob.vercel-storage.com/a.mp4' }] as never
  assert.equal(shouldShowVideos(readProductContent(full)!), true)
})

test('ЭРА БОТАНИКА: старые slug открывают тот же товар, id не изменились', () => {
  const expect: Record<string, string> = {
    'era-gel': 'era-gel',
    'era-lotion': 'era-lotion',
    'era-essence': 'era-essence',
    'era-face-oil': 'era-oil',
    'era-foam': 'era-foam',
  }
  for (const [old, id] of Object.entries(expect)) {
    assert.equal(productBySlug(old)?.id, id, old)
    assert.equal(productBySlug(SLUG_ALIASES[old])?.id, id)
  }
  assert.match(productById('era-gel')!.name, /молочко/)
  const slugs = PRODUCTS.map((p) => p.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  for (const old of Object.keys(SLUG_ALIASES)) assert.ok(!slugs.includes(old))
})
