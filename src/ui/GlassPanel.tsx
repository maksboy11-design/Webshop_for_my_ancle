import type { ReactNode } from 'react'
import styles from './glass.module.css'

/** Полупрозрачная панель. Радиус задаёт вызывающий класс. */
export function GlassPanel({
  className,
  children,
  testId,
}: {
  className?: string
  children: ReactNode
  testId?: string
}) {
  return (
    <div className={`${styles.panel} ${className ?? ''}`} data-testid={testId}>
      {children}
    </div>
  )
}
