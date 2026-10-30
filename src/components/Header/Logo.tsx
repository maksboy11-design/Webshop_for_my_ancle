import { BRAND } from '../../config/brand'
import { ROUTES } from '../../config/routes'
import styles from './Logo.module.css'

export function Logo({ place = 'header' }: { place?: 'header' | 'footer' }) {
  return (
    <a className={styles.logo} href={ROUTES.home} aria-label={place === 'footer' ? BRAND.name : BRAND.homeLabel}>
      <picture>
        <source type="image/webp" srcSet={BRAND.logo.webp} />
        <img
          className={place === 'footer' ? styles.footerImg : styles.img}
          src={BRAND.logo.src}
          alt={BRAND.logo.alt}
          width={BRAND.logo.width}
          height={BRAND.logo.height}
          decoding="async"
          fetchPriority={place === 'header' ? 'high' : 'auto'}
        />
      </picture>
    </a>
  )
}
