import type { ExtrasPayload, ExtrasView } from '../cms/richBlocks'
/** Общий клиент админ-API для разделов «Товары» и «Вебинары». initData — только в заголовке, нигде не хранится. */
import type { ProductImage } from '../data/products'
import type { ProductPrice } from '../data/price'
import type { DescriptionDoc } from '../cms/descriptionDoc'
import type { AnyDescription } from '../cms/descriptionDoc'

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

/** Админ-сессия (≤12 ч от входа из MAX): токен в памяти вкладки, продлевается, пока админка открыта. */
let session: { token: string; exp: number } | null = null
const sessionListeners = new Set<() => void>()
export const adminSessionExp = (): number | null => session?.exp ?? null
export function onAdminSessionChange(fn: () => void): () => void {
  sessionListeners.add(fn)
  return () => sessionListeners.delete(fn)
}
export function setAdminSession(s: { token: string; exp: number } | null): void {
  session = s
  for (const fn of sessionListeners) fn()
}

/** Получить/продлить сессию сейчас и затем каждые 15 мин (и при возвращении во вкладку). */
export function startAdminSession(initData: string): () => void {
  let stopped = false
  const refresh = async () => {
    if (stopped || !initData) return
    try {
      const r = await adminRequest<{ token: string; exp: number }>(initData, '/api/admin/pages?session=1', { method: 'POST', json: {} })
      if (!stopped && r?.token) setAdminSession({ token: r.token, exp: r.exp })
    } catch {
      /* сеть/истечение: следующий запрос покажет понятную ошибку */
    }
  }
  void refresh()
  const t = setInterval(() => void refresh(), 15 * 60_000)
  const vis = () => document.visibilityState === 'visible' && void refresh()
  document.addEventListener('visibilitychange', vis)
  return () => {
    stopped = true
    clearInterval(t)
    document.removeEventListener('visibilitychange', vis)
  }
}

export function adminAuthHeaders(initData: string): Record<string, string> {
  const h: Record<string, string> = { 'x-max-init-data': initData }
  if (session && session.exp * 1000 > Date.now()) h['x-admin-session'] = session.token
  return h
}

interface RequestOptions {
  method?: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE'
  json?: unknown
  raw?: Blob
  signal?: AbortSignal
  /** Запрос переживает закрытие/перезагрузку страницы (fetch keepalive, тело ≤ 64 КБ). */
  keepalive?: boolean
}

export async function adminRequest<T>(initData: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...adminAuthHeaders(initData) }
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
    response = await fetch(url, { method: opts.method ?? 'GET', headers, body, cache: 'no-store', signal: opts.signal, keepalive: opts.keepalive })
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
  file_too_large: 'Файл слишком большой.',
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
  conflict: 'Черновик описания изменён в другом окне. Загружена свежая версия — проверьте и повторите.',
  content_unavailable: 'Черновики описаний ещё не включены на сервере (нужна миграция 007).',
  no_draft: 'Сначала сохраните черновик описания.',
  media_unavailable: 'Медиатека ещё не включена на сервере (нужна миграция 008).',
  processing_unavailable: 'Обработка изображений временно недоступна. Файл сохранён.',
  unsupported_type: 'Тип файла не поддерживается: JPEG, PNG, WebP, MP4, WebM, MOV или PDF.',
  signature_mismatch: 'Содержимое файла не совпадает с расширением — файл отклонён.',
  in_use: 'Файл используется в товарах. Сначала отвяжите его.',
  in_use_content: 'Файл используется в блоках описания или на странице. Сначала уберите его там.',
  not_trashed: 'Удалить навсегда можно только файл из корзины.',
  duplicate_exists: 'Такой же файл уже есть в медиатеке.',
  one_main_only: 'Главным может быть только одно фото.',
  not_image: 'В галерею товара можно добавить только изображения.',
  not_document: 'В документы товара можно добавить только PDF.',
  media_missing: 'Файл удалён из медиатеки. Обновите галерею.',
  duplicate_item: 'Этот файл уже есть в галерее.',
  bad_pathname: 'Некорректное имя файла.',
  bad_blob_url: 'Некорректный адрес загруженного файла.',
  aborted: 'Отменено.',
  pages_unavailable: 'Раздел «Страницы» ещё не включён на сервере (нужна миграция 010).',
  status_invalid: 'Некорректный статус товара.',
  ids_invalid: 'Выберите от 1 до 50 товаров.',
  op_invalid: 'Неизвестная пакетная операция.',
  trashed: 'Товар в корзине — сначала восстановите.',
  id_taken: 'Такой идентификатор уже занят.',
  version_missing: 'Версия не найдена.',
  keep_days_invalid: 'Срок хранения: от 1 до 365 дней.',
  slug_taken: 'Такой адрес уже занят другой страницей.',
  invalid_slug: 'Адрес: латиница в нижнем регистре, цифры и дефис (некоторые слова зарезервированы).',
  empty_title: 'Укажите название страницы.',
  self_link: 'Кнопка не может вести на эту же страницу.',
  referenced: 'На эту страницу ведут кнопки других страниц.',
  empty_button: 'У кнопки должен быть текст.',
  external_not_allowed: 'Внешние ссылки в кнопках не поддерживаются — выберите страницу сайта.',
  invalid_url: 'Некорректная ссылка.',
  too_many: 'Слишком много элементов на странице.',
  unknown_type: 'Неизвестный тип элемента.',
}

