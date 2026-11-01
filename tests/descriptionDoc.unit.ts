import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyListToBlocks,
  autoBoldDoc,
  canonicalDoc,
  checkDocLimits,
  currentBlockRange,
  docCharCount,
  docToPlainText,
  DOC_TEXT_MAX,
  isDescriptionDoc,
  legacyToDoc,
  textToBlocks,
  toEditableDoc,
  validateDescriptionDoc,
  type DescriptionDoc,
  type DocBlock,
} from '../src/cms/descriptionDoc'
import { applyProductPatch } from '../server/max/productOverrides'
import { buildSet, initialState } from '../src/admin-reviews/productFormModel'
import { PRODUCTS } from '../src/data/products'
import { toPublicProductData } from '../src/cms/productMerge'

const p = (text: string, autoBold?: boolean): DocBlock => ({
  type: 'paragraph',
  ...(autoBold === false ? { attrs: { autoBold: false } } : {}),
  content: text ? [{ type: 'text', text }] : [],
})
const doc = (...content: DocBlock[]): DescriptionDoc => ({ type: 'doc', version: 1, content })

describe('descriptionDoc: автожирный', () => {
  it('каждый абзац верхнего уровня жирный, пункты списков — нет', () => {
    const d = autoBoldDoc(doc(p('Первый'), p('Второй'), ...applyListToBlocks([p('a'), p('b')], 'bulletList')))
    assert.deepEqual(d.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Первый', marks: [{ type: 'bold' }] }] })
    assert.deepEqual((d.content[1] as { content: { marks?: unknown }[] }).content[0]!.marks, [{ type: 'bold' }])
    const list = d.content[2] as { type: string; content: { content: { content: { marks?: unknown }[] }[] }[] }
    assert.equal(list.type, 'bulletList')
    assert.equal(list.content[0]!.content[0]!.content[0]!.marks, undefined)
  })
  it('абзац с autoBold:false не становится жирным (ручное снятие B)', () => {
    const d = autoBoldDoc(doc(p('обычный', false)))
    assert.equal((d.content[0] as { content: { marks?: unknown }[] }).content[0]!.marks, undefined)
  })
  it('повторное применение идемпотентно', () => {
    const once = autoBoldDoc(doc(p('x'), p('y')))
    assert.deepEqual(autoBoldDoc(once), once)
  })
})

describe('descriptionDoc: Автосписок и Нумерация', () => {
  it('строки → пункты, маркеры и жирный убираются, пустые строки пропускаются', () => {
    const r = applyListToBlocks([p('- один'), p(''), p('2) два')], 'bulletList')
    assert.equal(r.length, 1)
    const list = r[0] as { type: string; content: unknown[] }
    assert.equal(list.type, 'bulletList')
    assert.equal(list.content.length, 2)
    assert.equal(docToPlainText(doc(...r)), 'один\nдва')
  })
  it('повторное нажатие снимает список; переключение типа без вложенности', () => {
    const bullets = applyListToBlocks([p('a'), p('b')], 'bulletList')
    const ordered = applyListToBlocks(bullets, 'orderedList')
    assert.equal(ordered.length, 1)
    assert.equal(ordered[0]!.type, 'orderedList')
    assert.ok(!JSON.stringify(ordered).includes('bulletList'))
    const back = applyListToBlocks(ordered, 'orderedList')
    assert.deepEqual(back.map((b) => b.type), ['paragraph', 'paragraph'])
  })
  it('нумерация идемпотентна: нет дублирования «1. 1.»', () => {
    const once = applyListToBlocks([p('1. один'), p('2. два')], 'orderedList')
    assert.equal(docToPlainText(doc(...once)), 'один\nдва')
    const bulletsThenOrdered = applyListToBlocks(applyListToBlocks(once, 'bulletList'), 'orderedList')
    assert.equal(docToPlainText(doc(...bulletsThenOrdered)), 'один\nдва')
  })
  it('без выделения: текущий блок — соседние непустые абзацы', () => {
    const blocks = [p('Заголовок'), p(''), p('a'), p('b'), p(''), p('c')]
    assert.deepEqual(currentBlockRange(blocks, 3), [2, 3])
    assert.deepEqual(currentBlockRange(blocks, 5), [5, 5])
  })
})

describe('descriptionDoc: вставка обычного текста', () => {
  it('многострочный текст сохраняет абзацы и списки, управляющие символы удаляются', () => {
    const b = textToBlocks('Заголовок\r\n\r\n- раз\n- два\n1. a\n2) b\nконец\u0007')
    assert.deepEqual(b.map((x) => x.type), ['paragraph', 'bulletList', 'orderedList', 'paragraph'])
    assert.equal(docToPlainText(doc(...b)), 'Заголовок\nраз\nдва\na\nb\nконец')
  })
  it('HTML-теги остаются текстом и не исполняются', () => {
    const b = textToBlocks('<script>alert(1)</script>')
    const v = validateDescriptionDoc(doc(...b))
    assert.ok(v.ok)
    assert.equal(docToPlainText(v.ok ? v.value : doc()), '<script>alert(1)</script>')
  })
})

describe('descriptionDoc: валидация и санитизация', () => {
  it('неизвестные узлы и марки отклоняются, лишние атрибуты отбрасываются', () => {
    assert.equal(validateDescriptionDoc(doc({ type: 'image' } as unknown as DocBlock)).ok, false)
    const r = validateDescriptionDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] } as unknown as DocBlock))
    assert.equal(r.ok, false)
    const nested = validateDescriptionDoc(
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('a'), applyListToBlocks([p('b')], 'bulletList')[0]] }] } as unknown as DocBlock),
    )
    assert.equal(nested.ok, false)
  })
  it('счётчик — видимые символы без маркеров и переводов строк; эмодзи = 1', () => {
    const d = doc(p('ab'), ...applyListToBlocks([p('c'), p('😀')], 'orderedList'))
    assert.equal(docCharCount(d), 4)
  })
  it('превышение лимита — ошибка, без молчаливого обрезания', () => {
    const big = doc(...Array.from({ length: 5 }, () => p('я'.repeat(4001))))
    assert.ok(docCharCount(big) > DOC_TEXT_MAX)
    assert.equal(checkDocLimits(big).ok, false)
    assert.equal(validateDescriptionDoc(big).ok, false)
    assert.equal(docCharCount(big), 20005)
  })
  it('сервер: принимает документ, отклоняет мусор и длинный текст', () => {
    const d = canonicalDoc(doc(p('Состав'), ...applyListToBlocks([p('вода')], 'bulletList')))
    const ok = applyProductPatch({}, { set: { description: d } })
    assert.ok(ok.ok)
    assert.ok(isDescriptionDoc(ok.ok ? ok.override!.description : null))
    assert.equal(applyProductPatch({}, { set: { description: { type: 'doc', version: 1, content: [{ type: 'table' }] } } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { description: doc(...Array.from({ length: 5 }, () => p('я'.repeat(4001)))) } }).ok, false)
  })
})

