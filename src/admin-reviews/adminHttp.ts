/** Общий клиент админ-API для разделов «Товары» и «Вебинары». initData — только в заголовке, нигде не хранится. */
import type { ProductImage } from '../data/products'
import type { ProductPrice } from '../data/price'
import type { ProductDescription } from '../data/productDescriptions'

export class AdminHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null
  readonly body: Record<string, unknown>
  constructor(status: number, code: string, body: Record<string, unknown> = {}) {
    super(code)
    this.name = 'AdminHttpError'
    this.status = status
    this.code = code
    this.field = typeof body.field === 'string' ? body.field : null
    this.body = body
  }
}

interface RequestOptions {
  method?: 'GET' | 'PATCH' | 'POST' | 'DELETE'
  json?: unknown
  raw?: Blob
  signal?: AbortSignal
}

export async function adminRequest<T>(initData: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-max-init-data': initData }
  let body: BodyInit | undefined
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.raw) {
    headers['content-type'] = opts.raw.type
    body = opts.raw
  }
  let response: Response
  try {
    response = await fetch(url, { method: opts.method ?? 'GET', headers, body, cache: 'no-store', signal: opts.signal })
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw new AdminHttpError(0, 'aborted')
    throw new AdminHttpError(0, 'network')
  }
  let parsed: Record<string, unknown> = {}
  try {
    parsed = (await response.json()) as Record<string, unknown>
  } catch {
    if (opts.signal?.aborted) throw new AdminHttpError(0, 'aborted')
    if (response.ok) throw new AdminHttpError(response.status, 'bad_response')
  }
  if (!response.ok) {
    const code = typeof parsed.error === 'string' ? parsed.error : `http_${response.status}`
    throw new AdminHttpError(response.status, code, parsed)
  }
  return parsed as T
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  pack: 'Фасовка',
  price: 'Цена',
  image: 'Главное фото',
  gallery: 'Галерея',
  description: 'Описание',
  title: 'Название',
  speaker: 'Спикер',
  date: 'Дата',
  source: 'Источник',
  startSeconds: 'Время начала',
}

const MESSAGES: Record<string, string> = {
  missing_init_data: 'Сессия MAX недействительна. Закройте окно и откройте снова из меню бота.',
  invalid_init_data: 'Сессия MAX недействительна. Закройте окно и откройте снова из меню бота.',
  expired_init_data: 'Сессия MAX устарела. Закройте окно и откройте снова из меню бота.',
  forbidden: 'Недостаточно прав. Нужен доступ модератора.',
  network: 'Нет связи с сервером. Данные формы сохранены — попробуйте ещё раз.',
  not_found: 'Запись не найдена.',
  overrides_unavailable: 'Редактирование товаров ещё не включено на сервере (нужна миграция 005). Сайт работает на базовом каталоге.',
  storage_not_configured: 'Хранилище изображений не настроено на сервере.',
  image_processing_unavailable: 'Обработка изображений временно недоступна.',
  file_too_large: 'Файл слишком большой (максимум 4 МБ).',
  empty_file: 'Пустой файл.',
  unsupported_image_type: 'Поддерживаются только JPEG, PNG и WebP.',
  image_too_many_pixels: 'Слишком большое разрешение изображения.',
  image_decode_failed: 'Файл не похож на изображение или повреждён.',
  stale: 'Запись изменилась в другом окне. Обновите её и повторите правку.',
  not_editable: 'Эту запись нельзя редактировать (она снята или отклонена).',
  duplicate_video: 'Это видео уже используется в другой записи.',
  verification_failed: 'Проверка видео не пройдена — опубликованная запись не изменена.',
  youtube_url_invalid: 'Нужна ссылка YouTube или 11-символьный id видео.',
  hosted_src_invalid: 'Файл записи должен быть https-ссылкой на хранилище сайта.',
  title_required: 'Укажите название.',
  date_invalid: 'Дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ.',
  start_invalid: 'Время начала: например 1:30 или 1:02:03.',
  unavailable: 'Сервис временно недоступен. Попробуйте позже.',
  bad_request: 'Некорректный запрос.',
}

export function adminErrorText(err: unknown): string {
  const e = err instanceof AdminHttpError ? err : new AdminHttpError(0, 'unknown')
  const known = MESSAGES[e.code]
  if (known) return known
  const field = e.field ? FIELD_LABELS[e.field] ?? e.field : null
  if (e.status === 400 && field) return `Проверьте поле «${field}» (${e.code}).`
  if (e.status === 400) return `Некорректные данные (${e.code}).`
  return 'Не удалось выполнить запрос.'
}

/* ---------- Товары ---------- */

export interface AdminProductListItem {
  id: string
  slug: string
  brand: string
  category: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  overridden: string[]
  updatedAt: string | null
}

export interface PublicProductFields {
  id: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  gallery: ProductImage[]
  description: ProductDescription | null
}

export interface AdminProductDetail extends AdminProductListItem {
  merged: PublicProductFields
  base: PublicProductFields
}

export type ProductSet = Partial<Omit<PublicProductFields, 'id'>>

export const productsApi = {
  list: (initData: string, signal?: AbortSignal) =>
    adminRequest<{ editable: boolean; total: number; products: AdminProductListItem[] }>(initData, '/api/admin/products', { signal }),
  get: (initData: string, id: string) =>
    adminRequest<{ editable: boolean; product: AdminProductDetail }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}`),
  patch: (initData: string, id: string, patch: { set?: ProductSet; reset?: string[] }) =>
    adminRequest<{ editable: boolean; product: AdminProductDetail }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: patch,
    }),
  upload: (initData: string, id: string, file: Blob) =>
    adminRequest<{ image: ProductImage }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&upload=1`, {
      method: 'POST',
      raw: file,
    }),
}

/* ---------- Вебинары ---------- */

export type WebinarStatus = 'pending' | 'published' | 'withdrawn' | 'rejected'

export interface AdminWebinar {
  id: string
  status: WebinarStatus
  title: string
  speaker: string | null
  date: string | null
  sourceType: 'youtube' | 'hosted'
  youtubeVideoId: string | null
  startSeconds: number | null
  recordingSrc: string | null
  youtubeTitle: string | null
  metadataStatus: string | null
  metadataText: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  withdrawnAt: string | null
  fromGroup: boolean
}

export interface WebinarEditInput {
  title: string
  speaker: string | null
  date: string | null
  startSeconds: string | null
  source: { type: 'youtube'; url: string } | { type: 'hosted'; src: string }
  recheck: boolean
  expectedUpdatedAt: string
}

export const webinarsApi = {
  list: (initData: string, params: { status: string; q: string; offset: number; limit: number }, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ status: params.status, limit: String(params.limit), offset: String(params.offset) })
    if (params.q) qs.set('q', params.q)
    return adminRequest<{ total: number; webinars: AdminWebinar[] }>(initData, `/api/admin/webinars?${qs}`, { signal })
  },
  get: (initData: string, id: string) =>
    adminRequest<{ webinar: AdminWebinar }>(initData, `/api/admin/webinars?id=${encodeURIComponent(id)}`),
  patch: (initData: string, id: string, input: WebinarEditInput) =>
    adminRequest<{ webinar: AdminWebinar }>(initData, `/api/admin/webinars?id=${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),
  remove: (initData: string, id: string) =>
    adminRequest<{ ok: true; status: WebinarStatus; already?: boolean }>(initData, `/api/admin/webinars?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}

export const WEBINAR_STATUS_LABEL: Record<WebinarStatus, string> = {
  pending: 'Ожидает',
  published: 'Опубликован',
  withdrawn: 'Снят',
  rejected: 'Отклонён',
}