export function adminErrorText(err: unknown): string {
  const e = err instanceof AdminHttpError ? err : new AdminHttpError(0, 'unknown')
  const known = MESSAGES[e.code]
  if (known) return known
  const field = e.field ? (FIELD_LABELS[e.field] ?? e.field) : null
  if (e.status === 400 && field) return `Проверьте поле «${field}» (${e.code}).`
  if (e.status === 400) return `Некорректные данные (${e.code}).`
  return 'Не удалось выполнить запрос.'
}

/* ---------- Товары ---------- */

export interface AdminProductListItem {
  id: string
  slug: string
  brand: string
  brandId?: string
  category: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  overridden: string[]
  updatedAt: string | null
  status?: string | null
  deletedAt?: string | null
  draftRev?: number
  tags?: string[]
  badges?: string[]
}

export interface PublicProductFields {
  id: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  gallery: ProductImage[]
  description: AnyDescription | null
}

export interface AdminProductDetail extends AdminProductListItem {
  merged: PublicProductFields
  base: PublicProductFields
}

export type ProductSet = Partial<Omit<PublicProductFields, 'id'>>

/** Черновик/публикация описания (product_content). draftRev 0 — черновика ещё нет. */
export interface ProductContentView {
  productId: string
  draftDoc: DescriptionDoc | null
  hasDraft: boolean
  publishedDoc: DescriptionDoc | null
  hasPublished: boolean
  status: string | null
  draftRev: number
  publishedRev: number | null
  updatedAt: string | null
  publishedAt: string | null
  deletedAt?: string | null
  draftCard?: Record<string, unknown>
  publishedCard?: Record<string, unknown> | null
  draftExtras?: ExtrasView
  publishedExtras?: ExtrasView | null
}

export interface ProductVersionInfo {
  rev: number
  reason: string
  restoredFromRev: number | null
  createdAt: string
  createdByUserId: string | null
}

export type BulkOp =
  | 'set_status'
  | 'set_category'
  | 'set_brand'
  | 'add_tags'
  | 'remove_tags'
  | 'set_badges'
  | 'archive'
  | 'trash'
  | 'restore'
  | 'publish'
  | 'unpublish'

export interface BulkResult {
  ok: string[]
  failed: { id: string; error: string }[]
  total: number
}

