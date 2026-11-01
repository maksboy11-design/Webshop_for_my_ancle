/** Фильтры страницы вебинаров: #webinars и #webinars?filter=doctors. */
export type WebinarFilter = 'all' | 'doctors'

export const WEBINAR_FILTERS: readonly { id: WebinarFilter; label: string; href: string }[] = [
  { id: 'all', label: 'Все вебинары', href: '#webinars' },
  { id: 'doctors', label: 'Вебинары с врачами', href: '#webinars?filter=doctors' },
]

export function webinarFilterFrom(params: URLSearchParams | undefined): WebinarFilter {
  return params?.get('filter') === 'doctors' ? 'doctors' : 'all'
}
