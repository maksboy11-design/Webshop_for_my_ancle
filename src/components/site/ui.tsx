import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useId, useState } from 'react'
import styles from './site.module.css'

type Variant = 'primary' | 'secondary' | 'soft'

export function Button({
  variant = 'primary',
  block,
  className,
  href,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  block?: boolean
  href?: string
}) {
  const cls = `${styles.btn} ${styles[variant]} ${block ? styles.block : ''} ${className ?? ''}`
  if (href && !disabled) {
    return (
      <a className={cls} href={href}>
        {children}
      </a>
    )
  }
  return (
    <button className={cls} disabled={disabled} type="button" {...rest}>
      {children}
    </button>
  )
}

export function Chip({
  pressed,
  href,
  children,
  onClick,
}: {
  pressed?: boolean
  href?: string
  children: ReactNode
  onClick?: () => void
}) {
  if (href) {
    return (
      <a className={styles.chip} href={href} aria-current={pressed ? 'true' : undefined}>
        {children}
      </a>
    )
  }
  return (
    <button className={styles.chip} type="button" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className={styles.tag}>{children}</span>
}

export function Accordion({
  items,
  initiallyOpen = 0,
}: {
  items: readonly { id: string; title: string; body: ReactNode }[]
  initiallyOpen?: number | null
}) {
  const [open, setOpen] = useState<number | null>(initiallyOpen)
  const base = useId()
  return (
    <div className={styles.accList}>
      {items.map((item, index) => {
        const panelId = `${base}-${item.id}`
        const expanded = open === index
        return (
          <div key={item.id}>
            <button
              className={styles.accButton}
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : index)}
            >
              <span>{item.title}</span>
              <span aria-hidden="true">{expanded ? '–' : '+'}</span>
            </button>
            {expanded && (
              <div className={styles.accPanel} id={panelId} role="region">
                {item.body}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
