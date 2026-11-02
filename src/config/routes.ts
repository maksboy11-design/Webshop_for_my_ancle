/**
 * Адреса страниц сайта.
 *
 * ВАЖНО: на этом этапе существует только первый экран, других страниц нет. Значения ниже — якоря-заглушки
 * (#...), а не реальные маршруты. Когда появятся страницы/роутер, замените их здесь, в одном месте.
 */
export const ROUTES = {
  home: '#top',
  catalog: '#catalog',
  videos: '#videos',
  webinars: '#webinars',
  /** Страница «Научные факты». */
  science: '#science',
  about: '#about',
  account: '#account',
  cart: '#cart',
  /** Поиск: пока ведёт на якорь каталога с параметром запроса. */
  search: (query: string) => `#catalog?q=${encodeURIComponent(query)}`,
} as const

/**
 * Адрес страницы флагмана (водородный генератор).
 * Карточки Hero/Scene предпочтительно берут ссылку через productHref(slug).
 */
/** CMS-страница «Как стать партнёром компании и получать скидки» (в меню — только после публикации). */
export const PARTNER_PAGE_SLUG = 'kak-stat-partnerom'

export const PRODUCT_PAGE_URL: string | null = '#product/flagship-device'
