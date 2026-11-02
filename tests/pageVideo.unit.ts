import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkPageDoc, PAGE_BLOCK_TYPES, PAGE_BLOCK_LABEL, sanitizePublicPageDoc, type VideoBlock } from '../src/cms/pageDoc'
import type { MediaResolver } from '../src/cms/richBlocks'
import { collectMediaIds, usageFromRows } from '../server/max/contentMediaRefs'
import { checkVideoFile } from '../src/admin-reviews/pages/videoProbe'
import { duplicateBlock, newPageBlock, removeBlock } from '../src/admin-reviews/pages/editorOps'

/** Видео-блок страниц: всё на моках (медиатека — функция-резолвер, файлов и сети нет). */
const VID = '11111111-1111-4111-8111-111111111111'
const MOV = '22222222-2222-4222-8222-222222222222'
const POS = '33333333-3333-4333-8333-333333333333'
const PENDING = '44444444-4444-4444-8444-444444444444'

const media: Record<string, { kind: 'image' | 'video'; mime: string; url: string; ready: boolean }> = {
  [VID]: { kind: 'video', mime: 'video/mp4', url: 'https://blob.test/v.mp4', ready: true },
  [MOV]: { kind: 'video', mime: 'video/quicktime', url: 'https://blob.test/v.mov', ready: true },
  [POS]: { kind: 'image', mime: 'image/jpeg', url: 'https://blob.test/p.jpg', ready: true },
  [PENDING]: { kind: 'video', mime: 'video/webm', url: 'https://blob.test/w.webm', ready: false },
}
const wants: string[] = []
const resolve: MediaResolver = async (id, want) => {
  wants.push(`${id}:${want}`)
  const m = media[id.toLowerCase()]
  if (!m) return { ok: false, error: 'media_not_found' }
  if (m.kind !== want) return { ok: false, error: 'media_wrong_kind' }
  if (!m.ready) return { ok: false, error: 'media_not_ready' }
  return { ok: true, src: m.url, width: 1280, height: 720, mime: m.mime }
}
const vblock = (over: Partial<VideoBlock> = {}) => ({
  id: 'v1',
  type: 'video',
  width: 'normal',
  align: 'center',
  mediaId: VID,
  url: 'ignored-by-server',
  mime: '',
  posterMediaId: null,
  posterUrl: '',
  aspect: '16:9',
  createdAt: '2026-11-01T12:00:00.000Z',
  ...over,
})
const doc = (...blocks: unknown[]) => ({ version: 1, lead: '', toc: false, blocks })

const mp4Head = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 0, 0])
const webmHead = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
const good = { loaded: true, canPlay: true, duration: 30 }

