import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readProductContent } from '../src/cms/blocks'
import { docToContent, contentToDoc } from '../src/cms/contentDoc'
import {
  applyExtras,
  checkExtrasInput,
  isAllowedEmbed,
  parseVideoLink,
  publicExtras,
  sanitizePublicExtras,
  type MediaResolver,
} from '../src/cms/richBlocks'

const IMG = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'
const resolve: MediaResolver = async (id, want) =>
  id === IMG && want === 'image'
    ? { ok: true, src: 'https://b.test/i.webp', width: 10, height: 20, mime: 'image/webp' }
    : id === VID && want === 'video'
      ? { ok: true, src: 'https://b.test/v.mp4', width: 0, height: 0, mime: 'video/mp4' }
      : { ok: false, error: 'media_not_found' }

test('ссылки на видео: белый список → свой embed-адрес', () => {
  const yt = parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')!
  assert.equal(yt.embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  assert.match(yt.poster!, /i\.ytimg\.com/)
  assert.equal(parseVideoLink('https://youtu.be/dQw4w9WgXcQ')!.provider, 'youtube')
  assert.equal(parseVideoLink('https://youtube.com/shorts/dQw4w9WgXcQ')!.provider, 'youtube')
  assert.equal(parseVideoLink('https://vk.com/video-123_456')!.embed, 'https://vk.com/video_ext.php?oid=-123&id=456&hd=2')
  assert.equal(parseVideoLink('https://vkvideo.ru/video-1_2')!.provider, 'vk')
  assert.equal(
    parseVideoLink('https://vk.com/video_ext.php?oid=-1&id=2&hash=abc')!.embed,
    'https://vk.com/video_ext.php?oid=-1&id=2&hash=abc&hd=2',
  )
  const ru = parseVideoLink('https://rutube.ru/video/0123456789abcdef0123456789abcdef/')!
  assert.equal(ru.embed, 'https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef')
  for (const bad of [
    'https://evil.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://youtube.com.evil.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/watch?v=short',
    'не ссылка',
    'https://rutube.ru/video/xyz/',
  ])
    assert.equal(parseVideoLink(bad), null, bad)
  for (const p of [yt, ru]) assert.ok(isAllowedEmbed(p.embed))
  assert.equal(isAllowedEmbed('https://evil.com/embed'), false)
})

test('проверка блоков: медиа только из медиатеки, лишнее отбрасывается', async () => {
  const ok = await checkExtrasInput(
    {
      showVideos: true,
      blocks: [
        {
          id: 'a',
          type: 'specs_table',
          content: {
            title: ' Т ',
            rows: [
              { label: 'Объём', value: '50 мл' },
              { label: '', value: '' },
            ],
            evil: '<script>',
          },
        },
        { id: 'b', type: 'gallery', content: { items: [{ mediaId: IMG, src: 'https://evil/x' }] } },
        { id: 'c', type: 'info', active: false, content: { text: 'x', tone: 'bogus' } },
      ],
      videos: [
        { key: 'v1', link: 'https://youtu.be/dQw4w9WgXcQ', title: 'Обзор' },
        { key: 'v2', mediaId: VID, poster: { mediaId: IMG } },
      ],
    },
    resolve,
  )
  assert.ok(ok.ok)
  if (!ok.ok) return
  assert.deepEqual(ok.value.blocks[0]!.content, { title: 'Т', rows: [{ label: 'Объём', value: '50 мл' }] })
  assert.equal((ok.value.blocks[1]!.content.items as { src: string }[])[0]!.src, 'https://b.test/i.webp')
  assert.equal(ok.value.blocks[2]!.content.tone, 'info')
  assert.equal(ok.value.blocks[2]!.active, false)
  assert.equal(ok.value.videos[0]!.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  assert.equal(ok.value.videos[1]!.poster!.src, 'https://b.test/i.webp')
  const bad = async (body: unknown) => (await checkExtrasInput(body, resolve)).ok
  assert.equal(await bad({ blocks: [], videos: [{ key: 'v', link: 'https://evil.com/v' }] }), false)
  assert.equal(await bad({ blocks: [], videos: [{ key: 'v', mediaId: IMG }] }), false, 'картинка вместо видео')
  assert.equal(await bad({ blocks: [{ id: 'x', type: 'html', content: {} }], videos: [] }), false)
  assert.equal(
    await bad({
      blocks: [
        { id: 'x', type: 'info' },
        { id: 'x', type: 'info' },
      ],
      videos: [],
    }),
    false,
  )
  assert.equal(await bad({ blocks: [{ id: 'x', type: 'image', content: { image: { mediaId: 'not-uuid' } } }], videos: [] }), false)
})

test('applyExtras: текст не трогается, публичный вид учитывает переключатель', async () => {
  const doc = {
    type: 'doc' as const,
    version: 1 as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Текст' }] }],
  }
  const base = docToContent(doc, null)
  const r = await checkExtrasInput(
    {
      showVideos: false,
      blocks: [
        { id: 'i', type: 'info', content: { text: 'Важно' } },
        { id: 'e', type: 'benefits', content: { items: [] } },
      ],
      videos: [{ key: 'v', link: 'https://youtu.be/dQw4w9WgXcQ' }],
    },
    resolve,
  )
  assert.ok(r.ok)
  if (!r.ok) return
  const c = readProductContent(JSON.parse(JSON.stringify(applyExtras(base, r.value))))!
  assert.deepEqual(contentToDoc(c), contentToDoc(base))
  let pub = publicExtras(c)
  assert.deepEqual(
    pub.blocks.map((b) => b.id),
    ['i'],
    'пустой блок не выводится',
  )
  assert.equal(pub.videos.length, 0, 'переключатель выключен — видео нет')
  pub = publicExtras(applyExtras(c, { ...r.value, showVideos: true }))
  assert.equal(pub.videos.length, 1)
  // Текстовое сохранение после блоков сохраняет блоки.
  const after = docToContent(doc, c)
  assert.equal(publicExtras(after).blocks.length, 1)
})

test('сайт: данные из API перепроверяются', () => {
  const x = sanitizePublicExtras({
    blocks: [
      { id: 'a', type: 'image', image: { src: 'javascript:alert(1)' } },
      { id: 'b', type: 'info', text: 't' },
      { id: 'c', type: 'unknown' },
    ],
    videos: [
      { key: '1', provider: 'youtube', src: 'https://evil.com/x', title: '' },
      {
        key: '2',
        provider: 'rutube',
        src: 'https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef',
        title: 'R',
        poster: { src: 'javascript:1' },
      },
    ],
  })!
  assert.deepEqual(
    x.blocks.map((b) => b.id),
    ['b'],
  )
  assert.equal(x.videos.length, 1)
  assert.equal(x.videos[0]!.poster, null)
  assert.equal(sanitizePublicExtras(null), undefined)
})
