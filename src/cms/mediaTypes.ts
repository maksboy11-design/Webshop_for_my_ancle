/**
 * Общие для клиента и сервера правила медиафайлов: допустимые типы, лимиты, сигнатуры (magic bytes),
 * безопасные имена и путь в Blob. Один модуль — для изображений, видео и PDF.
 */
export type MediaKind = 'image' | 'video' | 'document'

export interface MediaTypeRule {
  kind: MediaKind
  ext: string
}

export const MEDIA_TYPES: Record<string, MediaTypeRule> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'application/pdf': { kind: 'document', ext: 'pdf' },
}

export type MediaLimits = Record<MediaKind, number>

const MB = 1024 * 1024
/** Лимиты по умолчанию (сервер может переопределить через MEDIA_MAX_*_MB). */
export const DEFAULT_MEDIA_LIMITS: MediaLimits = { image: 25 * MB, video: 500 * MB, document: 50 * MB }
/** Начиная с этого размера клиент грузит файл по частям (multipart). */
export const MULTIPART_FROM_BYTES = 20 * MB
/** Blob-префикс медиатеки: под /products/, чтобы работал same-origin прокси /product-media/. */
export const MEDIA_BLOB_PREFIX = 'products/library/'

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
}

/** MIME файла: из браузера, а если пусто (часто на мобильных) — по расширению. */
export function mimeOf(name: string, type: string): string | null {
  const t = type.trim().toLowerCase()
  if (MEDIA_TYPES[t]) return t
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return EXT_MIME[ext] ?? null
}

export function kindOf(mime: string): MediaKind | null {
  return MEDIA_TYPES[mime]?.kind ?? null
}

/** Проверка лимита. Возвращает код ошибки или null. */
export function checkMediaFile(mime: string | null, size: number, limits: MediaLimits = DEFAULT_MEDIA_LIMITS): string | null {
  if (!mime || !MEDIA_TYPES[mime]) return 'unsupported_type'
  if (!Number.isFinite(size) || size <= 0) return 'empty_file'
  if (size > limits[MEDIA_TYPES[mime].kind]) return 'file_too_large'
  return null
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** MIME по сигнатуре первых байтов (не доверяем расширению и Content-Type). */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf'
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') return ascii(b, 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  return null
}

/** Заявленный и фактический тип совместимы (mp4/mov — один контейнер ISO BMFF). */
export function sniffMatches(declared: string, sniffed: string | null): boolean {
  if (!sniffed) return false
  if (declared === sniffed) return true
  const iso = ['video/mp4', 'video/quicktime']
  return iso.includes(declared) && iso.includes(sniffed)
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/** Безопасное имя файла для пути в Blob: латиница, цифры, «-», «_», «.»; расширение — по MIME. */
export function safeFileName(name: string, mime: string): string {
  const ext = MEDIA_TYPES[mime]?.ext ?? 'bin'
  const stem = name.replace(/\.[^.]*$/, '').toLowerCase()
  const latin = [...stem].map((ch) => TRANSLIT[ch] ?? ch).join('')
  const clean = latin
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${clean || 'file'}.${ext}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** Путь файла в Blob. id = ключ идемпотентности (один файл в очереди → один id). */
export function mediaPathname(id: string, name: string, mime: string): string {
  return `${MEDIA_BLOB_PREFIX}${id}/${safeFileName(name, mime)}`
}

export function parseMediaPathname(pathname: string): { id: string; file: string } | null {
  if (!pathname.startsWith(MEDIA_BLOB_PREFIX)) return null
  const [id, file, ...rest] = pathname.slice(MEDIA_BLOB_PREFIX.length).split('/')
  if (rest.length || !isUuid(id) || !file || !/^[a-z0-9_-]+\.[a-z0-9]+$/.test(file)) return null
  return { id, file }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < MB) return `${(n / 1024).toFixed(0)} КБ`
  if (n < 1024 * MB) return `${(n / MB).toFixed(1).replace('.', ',')} МБ`
  return `${(n / 1024 / MB).toFixed(2).replace('.', ',')} ГБ`
}

/** Варианты изображения: ширина рамки для sharp. */
export const IMAGE_VARIANTS = { thumb: 320, medium: 960, large: 1920 } as const
export type ImageVariantName = keyof typeof IMAGE_VARIANTS

export interface MediaVariant {
  url: string
  width: number
  height: number
}