describe('page video: модель', () => {
  it('1. «Видео» — четвёртый тип элемента в реестре', () => {
    assert.ok(PAGE_BLOCK_TYPES.includes('video'))
    assert.equal(PAGE_BLOCK_LABEL.video, 'Видео')
  })

  it('2. новый блок пустой: без файла, 16:9, дата создания', () => {
    const b = newPageBlock('video') as VideoBlock
    assert.equal(b.type, 'video')
    assert.equal(b.mediaId, null)
    assert.equal(b.aspect, '16:9')
    assert.ok(!Number.isNaN(Date.parse(b.createdAt)))
  })

  it('3. сервер подставляет url из медиатеки (клиентскому url не верит)', async () => {
    const r = await checkPageDoc(doc(vblock()), resolve)
    assert.ok(r.ok)
    const b = r.value.blocks[0] as VideoBlock
    assert.equal(b.url, 'https://blob.test/v.mp4')
    assert.equal(b.mime, 'video/mp4')
    assert.equal(b.align, 'center')
  })

  it('4. обложка резолвится как изображение', async () => {
    wants.length = 0
    const r = await checkPageDoc(doc(vblock({ posterMediaId: POS })), resolve)
    assert.ok(r.ok)
    assert.equal((r.value.blocks[0] as VideoBlock).posterUrl, 'https://blob.test/p.jpg')
    assert.deepEqual(wants, [`${VID}:video`, `${POS}:image`])
  })

  it('5. незавершённая загрузка не сохраняется', async () => {
    const r = await checkPageDoc(doc(vblock({ mediaId: PENDING })), resolve)
    assert.equal(r.ok, false)
  })

  it('6. картинка вместо видео и видео вместо обложки — отказ', async () => {
    assert.equal((await checkPageDoc(doc(vblock({ mediaId: POS })), resolve)).ok, false)
    assert.equal((await checkPageDoc(doc(vblock({ posterMediaId: VID })), resolve)).ok, false)
  })

  it('7. только MP4/WebM: MOV из медиатеки в блок не проходит', async () => {
    const r = await checkPageDoc(doc(vblock({ mediaId: MOV })), resolve)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error, 'unsupported_video')
  })

  it('8. неверный id файла — отказ; пустой блок допустим в черновике', async () => {
    assert.equal((await checkPageDoc(doc(vblock({ mediaId: 'x' as string })), resolve)).ok, false)
    assert.ok((await checkPageDoc(doc(vblock({ mediaId: null })), resolve)).ok)
  })

  it('9. неизвестные пропорции/ширина → безопасные значения по умолчанию', async () => {
    const r = await checkPageDoc(doc(vblock({ aspect: '21:9' as never, width: 'huge' as never })), resolve)
    assert.ok(r.ok)
    const b = r.value.blocks[0] as VideoBlock
    assert.equal(b.aspect, '16:9')
    assert.equal(b.width, 'normal')
  })

  it('10. все пропорции 16:9, 9:16, 1:1, auto сохраняются', async () => {
    for (const a of ['16:9', '9:16', '1:1', 'auto'] as const) {
      const r = await checkPageDoc(doc(vblock({ aspect: a })), resolve)
      assert.ok(r.ok)
      assert.equal((r.value.blocks[0] as VideoBlock).aspect, a)
    }
  })

  it('11. JSON без бинарных данных: только ссылки, data:-URL на сайте отбрасывается', () => {
    const pub = sanitizePublicPageDoc(doc(vblock({ url: 'data:video/mp4;base64,AAAA' })))
    assert.equal(pub?.blocks.length, 0)
    const ok = sanitizePublicPageDoc(doc(vblock({ url: 'https://blob.test/v.mp4', posterUrl: 'javascript:alert(1)' })))
    assert.equal((ok?.blocks[0] as VideoBlock).posterUrl, '')
  })

  it('12. на сайте пустой видео-блок не выводится', () => {
    const pub = sanitizePublicPageDoc(doc(vblock({ mediaId: null, url: '' })))
    assert.equal(pub?.blocks.length, 0)
  })

  it('13. использование медиа учитывает видео и обложку', () => {
    const d = doc(vblock({ posterMediaId: POS }))
    const ids = collectMediaIds(d)
    assert.ok(ids.has(VID) && ids.has(POS))
    const u = usageFromRows(VID, [{ kind: 'page', id: 'p1', title: 'T', draft: d, published: null }])
    assert.equal(u.length, 1)
    assert.equal(u[0]!.role, 'page_draft')
  })

  it('14. дубль — новый id, тот же файл; удаление блока не трогает медиа', () => {
    const d = doc(vblock({ url: 'https://blob.test/v.mp4' })) as never
    const dup = duplicateBlock(d, 0)
    assert.equal(dup.blocks.length, 2)
    assert.notEqual(dup.blocks[1]!.id, 'v1')
    assert.equal((dup.blocks[1] as VideoBlock).mediaId, VID)
    const rm = removeBlock(dup, 0)
    assert.equal(rm.blocks.length, 1)
    assert.equal(media[VID]!.ready, true)
  })
})

describe('page video: проверка файла до загрузки', () => {
  it('15. MP4 и WebM с правильной сигнатурой проходят', () => {
    assert.equal(checkVideoFile('a.mp4', 'video/mp4', mp4Head, good), null)
    assert.equal(checkVideoFile('a.webm', 'video/webm', webmHead, good), null)
    assert.equal(checkVideoFile('a.mp4', '', mp4Head, good), null)
  })

  it('16. чужой формат и подмена расширения — понятная ошибка', () => {
    assert.match(checkVideoFile('a.mov', 'video/quicktime', mp4Head, good)!, /MP4.*WebM/)
    assert.match(checkVideoFile('a.mp4', 'video/mp4', webmHead, good)!, /повреждён или переименован/)
    assert.match(checkVideoFile('a.webm', 'video/webm', new Uint8Array([1, 2, 3, 4]), good)!, /повреждён/)
  })

  it('17. битый файл (браузер не читает метаданные) — отказ', () => {
    assert.match(checkVideoFile('a.mp4', 'video/mp4', mp4Head, { loaded: false, canPlay: true, duration: NaN })!, /повреждён/)
    // Браузер не умеет кодек — решает сервер (сигнатура), не блокируем.
    assert.equal(checkVideoFile('a.mp4', 'video/mp4', mp4Head, { loaded: false, canPlay: false, duration: NaN }), null)
  })

  it('18. лимит длительности настраивается', () => {
    assert.equal(checkVideoFile('a.mp4', 'video/mp4', mp4Head, { ...good, duration: 590 }), null)
    assert.match(checkVideoFile('a.mp4', 'video/mp4', mp4Head, { ...good, duration: 700 })!, /длиннее 10 мин/)
    assert.match(checkVideoFile('a.mp4', 'video/mp4', mp4Head, { ...good, duration: 90 }, 60)!, /длиннее 1 мин/)
  })
})
