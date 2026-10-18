import { useEffect, useId, useRef, useState } from 'react'
import { ROUTES } from '../../config/routes'
import { NAV_ITEMS } from '../../data/navigation'
import { CartIcon, CloseIcon, MenuIcon, UserIcon } from '../icons'
import { Logo } from './Logo'
import { SearchField } from './SearchField'
import styles from './Header.module.css'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Escape закрывает мобильное меню и возвращает фокус на кнопку.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.logo}>
          <Logo />
        </div>

        <nav className={styles.nav} aria-label="Основная навигация" data-open={menuOpen}>
          <ul id={menuId} className={styles.navList}>
            {NAV_ITEMS.map((item) => {
              const current = item.href === ROUTES.home
              return (
                <li key={item.href}>
                  <a
                    className={styles.navLink}
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={styles.search}>
          <SearchField />
        </div>

        <div className={styles.actions}>
          <a className={styles.iconButton} href={ROUTES.account} aria-label="Профиль">
            <UserIcon />
          </a>
          <a className={styles.iconButton} href={ROUTES.cart} aria-label="Корзина">
            <CartIcon />
          </a>
          <button
            ref={toggleRef}
            className={`${styles.iconButton} ${styles.burger}`}
            type="button"
            aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
    </header>
  )
}
