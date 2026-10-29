import { useState } from 'react'
import { BENEFITS, type BenefitIconName } from '../../data/hero'
import { DropIcon, HeartIcon, HomeIcon, LeafIcon } from '../icons'
import { WaterSurface, type WaterMode } from './water/WaterSurface'
import styles from './Benefits.module.css'

const ICONS: Record<BenefitIconName, typeof DropIcon> = {
  drop: DropIcon,
  leaf: LeafIcon,
  home: HomeIcon,
  heart: HeartIcon,
}

export function Benefits({ className }: { className?: string }) {
  // До загрузки текстур и без WebGL — статичная CSS-версия лужи.
  const [mode, setMode] = useState<WaterMode | 'pending'>('pending')

  return (
    <div className={`${styles.panel} ${className ?? ''}`} id="benefits" data-water={mode}>
      <WaterSurface className={styles.water} onModeChange={setMode} />
      <ul className={styles.list} aria-label="Преимущества">
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
    </div>
  )
}
