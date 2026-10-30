import { useState } from 'react'
import { BENEFITS, type Benefit, type BenefitIconName } from '../../data/hero'
import { productHref } from '../../config/hashRoute'
import { ROUTES } from '../../config/routes'
import { DropIcon, HeartIcon, HomeIcon, LeafIcon } from '../icons'
import { WaterSurface, type WaterMode } from './water/WaterSurface'
import styles from './Benefits.module.css'

const ICONS: Record<BenefitIconName, typeof DropIcon> = {
  drop: DropIcon,
  leaf: LeafIcon,
  home: HomeIcon,
  heart: HeartIcon,
}

/** Централизованное соответствие назначения → href (productHref / ROUTES). */
export function benefitHref(benefit: Benefit): string {
  const { destination } = benefit
  if (destination.kind === 'product') return productHref(destination.slug)
  return ROUTES[destination.id]
}

export function Benefits({ className }: { className?: string }) {
  // До загрузки текстур и без WebGL — статичная CSS-версия лужи.
  const [mode, setMode] = useState<WaterMode | 'pending'>('pending')

  return (
    <div className={`${styles.panel} ${className ?? ''}`} id="benefits" data-water={mode}>
      <WaterSurface className={styles.water} onModeChange={setMode} />
      <ul className={styles.list} aria-label="Разделы">
        {BENEFITS.map((benefit) => {
          const Icon = ICONS[benefit.icon]
          const href = benefitHref(benefit)
          return (
            <li key={benefit.title} className={styles.item}>
              <a className={styles.link} href={href}>
                <span className={styles.icon} aria-hidden="true">
                  <Icon size="1.5rem" />
                </span>
                <span className={styles.title}>{benefit.title}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
