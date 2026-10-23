import type { ReactNode } from 'react'
import styles from './glass.module.css'

/** Полупрозрачная панель. Радиус задаёт вызывающий класс. */
export function GlassPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`${styles.panel} ${className ?? ''}`}>{children}</div>
}
