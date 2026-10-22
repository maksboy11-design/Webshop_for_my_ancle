import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import styles from './motion.module.css'

/** Появление и исчезновение через opacity. */
export function Fade({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div className={styles.fade} data-state={shown ? 'shown' : 'hidden'}>
      {children}
    </div>
  )
}

/** Подъём карточки или кнопки при наведении. */
export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.rise} ${className ?? ''}`}>{children}</div>
}

/** Короткий отклик нажатия. */
export function Press({
  children,
  className,
  inline,
}: {
  children: ReactNode
  className?: string
  inline?: boolean
}) {
  return <div className={`${styles.press} ${inline ? styles.inline : ''} ${className ?? ''}`}>{children}</div>
}

/** Появление блока, когда он входит в экран. Один наблюдатель на компонент. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const node = ref.current
    if (!node || shown) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown(true)
      },
      { threshold: 0.12 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [shown])

  return (
    <div ref={ref} className={`${styles.reveal} ${className ?? ''}`} data-state={shown ? 'shown' : 'hidden'}>
      {children}
    </div>
  )
}

/** Нижняя панель. Открытие — смена присутствия в дереве, анимация только у этого типа. */
export function Sheet({
  open,
  titleId,
  onClose,
  children,
}: {
  open: boolean
  titleId?: string
  onClose: () => void
  children: ReactNode
}) {
  const label = useId()
  if (!open) return null
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId ?? label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
