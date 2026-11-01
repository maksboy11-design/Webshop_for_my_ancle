import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkPageDoc, emptyPageDoc, isSafeExternalUrl, isValidSlug, sanitizePublicPageDoc, slugify } from '../src/cms/pageDoc'
import { pageTexts, scienceSourceTexts, scienceToPage } from '../src/cms/scienceToPage'
import { groupBlocks } from '../src/components/pages/pageLayout'
import {
  clampMenu,
  commit,
  dropAt,
  duplicateBlock,
  HISTORY_LIMIT,
  initHistory,
  insertBlock,
  isDoubleTap,
  moveBlock,
  newPageBlock,
  redo,
  undo,
} from '../src/admin-reviews/pages/editorOps'

const noMedia = async () => ({ ok: false as const, error: 'not_found' })

describe('pageDoc', () => {
  it('slugify и зарезервированные адреса', () => {
    assert.equal(slugify('Научные факты'), 'nauchnye-fakty')
    assert.equal(slugify('  Hello, World!  '), 'hello-world')
    assert.ok(isValidSlug('o-nas'))
    assert.ok(!isValidSlug('admin'))
    assert.ok(!isValidSlug('-x'))
  })

  it('внешние ссылки только https', () => {
    assert.ok(!isSafeExternalUrl('javascript:alert(1)'))
    assert.ok(!isSafeExternalUrl('data:text/html,1'))
  })

  it('checkPageDoc отклоняет неизвестный тип и нормализует блоки', async () => {
    const bad = await checkPageDoc({ ...emptyPageDoc(), blocks: [{ id: 'a', type: 'iframe' }] }, noMedia)
    assert.equal(bad.ok, false)
    const ok = await checkPageDoc({ ...emptyPageDoc(), blocks: [newPageBlock('heading')] }, noMedia)
    assert.equal(ok.ok, true)
  })

  it('sanitizePublicPageDoc не падает на мусоре', () => {
    assert.equal(sanitizePublicPageDoc('x'), null)
    assert.deepEqual(sanitizePublicPageDoc({ version: 1, blocks: [{ type: 'script' }] })?.blocks, [])
  })

  it('sanitizePublicPageDoc принимает /product-media/ и отсекает javascript:', () => {
    const ok = sanitizePublicPageDoc({
      version: 1,
      blocks: [
        {
          id: 'i1',
          type: 'image',
          width: 'normal',
          align: 'left',
          aspect: 'auto',
          radius: 'md',
          image: { mediaId: '00000000-0000-0000-0000-000000000001', src: '/product-media/library/x.webp', width: 10, height: 10 },
        },
        {
          id: 'i2',
          type: 'image',
          width: 'normal',
          align: 'left',
          aspect: 'auto',
          radius: 'md',
          image: { mediaId: 'x', src: 'javascript:alert(1)', width: 1, height: 1 },
        },
      ],
    })
    assert.equal(ok?.blocks[0] && ok.blocks[0].type === 'image' && ok.blocks[0].image?.src, '/product-media/library/x.webp')
    assert.equal(ok?.blocks[1] && ok.blocks[1].type === 'image' && ok.blocks[1].image, null)
  })

  it('«Научные факты»: тексты, порядок и заголовки совпадают с исходником', async () => {
    const p = scienceToPage()
    assert.equal(p.slug, 'science')
    assert.deepEqual(pageTexts(p.title, p.doc), scienceSourceTexts())
    const checked = await checkPageDoc(p.doc, noMedia, {
      allowedExternal: new Set(p.doc.blocks.flatMap((b) => (b.type === 'button' && b.target.kind === 'external' ? [b.target.url] : []))),
    })
    assert.equal(checked.ok, true)
  })

  it('groupBlocks собирает подряд идущие узкие карточки в сетку', () => {
    const card = () => ({
      ...(newPageBlock('text') as Extract<ReturnType<typeof newPageBlock>, { type: 'text' }>),
      width: 'narrow' as const,
      card: true,
    })
    const g = groupBlocks([card(), card(), newPageBlock('heading'), card()])
    assert.equal(Array.isArray(g[0]) && g[0].length, 2)
    assert.equal(g.length, 3)
  })
})

describe('editorOps', () => {
  const snap = (n: number) => ({ title: `t${n}`, slug: 's', doc: emptyPageDoc() })

  it('вставка, дубль, перенос', () => {
    let d = insertBlock(emptyPageDoc(), 0, newPageBlock('text'))
    d = insertBlock(d, 1, newPageBlock('button'))
    d = duplicateBlock(d, 0)
    assert.deepEqual(
      d.blocks.map((b) => b.type),
      ['text', 'text', 'button'],
    )
    assert.notEqual(d.blocks[0]!.id, d.blocks[1]!.id)
    assert.equal(moveBlock(d, 2, 0).blocks[0]!.type, 'button')
    assert.equal(dropAt(d, 2, 0).blocks[0]!.type, 'button')
  })

  it('история: undo/redo, склейка ввода, лимит', () => {
    let h = initHistory(snap(0))
    h = commit(h, snap(1), 'a', 0)
    h = commit(h, snap(2), 'title', 1000)
    h = commit(h, snap(3), 'title', 1500) // склеивается с предыдущим
    assert.equal(h.past.length, 2)
    h = undo(h)
    assert.equal(h.present.title, 't1')
    h = redo(h)
    assert.equal(h.present.title, 't3')
    assert.equal(commit(h, snap(3), 'x', 9e9), h)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = commit(h, snap(10 + i), `k${i}`, i * 10_000)
    assert.equal(h.past.length, HISTORY_LIMIT)
  })

  it('меню не выходит за экран; двойной тап', () => {
    const m = clampMenu(380, 800, 200, 300, 390, 844)
    assert.ok(m.left + 200 <= 390 - 8 && m.top + 300 <= 844 - 8 && m.left >= 8 && m.top >= 8)
    assert.ok(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 200, x: 15, y: 12 }))
    assert.ok(!isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 500, x: 10, y: 10 }))
    assert.ok(!isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 100, x: 80, y: 10 }))
  })
})