describe('descriptionDoc: совместимость со старыми описаниями', () => {
  it('секции конвертируются: заголовок, абзацы без автожирного, подписи жирные, списки', () => {
    const d = legacyToDoc([{ heading: 'Состав', number: '1', paragraphs: ['текст', { label: 'Важно:', text: 'пить воду' }], list: ['a', 'b'] }])
    assert.equal(d.content[0]!.type, 'heading')
    assert.ok(docToPlainText(d).includes('Состав'))
    assert.ok(docToPlainText(d).includes('Важно: пить воду'))
    assert.equal(d.content.at(-1)!.type, 'bulletList')
    assert.equal(validateDescriptionDoc(d).ok, true)
  })
  it('все описания каталога открываются в редакторе и проходят валидацию', () => {
    for (const prod of PRODUCTS) {
      if (!prod.description) continue
      const d = canonicalDoc(toEditableDoc(prod.description))
      const v = validateDescriptionDoc(d)
      assert.ok(v.ok, `${prod.id}: ${v.ok ? '' : v.error}`)
    }
  })
  it('открытие старого описания без правок не создаёт изменений', () => {
    for (const prod of PRODUCTS.filter((x) => x.description).slice(0, 20)) {
      const orig = toPublicProductData(prod)
      const r = buildSet(initialState(orig), orig)
      assert.ok(r.ok)
      assert.deepEqual(r.ok ? Object.keys(r.set) : null, [])
    }
  })
})
