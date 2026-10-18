import { ROUTES } from '../config/routes'

export interface NavItem {
  label: string
  href: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Главная', href: ROUTES.home },
  { label: 'Каталог', href: ROUTES.catalog },
  { label: 'Видео', href: ROUTES.videos },
  { label: 'Вебинары', href: ROUTES.webinars },
  { label: 'О бренде', href: ROUTES.about },
]
