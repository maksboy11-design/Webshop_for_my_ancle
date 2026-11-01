import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyListToBlocks, validateDescriptionDoc, type DescriptionDoc, type DocBlock } from '../src/cms/descriptionDoc'
import { deleteSection, duplicateSection, headingFromSelection, moveSection, sectionRanges, splitInline } from '../src/cms/sections'
import { contentToDoc, docToContent } from '../src/cms/contentDoc'

const p = (text: string, autoBold = true): DocBlock => ({ type: 'paragraph', ...(autoBold ? {} : { attrs: { autoBold: false } }), content: [{ type: 'text', text }] })
const h = (text: string): DocBlock => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] })
const titles = (bs: DocBlock[]) => bs.map((b) => (b.type === 'heading' ? `#${b.content?.[0] && 'text' in b.content[0] ? b.content[0].text : ''}` : b.type))

test('заголовок секции: выделение внутри абзаца → [до, заголовок, после]', () => {
  const out = headingFromSelection({ type: 'paragraph', content: [{ type: 'text', text: 'Вступление Состав остальное', marks: [{ type: 'bold' }] }] }, 11, 17)
  assert.equal(out.length, 3)
  assert.equal(out[0]!.type, 'paragraph')
  assert.deepEqual(out[1], { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Состав' }] })
  assert.equal(out[2]!.type, 'paragraph')
})

test('заголовок секции: без выделения — переключатель абзац ⇄ заголовок, без разметки', () => {
  const [hd] = headingFromSelection({ type: 'paragraph', content: [{ type: 'text', text: 'Применение', marks: [{ type: 'bold' }] }] }, 0, 0)
  assert.deepEqual(hd, { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Применение' }] })
  const [back] = headingFromSelection(hd as never, 0, 0)
  assert.equal(back!.type, 'paragraph')
})

test('заголовок секции: выделение всего абзаца, мягкие переносы и пробелы', () => {
  const block = { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Раз' }, { type: 'hardBreak' as const }, { type: 'text' as const, text: ' Два ' }] }
  assert.deepEqual(splitInline(block.content, 4)[1], [{ type: 'text', text: ' Два ' }])
  const out = headingFromSelection(block, 4, 9)
  assert.deepEqual(titles(out), ['paragraph', '#Два'])
  assert.deepEqual(headingFromSelection(block, 3, 4), [block], 'пустое выделение (только перенос) — без изменений')
})

test('секции: диапазоны, перемещение, дублирование, удаление', () => {
  const doc = [p('intro'), h('A'), p('a1'), h('B'), p('b1'), p('b2')]
  assert.deepEqual(sectionRanges(doc).map((r) => [r.start, r.end, r.hasHeading]), [[0, 1, false], [1, 3, true], [3, 6, true]])
  assert.deepEqual(titles(moveSection(doc, 2, -1)), ['paragraph', '#B', 'paragraph', 'paragraph', '#A', 'paragraph'])
  assert.deepEqual(titles(moveSection(doc, 1, -1)), titles(doc), 'вводная без заголовка остаётся первой')
  assert.deepEqual(titles(moveSection(doc, 2, 1)), titles(doc))
  const dup = duplicateSection(doc, 1)
  assert.deepEqual(titles(dup), ['paragraph', '#A', 'paragraph', '#A', 'paragraph', '#B', 'paragraph', 'paragraph'])
  assert.notEqual(dup[1], dup[3], 'копия — отдельный объект')
  assert.deepEqual(titles(deleteSection(doc, 2)), ['paragraph', '#A', 'paragraph'])
  assert.deepEqual(deleteSection([h('A')], 0), [{ type: 'paragraph' }])
})

test('Автосписок/Нумерация идемпотентны и раздельны (сценарии A/B)', () => {
  const a = applyListToBlocks([p('- один'), p('• два')], 'bulletList')
  assert.equal(a.length, 1)
  assert.equal(a[0]!.type, 'bulletList')
  // Повтор на уже списке того же типа снимает список (а не создаёт вложенность/двойные маркеры).
  const back = applyListToBlocks(a, 'bulletList')
  assert.deepEqual(back.map((b) => b.type), ['paragraph', 'paragraph'])
  const again = applyListToBlocks(back, 'bulletList')
  assert.deepEqual(again, a, 'A→B→A даёт тот же результат')
  const ol = applyListToBlocks(a, 'orderedList')
  assert.equal(ol[0]!.type, 'orderedList')
  assert.equal((ol[0] as { content: unknown[] }).content.length, 2)
})

test('doc ⇄ контент v2: типы блоков, id сохраняются, нумерация в meta', () => {
  const doc: DescriptionDoc = {
    type: 'doc',
    version: 1,
    numbered: true,
    content: [
      p('Вступление'),
      h('Состав'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { autoBold: false }, content: [{ type: 'text', text: 'вода' }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { autoBold: false }, content: [{ type: 'text', text: 'шаг' }] }] }] },
    ],
  }
  const c1 = docToContent(doc)
  assert.equal(c1.schema_version, 2)
  assert.deepEqual(c1.blocks.map((b) => b.type), ['text', 'section_heading', 'bullet_list', 'ordered_list'])
  assert.equal(c1.meta.numberSections, true)
  const back = contentToDoc(JSON.parse(JSON.stringify(c1)))
  assert.ok(back)
  const v = validateDescriptionDoc(doc)
  assert.ok(v.ok)
  assert.deepEqual(back, v.value)
  // Пересохранение: id тех же позиций/типов не меняются; новый блок — новый id.
  const c2 = docToContent({ ...doc, numbered: false, content: [...doc.content, p('Ещё')] }, c1)
  assert.deepEqual(c2.blocks.slice(0, 4).map((b) => b.id), c1.blocks.map((b) => b.id))
  assert.ok(!c1.blocks.some((b) => b.id === c2.blocks[4]!.id))
  assert.equal(c2.meta.numberSections, undefined)
  assert.equal(new Set(c2.blocks.map((b) => b.id)).size, 5)
})

test('contentToDoc: пусто/битое/неактивное → null или пропуск', () => {
  assert.equal(contentToDoc(null), null)
  assert.equal(contentToDoc({ schema_version: 2, meta: {}, blocks: [] }), null)
  const c = docToContent({ type: 'doc', version: 1, content: [p('a'), p('b')] })
  c.blocks[0]!.active = false
  assert.equal(contentToDoc(c)!.content.length, 1)
  assert.equal(contentToDoc({ schema_version: 2, meta: {}, blocks: [{ id: 'x', type: 'text', order: 0, content: { inline: [{ type: 'text', text: '<b>' , marks: [{ type: 'link' }] }] } }] }), null)
})
