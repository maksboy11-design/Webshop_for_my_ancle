/**
 * Дополнительные блоки товара (поверх модели product_content v2): таблица характеристик, преимущества,
 * информационные блоки, фото, галерея и «Видео о товаре». Строгая проверка входа из админки и
 * публичный вид для сайта. Только данные — рендер без innerHTML.
 */
import { BLOCK_ID, type ContentBlock, type ProductContent } from './blocks'

export const EXTRA_TYPES = ['specs_table', 'benefits', 'info', 'image', 'gallery', 'button'] as const
export type ExtraType = (typeof EXTRA_TYPES)[number]
export const EXTRA_LABEL: Record<ExtraType, string> = {
  specs_table: 'Таблица характеристик',
  benefits: 'Преимущества',
  info: 'Информационный блок',
  image: 'Фото',
  gallery: 'Галерея',
  button: 'Кнопка',
}
export const EXTRAS_MAX = 40
export const VIDEOS_MAX = 20
const ROWS_MAX = 60
const ITEMS_MAX = 30
const SHORT = 160
const LONG = 2000

export type InfoTone = 'info' | 'note' | 'warning'
export interface BlockImage {
  mediaId: string
  src: string
  srcSet?: string
  width: number
  height: number
  alt?: string
}
export type ButtonTargetContent =
  | { kind: 'page'; pageId: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' }
export type ExtraBlockContent =
  | { type: 'specs_table'; title: string; rows: { label: string; value: string }[] }
  | { type: 'benefits'; title: string; items: { title: string; text: string }[] }
  | { type: 'info'; title: string; text: string; tone: InfoTone }
  | { type: 'image'; image: BlockImage | null; caption: string }
  | { type: 'gallery'; title: string; items: BlockImage[] }
  | {
      type: 'button'
      text: string
      variant: 'primary' | 'secondary' | 'soft'
      align: 'left' | 'center' | 'right'
      target: ButtonTargetContent
      /** Публичный href (pageHref / внешний URL), подставляется при сохранении. */
      href?: string
    }

export type VideoProvider = 'upload' | 'youtube' | 'vk' | 'rutube'
export interface VideoItem {
  key: string
  provider: VideoProvider
  /** upload — адрес файла; ссылка — embed-адрес из белого списка. */
  src: string
  mediaId?: string
  /** Исходная ссылка, как её вставил админ (для правки). */
  link?: string
  title: string
  description: string
  poster: { src: string; mediaId?: string } | null
  mime?: string
}

/** Публичный вид дополнительного блока (на сайт). */
export type PublicExtraBlock = { id: string } & ExtraBlockContent
export interface PublicVideos {
  items: VideoItem[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')
const line = (v: unknown, max = SHORT): string => str(v, max).replace(/\s+/g, ' ')

/* ---------- ссылки на видео: только белый список, на выходе — наш embed-адрес ---------- */

export interface ParsedVideoLink {
  provider: Exclude<VideoProvider, 'upload'>
  embed: string
  /** Обложка провайдера, если её можно получить без API (YouTube). */
  poster: string | null
}

export function parseVideoLink(raw: string): ParsedVideoLink | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')
  const yt = (id: string | null | undefined): ParsedVideoLink | null =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? { provider: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
      : null
  if (host === 'youtu.be') return yt(u.pathname.split('/')[1])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') return yt(u.searchParams.get('v'))
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
    return yt(m?.[1])
  }
  if (host === 'vk.com' || host === 'vkvideo.ru' || host === 'vk.ru') {
    let oid: string | null = null
    let id: string | null = null
    if (u.pathname === '/video_ext.php') {
      oid = u.searchParams.get('oid')
      id = u.searchParams.get('id')
    } else {
      const m = (u.pathname + (u.searchParams.get('z') ? '/' + u.searchParams.get('z') : '')).match(/video(-?\d+)_(\d+)/)
      if (m) [, oid, id] = m as unknown as [string, string, string]
    }
    if (!oid || !id || !/^-?\d{1,20}$/.test(oid) || !/^\d{1,20}$/.test(id)) return null
    const hash = u.searchParams.get('hash')
    const h = hash && /^[A-Za-z0-9]{1,40}$/.test(hash) ? `&hash=${hash}` : ''
    return { provider: 'vk', embed: `https://vk.com/video_ext.php?oid=${oid}&id=${id}${h}&hd=2`, poster: null }
  }
  if (host === 'rutube.ru') {
    const m = u.pathname.match(/^\/(?:video|play\/embed|shorts)\/([0-9a-f]{32})/i)
    return m ? { provider: 'rutube', embed: `https://rutube.ru/play/embed/${m[1]!.toLowerCase()}`, poster: null } : null
  }
  return null
}

/** Разрешённые адреса для iframe на сайте (повторная проверка при выводе). */
export function isAllowedEmbed(src: string): boolean {
  return /^https:\/\/(www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}|vk\.com\/video_ext\.php\?oid=-?\d+&id=\d+(&hash=[A-Za-z0-9]+)?&hd=2|rutube\.ru\/play\/embed\/[0-9a-f]{32})$/.test(
    src,
  )
}

/* ---------- проверка входа ---------- */

/** Ссылка на медиа из медиатеки: сервер подставляет адреса сам, клиенту доверяем только id. */
export interface MediaRef {
  mediaId: string
}
export type MediaResolver = (
  mediaId: string,
  want: 'image' | 'video',
) => Promise<{ ok: true; src: string; srcSet?: string; width: number; height: number; mime: string } | { ok: false; error: string }>

export type CheckResult<T> = { ok: true; value: T } | { ok: false; error: string; field?: string }
const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function checkBlockImage(v: unknown, resolve: MediaResolver, field: string): Promise<CheckResult<BlockImage>> {
  if (!isObj(v) || typeof v.mediaId !== 'string' || !UUID.test(v.mediaId)) return fail('invalid', field)
  const r = await resolve(v.mediaId, 'image')
  if (!r.ok) return fail(r.error, field)
  const alt = line(v.alt)
  return {
    ok: true,
    value: {
      mediaId: v.mediaId,
      src: r.src,
      ...(r.srcSet ? { srcSet: r.srcSet } : {}),
      width: r.width,
      height: r.height,
      ...(alt ? { alt } : {}),
    },
  }
}

async function extraContent(
  type: ExtraType,
  c: Record<string, unknown>,
  resolve: MediaResolver,
  f: string,
): Promise<CheckResult<Record<string, unknown>>> {
  switch (type) {
    case 'specs_table': {
      const rows = Array.isArray(c.rows) ? c.rows : []
      if (rows.length > ROWS_MAX) return fail('too_many', `${f}.rows`)
      return {
        ok: true,
        value: {
          title: line(c.title),
          rows: rows
            .filter(isObj)
            .map((r) => ({ label: line(r.label, 200), value: str(r.value, 600) }))
            .filter((r) => r.label || r.value),
        },
      }
    }
    case 'benefits': {
      const items = Array.isArray(c.items) ? c.items : []
      if (items.length > ITEMS_MAX) return fail('too_many', `${f}.items`)
      return {
        ok: true,
        value: {
          title: line(c.title),
          items: items
            .filter(isObj)
            .map((i) => ({ title: line(i.title, 200), text: str(i.text, 800) }))
            .filter((i) => i.title || i.text),
        },
      }
    }
    case 'info': {
      const tone: InfoTone = c.tone === 'warning' || c.tone === 'note' ? c.tone : 'info'
      return { ok: true, value: { title: line(c.title), text: str(c.text, LONG), tone } }
    }
    case 'image': {
      let img: BlockImage | null = null
      if (c.image != null) {
        const r = await checkBlockImage(c.image, resolve, `${f}.image`)
        if (!r.ok) return r
        img = r.value
      }
      return { ok: true, value: { image: img, caption: line(c.caption, 300) } }
    }
    case 'gallery': {
      const items = Array.isArray(c.items) ? c.items : []
      if (items.length > ITEMS_MAX) return fail('too_many', `${f}.items`)
      const out: BlockImage[] = []
      for (let i = 0; i < items.length; i++) {
        const r = await checkBlockImage(items[i], resolve, `${f}.items.${i}`)
        if (!r.ok) return r
        out.push(r.value)
      }
      return { ok: true, value: { title: line(c.title), items: out } }
    }
    case 'button': {
      const text = line(c.text, 80)
      if (!text) return fail('empty_button', `${f}.text`)
      const variant = c.variant === 'secondary' || c.variant === 'soft' ? c.variant : 'primary'
      const align = c.align === 'center' || c.align === 'right' ? c.align : 'left'
      let target: ButtonTargetContent = { kind: 'none' }
      if (isObj(c.target)) {
        if (c.target.kind === 'page' && typeof c.target.pageId === 'string' && UUID.test(c.target.pageId))
          target = { kind: 'page', pageId: c.target.pageId.toLowerCase() }
        else if (c.target.kind === 'external' && typeof c.target.url === 'string') {
          const url = line(c.target.url, 500)
          if (/^https:\/\//i.test(url)) target = { kind: 'external', url }
        }
      }
      const href =
        typeof c.href === 'string' && (/^#/.test(c.href) || /^\/(?!\/)/.test(c.href) || /^https:\/\//i.test(c.href))
          ? c.href.slice(0, 500)
          : undefined
      return { ok: true, value: { text, variant, align, target, ...(href ? { href } : {}) } }
    }
  }
}

export interface ExtrasInput {
  blocks: { id: string; type: ExtraType; active: boolean; content: Record<string, unknown> }[]
  showVideos: boolean
  videos: VideoItem[]
}

/** Проверка тела PUT ?extras=1. Медиа подставляются через resolve (только готовые файлы медиатеки). */
export async function checkExtrasInput(raw: unknown, resolve: MediaResolver): Promise<CheckResult<ExtrasInput>> {
  if (!isObj(raw)) return fail('invalid')
  const blocksRaw = Array.isArray(raw.blocks) ? raw.blocks : null
  const videosRaw = Array.isArray(raw.videos) ? raw.videos : null
  if (!blocksRaw || !videosRaw) return fail('invalid')
  if (blocksRaw.length > EXTRAS_MAX) return fail('too_many', 'blocks')
  if (videosRaw.length > VIDEOS_MAX) return fail('too_many', 'videos')
  const seen = new Set<string>()
  const blocks: ExtrasInput['blocks'] = []
  for (let i = 0; i < blocksRaw.length; i++) {
    const b = blocksRaw[i]
    const f = `blocks.${i}`
    if (!isObj(b) || typeof b.id !== 'string' || !BLOCK_ID.test(b.id) || seen.has(b.id)) return fail('invalid', `${f}.id`)
    if (!(EXTRA_TYPES as readonly string[]).includes(b.type as string)) return fail('invalid', `${f}.type`)
    seen.add(b.id)
    const r = await extraContent(b.type as ExtraType, isObj(b.content) ? b.content : {}, resolve, `${f}.content`)
    if (!r.ok) return r
    blocks.push({ id: b.id, type: b.type as ExtraType, active: b.active !== false, content: r.value })
  }
  const keys = new Set<string>()
  const videos: VideoItem[] = []
  for (let i = 0; i < videosRaw.length; i++) {
    const v = videosRaw[i]
    const f = `videos.${i}`
    if (!isObj(v) || typeof v.key !== 'string' || !BLOCK_ID.test(v.key) || keys.has(v.key)) return fail('invalid', `${f}.key`)
    keys.add(v.key)
    let item: VideoItem
    const title = line(v.title, 200)
    const description = str(v.description, 600)
    if (typeof v.mediaId === 'string') {
      if (!UUID.test(v.mediaId)) return fail('invalid', `${f}.mediaId`)
      const r = await resolve(v.mediaId, 'video')
      if (!r.ok) return fail(r.error, `${f}.mediaId`)
      item = { key: v.key, provider: 'upload', src: r.src, mediaId: v.mediaId, mime: r.mime, title, description, poster: null }
    } else if (typeof v.link === 'string') {
      const p = parseVideoLink(v.link)
      if (!p) return fail('unsupported_video_link', `${f}.link`)
      item = {
        key: v.key,
        provider: p.provider,
        src: p.embed,
        link: line(v.link, 500),
        title,
        description,
        poster: p.poster ? { src: p.poster } : null,
      }
    } else return fail('invalid', f)
    if (isObj(v.poster) && typeof v.poster.mediaId === 'string') {
      if (!UUID.test(v.poster.mediaId)) return fail('invalid', `${f}.poster`)
      const r = await resolve(v.poster.mediaId, 'image')
      if (!r.ok) return fail(r.error, `${f}.poster`)
      item.poster = { src: r.src, mediaId: v.poster.mediaId }
    }
    videos.push(item)
  }
  return { ok: true, value: { blocks, showVideos: raw.showVideos === true, videos } }
}

const TEXT_BLOCKS = new Set(['section_heading', 'text', 'bullet_list', 'ordered_list'])
const VIDEO_BLOCK_ID = 'videos'

/** Заменяет в черновике дополнительные блоки и видео; текстовые блоки и прочие meta не трогает. */
export function applyExtras(draft: ProductContent, input: ExtrasInput): ProductContent {
  const text = draft.blocks.filter((b) => TEXT_BLOCKS.has(b.type))
  const keep = draft.blocks.filter(
    (b) => !TEXT_BLOCKS.has(b.type) && !(EXTRA_TYPES as readonly string[]).includes(b.type) && b.type !== 'video',
  )
  const used = new Set([...text, ...keep].map((b) => b.id))
  const blocks: ContentBlock[] = [...text, ...keep]
  for (const b of input.blocks) {
    if (used.has(b.id)) continue
    used.add(b.id)
    blocks.push({ id: b.id, type: b.type, order: 0, active: b.active, settings: {}, content: b.content })
  }
  if (input.videos.length)
    blocks.push({
      id: used.has(VIDEO_BLOCK_ID) ? `${VIDEO_BLOCK_ID}_1` : VIDEO_BLOCK_ID,
      type: 'video',
      order: 0,
      active: true,
      settings: {},
      content: { items: input.videos },
    })
  blocks.forEach((b, i) => (b.order = i))
  const meta = { ...draft.meta }
  if (input.showVideos) meta.showVideos = true
  else delete meta.showVideos
  return { ...draft, meta, blocks }
}

export interface ExtrasView {
  blocks: ExtrasInput['blocks']
  showVideos: boolean
  videos: VideoItem[]
}

/** Чтение дополнительных блоков из контента (для админки и сайта). */
export function readExtras(c: ProductContent | null | undefined): ExtrasView {
  if (!c) return { blocks: [], showVideos: false, videos: [] }
  const blocks = c.blocks
    .filter((b) => (EXTRA_TYPES as readonly string[]).includes(b.type))
    .map((b) => ({ id: b.id, type: b.type as ExtraType, active: b.active, content: b.content }))
  const vb = c.blocks.find((b) => b.type === 'video' && b.active)
  const videos = (Array.isArray(vb?.content.items) ? (vb!.content.items as unknown[]) : []).filter(isVideoItem)
  return { blocks, showVideos: c.meta.showVideos === true, videos }
}

function isVideoItem(v: unknown): v is VideoItem {
  if (!isObj(v) || typeof v.key !== 'string' || typeof v.src !== 'string' || !v.src) return false
  if (v.provider === 'upload') return /^(https:\/\/|\/)/.test(v.src)
  return (v.provider === 'youtube' || v.provider === 'vk' || v.provider === 'rutube') && isAllowedEmbed(v.src)
}

const blockHasContent = (b: ExtrasInput['blocks'][number]): boolean => {
  const c = b.content
  switch (b.type) {
    case 'specs_table':
      return Array.isArray(c.rows) && c.rows.length > 0
    case 'benefits':
    case 'gallery':
      return Array.isArray(c.items) && c.items.length > 0
    case 'info':
      return typeof c.text === 'string' && !!c.text.trim()
    case 'image':
      return isObj(c.image)
    case 'button':
      return typeof c.text === 'string' && !!c.text.trim()
  }
}

/** Публичные блоки: только активные и непустые. Видео — только при включённом переключателе. */
export function publicExtras(c: ProductContent | null | undefined): { blocks: PublicExtraBlock[]; videos: VideoItem[] } {
  const x = readExtras(c)
  return {
    blocks: x.blocks
      .filter((b) => b.active && blockHasContent(b))
      .map((b) => ({ id: b.id, type: b.type, ...b.content }) as PublicExtraBlock),
    videos: x.showVideos ? x.videos : [],
  }
}

const safeUrl = (v: unknown): v is string => typeof v === 'string' && (/^\/(?!\/)/.test(v) || v.startsWith('https://'))
const s = (v: unknown, max = LONG): string => (typeof v === 'string' ? v.slice(0, max) : '')

function safeImage(v: unknown): BlockImage | null {
  if (!isObj(v) || !safeUrl(v.src)) return null
  return {
    mediaId: s(v.mediaId, 64),
    src: v.src,
    ...(typeof v.srcSet === 'string' ? { srcSet: v.srcSet } : {}),
    width: Number(v.width) > 0 ? Number(v.width) : 1,
    height: Number(v.height) > 0 ? Number(v.height) : 1,
    ...(typeof v.alt === 'string' && v.alt ? { alt: v.alt } : {}),
  }
}

/** Повторная проверка данных из /api/products на сайте: чужие формы/адреса отбрасываются. */
export function sanitizePublicExtras(v: unknown): { blocks: PublicExtraBlock[]; videos: VideoItem[] } | undefined {
  if (!isObj(v)) return undefined
  const blocks: PublicExtraBlock[] = []
  for (const b of Array.isArray(v.blocks) ? v.blocks.slice(0, EXTRAS_MAX) : []) {
    if (!isObj(b) || typeof b.id !== 'string') continue
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter(isObj) : [])
    switch (b.type) {
      case 'specs_table':
        blocks.push({ id: b.id, type: b.type, title: s(b.title), rows: arr(b.rows).map((r) => ({ label: s(r.label), value: s(r.value) })) })
        break
      case 'benefits':
        blocks.push({ id: b.id, type: b.type, title: s(b.title), items: arr(b.items).map((r) => ({ title: s(r.title), text: s(r.text) })) })
        break
      case 'info':
        blocks.push({
          id: b.id,
          type: b.type,
          title: s(b.title),
          text: s(b.text),
          tone: b.tone === 'warning' || b.tone === 'note' ? b.tone : 'info',
        })
        break
      case 'image': {
        const image = safeImage(b.image)
        if (image) blocks.push({ id: b.id, type: b.type, image, caption: s(b.caption) })
        break
      }
      case 'gallery': {
        const items = (Array.isArray(b.items) ? b.items : []).map(safeImage).filter((x): x is BlockImage => !!x)
        if (items.length) blocks.push({ id: b.id, type: b.type, title: s(b.title), items })
        break
      }
      case 'button': {
        const text = s(b.text, 80)
        if (!text) break
        const variant = b.variant === 'secondary' || b.variant === 'soft' ? b.variant : 'primary'
        const align = b.align === 'center' || b.align === 'right' ? b.align : 'left'
        const href = typeof b.href === 'string' && safeUrl(b.href) ? b.href : typeof b.href === 'string' && b.href.startsWith('#') ? s(b.href, 500) : undefined
        const target = isObj(b.target) ? b.target : { kind: 'none' }
        blocks.push({
          id: b.id,
          type: 'button',
          text,
          variant,
          align,
          target: target as ButtonTargetContent,
          ...(href ? { href } : {}),
        })
        break
      }
    }
  }
  const videos = (Array.isArray(v.videos) ? v.videos.slice(0, VIDEOS_MAX) : []).filter(isVideoItem).map((x) => ({
    ...x,
    title: s(x.title, 200),
    description: s(x.description, 600),
    poster: isObj(x.poster) && safeUrl(x.poster.src) ? { src: x.poster.src } : null,
  }))
  return blocks.length || videos.length ? { blocks, videos } : undefined
}

/** Тело PUT ?extras=1 от админки (адреса медиа сервер подставит сам). */
export interface ExtrasPayload {
  blocks: { id: string; type: ExtraType; active: boolean; content: Record<string, unknown> }[]
  showVideos: boolean
  videos: { key: string; mediaId?: string; link?: string; title: string; description: string; poster: { mediaId: string } | null }[]
}