export const productsApi = {
  list: (initData: string, opts?: { signal?: AbortSignal; trash?: boolean; status?: string; q?: string }) => {
    const sp = new URLSearchParams()
    if (opts?.trash) sp.set('trash', '1')
    if (opts?.status) sp.set('status', opts.status)
    if (opts?.q) sp.set('q', opts.q)
    const qs = sp.toString()
    return adminRequest<{
      editable: boolean
      total: number
      products: AdminProductListItem[]
      trashRetentionDays?: number
      cronCleanup?: boolean
    }>(initData, `/api/admin/products${qs ? `?${qs}` : ''}`, { signal: opts?.signal })
  },
  get: (initData: string, id: string) =>
    adminRequest<{ editable: boolean; product: AdminProductDetail & { content?: ProductContentView } }>(
      initData,
      `/api/admin/products?id=${encodeURIComponent(id)}`,
    ),
  patch: (initData: string, id: string, patch: { set?: ProductSet; reset?: string[] }) =>
    adminRequest<{ editable: boolean; product: AdminProductDetail }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: patch,
    }),
  content: (initData: string, id: string) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&content=1`),
  saveDraft: (initData: string, id: string, doc: DescriptionDoc, rev: number) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&content=1`, {
      method: 'PUT',
      json: { doc, rev },
    }),
  saveCard: (initData: string, id: string, card: Record<string, unknown>, rev: number) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&content=1&card=1`, {
      method: 'PUT',
      json: { card, rev },
    }),
  saveExtras: (initData: string, id: string, payload: ExtrasPayload, rev: number) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&content=1&extras=1`, {
      method: 'PUT',
      json: { ...payload, rev },
    }),
  publish: (initData: string, id: string, rev: number) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&publish=1`, {
      method: 'POST',
      json: { rev },
    }),
  setStatus: (initData: string, id: string, status: string) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&status=1`, {
      method: 'POST',
      json: { status },
    }),
  trash: (initData: string, id: string) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&trash=1`, {
      method: 'POST',
      json: {},
    }),
  restore: (initData: string, id: string) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&restore=1`, {
      method: 'POST',
      json: {},
    }),
  purge: (initData: string, id: string) =>
    adminRequest<{ ok: boolean }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&purge=1`, { method: 'DELETE' }),
  purgeExpired: (initData: string, keepDays = 30) =>
    adminRequest<{ purged: string[]; keepDays: number }>(initData, '/api/admin/products?purgeExpired=1', {
      method: 'POST',
      json: { keepDays },
    }),
  bulk: (initData: string, ids: string[], op: BulkOp, extra: Record<string, unknown> = {}) =>
    adminRequest<BulkResult>(initData, '/api/admin/products?bulk=1', { method: 'POST', json: { ids, op, ...extra } }),
  duplicate: (initData: string, id: string, parts?: { card?: boolean; content?: boolean; media?: boolean; documents?: boolean }) =>
    adminRequest<{ id: string; content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&duplicate=1`, {
      method: 'POST',
      json: { parts },
    }),
  versions: (initData: string, id: string) =>
    adminRequest<{ versions: ProductVersionInfo[] }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&versions=1`),
  restoreVersion: (initData: string, id: string, rev: number) =>
    adminRequest<{ content: ProductContentView }>(initData, `/api/admin/products?id=${encodeURIComponent(id)}&restoreVersion=${rev}`, {
      method: 'POST',
      json: {},
    }),
  preview: (initData: string, id: string) =>
    adminRequest<{ preview: PublicProductFields; unpublished: boolean }>(
      initData,
      `/api/admin/products?id=${encodeURIComponent(id)}&preview=1`,
    ),
  checklist: (initData: string, id: string) =>
    adminRequest<{ items: { id: string; severity: 'error' | 'warn'; field: string; message: string }[]; errors: number; warns: number; ok: boolean }>(
      initData,
      `/api/admin/products?id=${encodeURIComponent(id)}&checklist=1`,
    ),
  cmsSearch: (
    initData: string,
    params: {
      q?: string
      category?: string
      brand?: string
      status?: string
      type?: string
      createdFrom?: string
      createdTo?: string
      updatedFrom?: string
      updatedTo?: string
      scope?: 'all' | 'products' | 'media'
      page?: number
      limit?: number
    },
    signal?: AbortSignal,
  ) => {
    const sp = new URLSearchParams({ cmsSearch: '1' })
    if (params.q) sp.set('q', params.q)
    if (params.category) sp.set('category', params.category)
    if (params.brand) sp.set('brand', params.brand)
    if (params.status) sp.set('status', params.status)
    if (params.type) sp.set('type', params.type)
    if (params.createdFrom) sp.set('createdFrom', params.createdFrom)
    if (params.createdTo) sp.set('createdTo', params.createdTo)
    if (params.updatedFrom) sp.set('updatedFrom', params.updatedFrom)
    if (params.updatedTo) sp.set('updatedTo', params.updatedTo)
    if (params.scope) sp.set('scope', params.scope)
    if (params.page) sp.set('page', String(params.page))
    if (params.limit) sp.set('limit', String(params.limit))
    return adminRequest<{
      total: number
      page: number
      limit: number
      items: (
        | {
            kind: 'product'
            id: string
            name: string
            brand: string
            category: string
            status: string | null
            updatedAt: string | null
            sku: string
          }
        | {
            kind: 'media'
            id: string
            name: string
            title: string | null
            mediaKind: string
            mime: string
            status: string
            createdAt: string
          }
      )[]
    }>(initData, `/api/admin/products?${sp}`, { signal })
  },
  activity: (
    initData: string,
    params: { userId?: string; action?: string; entityType?: string; from?: string; to?: string; page?: number; limit?: number },
    signal?: AbortSignal,
  ) => {
    const sp = new URLSearchParams({ activity: '1' })
    if (params.userId) sp.set('userId', params.userId)
    if (params.action) sp.set('action', params.action)
    if (params.entityType) sp.set('entityType', params.entityType)
    if (params.from) sp.set('from', params.from)
    if (params.to) sp.set('to', params.to)
    if (params.page) sp.set('page', String(params.page))
    if (params.limit) sp.set('limit', String(params.limit))
    return adminRequest<{
      total: number
      page: number
      limit: number
      items: {
        id: string
        at: string
        userId: string | null
        action: string
        entityType: string
        entityId: string | null
        details: Record<string, unknown>
      }[]
    }>(initData, `/api/admin/products?${sp}`, { signal })
  },
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
