export interface AdminMedia {
  type: 'image' | 'video'
  src: string
  poster: string | null
  alt: string | null
  /** Компактная WebP-миниатюра для списка (может отсутствовать у старых отзывов). */
  thumbnailSrc?: string | null
}

export interface AdminReviewCard {
  id: string
  productId: string
  productName: string
  author: string | null
  textPreview: string
  photosCount: number
  videosCount: number
  mediaCount: number
  media: AdminMedia[]
  publishedAt: string | null
}

export interface AdminReviewDetail extends Omit<AdminReviewCard, 'textPreview'> {
  text: string
}

export type ApiErrorCode =
  | 'missing_init_data'
  | 'invalid_init_data'
  | 'expired_init_data'
  | 'forbidden'
  | 'unavailable'
  | 'not_found'
  | 'already_withdrawn'
  | 'invalid_photos'
  | 'invalid_videos'
  | 'invalid_limit'
  | 'invalid_offset'
  | 'invalid_id'
  | 'bot_not_configured'
  | 'moderators_not_configured'
  | 'empty_text'
  | 'text_too_long'
  | 'invalid_text'
  | 'author_too_long'
  | 'invalid_author'
  | 'unknown_product'
  | 'invalid_media'
  | 'empty_patch'
  | 'bad_request'
  | 'network'
  | 'aborted'
  | 'unknown'

export class AdminApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  constructor(status: number, code: ApiErrorCode) {
    super(code)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
  }
}

function headers(initData: string): HeadersInit {
  return {
    accept: 'application/json',
    'x-max-init-data': initData,
  }
}

async function parseError(response: Response): Promise<AdminApiError> {
  let code: ApiErrorCode = 'unknown'
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error && typeof body.error === 'string') code = body.error as ApiErrorCode
  } catch {
    /* ignore */
  }
  return new AdminApiError(response.status, code)
}

export async function fetchReviews(
  initData: string,
  params: { q: string; photos: string; videos: string; limit: number; offset: number },
  signal?: AbortSignal,
): Promise<{ total: number; reviews: AdminReviewCard[] }> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.photos !== '') qs.set('photos', params.photos)
  if (params.videos !== '') qs.set('videos', params.videos)
  qs.set('limit', String(params.limit))
  qs.set('offset', String(params.offset))
  let response: Response
  try {
    response = await fetch(`/api/admin/reviews?${qs}`, { headers: headers(initData), cache: 'no-store', signal })
  } catch (err) {
    // Устаревший поиск отменён более новым — это не ошибка для пользователя.
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw new AdminApiError(0, 'aborted')
    throw new AdminApiError(0, 'network')
  }
  if (!response.ok) throw await parseError(response)
  try {
    return (await response.json()) as { total: number; reviews: AdminReviewCard[] }
  } catch (err) {
    if (signal?.aborted) throw new AdminApiError(0, 'aborted')
    throw err
  }
}

export async function fetchReview(initData: string, id: string): Promise<AdminReviewDetail> {
  let response: Response
  try {
    response = await fetch(`/api/admin/reviews?id=${encodeURIComponent(id)}`, { headers: headers(initData) })
  } catch {
    throw new AdminApiError(0, 'network')
  }
  if (!response.ok) throw await parseError(response)
  const body = (await response.json()) as { review: AdminReviewDetail }
  return body.review
}

export async function withdrawReview(initData: string, id: string): Promise<'withdrawn' | 'already_withdrawn'> {
  let response: Response
  try {
    response = await fetch(`/api/admin/reviews?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headers(initData),
    })
  } catch {
    throw new AdminApiError(0, 'network')
  }
  if (response.status === 409) return 'already_withdrawn'
  if (!response.ok) throw await parseError(response)
  return 'withdrawn'
}

/** Лимиты как при приёме отзыва в боте (server/max/text.ts). */
export const REVIEW_TEXT_MAX = 2000
export const AUTHOR_MAX = 80

export interface ReviewEditInput {
  text?: string
  author?: string | null
  productId?: string
  removeMedia?: string[]
}

export async function fetchCatalog(initData: string): Promise<{ id: string; name: string }[]> {
  let response: Response
  try {
    response = await fetch('/api/admin/reviews?catalog=1', { headers: headers(initData) })
  } catch {
    throw new AdminApiError(0, 'network')
  }
  if (!response.ok) throw await parseError(response)
  const body = (await response.json()) as { products: { id: string; name: string }[] }
  return body.products
}

export async function editReview(initData: string, id: string, input: ReviewEditInput): Promise<AdminReviewDetail> {
  let response: Response
  try {
    response = await fetch(`/api/admin/reviews?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...headers(initData), 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new AdminApiError(0, 'network')
  }
  if (!response.ok) throw await parseError(response)
  const body = (await response.json()) as { review: AdminReviewDetail }
  return body.review
}

export function errorMessage(code: ApiErrorCode): string {
  switch (code) {
    case 'missing_init_data':
    case 'invalid_init_data':
    case 'expired_init_data':
      return 'Сессия MAX недействительна. Закройте окно и откройте снова из меню бота.'
    case 'forbidden':
      return 'Недостаточно прав. Нужен доступ модератора.'
    case 'unavailable':
    case 'bot_not_configured':
    case 'moderators_not_configured':
      return 'Сервис временно недоступен. Попробуйте позже.'
    case 'not_found':
      return 'Отзыв не найден или уже снят с сайта.'
    case 'already_withdrawn':
      return 'Отзыв уже снят с сайта.'
    case 'invalid_photos':
      return 'Количество фотографий: целое число от 0 до 100 или пусто.'
    case 'invalid_videos':
      return 'Количество видео: целое число от 0 до 100 или пусто.'
    case 'empty_text':
      return 'Текст отзыва не может быть пустым.'
    case 'text_too_long':
      return `Текст отзыва длиннее ${REVIEW_TEXT_MAX} символов.`
    case 'invalid_text':
      return 'Текст содержит недопустимые символы.'
    case 'author_too_long':
      return `Имя автора длиннее ${AUTHOR_MAX} символов.`
    case 'invalid_author':
      return 'Имя автора содержит недопустимые символы.'
    case 'unknown_product':
      return 'Такого товара нет в каталоге.'
    case 'empty_patch':
      return 'Нет изменений для сохранения.'
    case 'network':
      return 'Нет связи с сервером. Проверьте сеть и попробуйте снова.'
    default:
      return 'Не удалось выполнить запрос.'
  }
}
