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
  about: '#about',
  account: '#account',
  cart: '#cart',
  /** Поиск: пока ведёт на якорь каталога с параметром запроса. */
  search: (query: string) => `#catalog?q=${encodeURIComponent(query)}`,
} as const

/**
 * Адрес страницы товара. Страницы товара пока нет → null.
 * Пока значение null, кнопка «Перейти в карточку» остаётся кнопкой с aria-disabled и честно сообщает,
 * что страница ещё не подключена. ТРЕБУЕТСЯ ПОДТВЕРДИТЬ АДРЕС (например, '/catalog/hydrogen-water-device').
 */
export const PRODUCT_PAGE_URL: string | null = null
