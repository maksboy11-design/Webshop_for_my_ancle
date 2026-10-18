import { BENEFITS, type BenefitIconName } from '../../data/hero'
import { DropIcon, HeartIcon, HomeIcon, LeafIcon } from '../icons'
import styles from './Benefits.module.css'

const ICONS: Record<BenefitIconName, typeof DropIcon> = {
  drop: DropIcon,
  leaf: LeafIcon,
  home: HomeIcon,
  heart: HeartIcon,
}

export function Benefits({ className }: { className?: string }) {
  return (
    <ul className={`${styles.list} ${className ?? ''}`} aria-label="Преимущества" id="benefits">
      {BENEFITS.map((benefit) => {
        const Icon = ICONS[benefit.icon]
        return (
          <li key={benefit.title} className={styles.item}>
            <span className={styles.icon}>
              <Icon size="1.5rem" />
            </span>
            <span className={styles.text}>
              <span className={styles.title}>{benefit.title}</span>
              <span className={styles.note}>{benefit.note}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
