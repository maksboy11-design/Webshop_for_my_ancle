import { ROUTES } from '../../config/routes'
import styles from './Logo.module.css'

function LogoMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M20 8.500c4.600 5.800 7 9.700 7 13.200a7 7 0 0 1-14 0c0-3.500 2.400-7.400 7-13.200Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M20 31V19m0 4 4-3.500M20 26.500l-3.500-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <a className={styles.logo} href={ROUTES.home} aria-label="SILKWAY — на главную">
      <LogoMark />
      <span className={styles.word} aria-hidden="true">
        SILKWAY
      </span>
    </a>
  )
}
