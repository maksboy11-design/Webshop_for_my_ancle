import { useEffect, useId, useRef, useState } from 'react'
import { ROUTES } from '../../config/routes'
import { parseHash } from '../../config/hashRoute'
import { CartIcon, CloseIcon, MenuIcon, UserIcon } from '../icons'
import { Logo } from '../Header/Logo'
import { SearchField } from '../Header/SearchField'
import styles from './site.module.css'

const LINKS = [
  { label: 'Главная', href: ROUTES.home, page: 'home' },
  { label: 'Каталог', href: ROUTES.catalog, page: 'catalog' },
  { label: 'Видео', href: ROUTES.videos, page: 'videos' },
  { label: 'Вебинары', href: ROUTES.webinars, page: 'webinars' },
  { label: 'О бренде', href: ROUTES.about, page: 'about' },
  { label: 'Контакты', href: '#contacts', page: 'contacts' },
] as const

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const current = parseHash(typeof window === 'undefined' ? '' : window.location.hash).page

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Logo />
        <nav className={styles.nav} id={menuId} data-open={open} aria-label="Основная навигация">
          <ul className={styles.navList}>
            {LINKS.map((item) => (
              <li key={item.href}>
                <a
                  className={styles.navLink}
                  href={item.href}
                  aria-current={current === item.page ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.headerSearch}>
          <SearchField />
        </div>
        <a className={styles.iconBtn} href={ROUTES.account} aria-label="Профиль">
          <UserIcon />
        </a>
        <a className={styles.iconBtn} href={ROUTES.cart} aria-label="Корзина">
          <CartIcon />
        </a>
        <button
          ref={toggleRef}
          className={`${styles.iconBtn} ${styles.burger}`}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>
    </header>
  )
}
