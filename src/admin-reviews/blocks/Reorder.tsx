import { useState, type ReactNode } from 'react'
import m from '../media/Media.module.css'
import { moveItem } from './listOps'

/**
 * Список с перестановкой: перетаскивание за ручку + кнопки ↑/↓ (для телефона и клавиатуры).
 * Переиспользуется блоками товара, видео и редактором страниц.
 */
export function ReorderList<T>({
  items,
  keyOf,
  label,
  onChange,
  render,
  testId,
  disabled,
}: {
  items: readonly T[]
  keyOf: (x: T) => string
  label: (x: T, i: number) => string
  onChange: (next: T[]) => void
  render: (x: T, i: number, controls: ReactNode) => ReactNode
  testId?: string
  disabled?: boolean
}) {
  const [drag, setDrag] = useState<number | null>(null)
  return (
    <ul className={m.gList} data-testid={testId}>
      {items.map((x, i) => {
        const controls = (
          <>
            <span
              className={m.dragHandle}
              draggable={!disabled}
              aria-hidden="true"
              title="Перетащите"
              onDragStart={(e) => {
                setDrag(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
              }}
              onDragEnd={() => setDrag(null)}
            >
              ⋮⋮
            </span>
            <button
              type="button"
              className={m.iconBtn}
              aria-label={`${label(x, i)}: выше`}
              disabled={disabled || i === 0}
              onClick={() => onChange(moveItem(items, i, i - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className={m.iconBtn}
              aria-label={`${label(x, i)}: ниже`}
              disabled={disabled || i === items.length - 1}
              onClick={() => onChange(moveItem(items, i, i + 1))}
            >
              ↓
            </button>
          </>
        )
        return (
          <li
            key={keyOf(x)}
            className={m.gItem}
            style={{ alignItems: 'start', flexWrap: 'wrap' }}
            onDragOver={(e) => {
              if (drag === null) return
              e.preventDefault()
            }}
            onDrop={(e) => {
              if (drag === null) return
              e.preventDefault()
              onChange(moveItem(items, drag, i))
              setDrag(null)
            }}
          >
            {render(x, i, controls)}
          </li>
        )
      })}
    </ul>
  )
}
