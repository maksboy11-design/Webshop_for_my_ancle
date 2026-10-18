import type { ReactNode } from 'react'
import type { AssetSlot } from '../../config/sceneAssets'
import styles from './ProductImage.module.css'

interface ProductImageProps {
  /** Настройки изображения из src/config/sceneAssets.ts. */
  slot: AssetSlot
  /** SVG-заглушка, пока slot.src === null. */
  placeholder: ReactNode
  className?: string
}

/**
 * Изображение с настраиваемым источником (src/alt/aspect-ratio). Размер контейнера задаёт родитель,
 * высота резервируется через aspect-ratio — подмена заглушки фото не вызывает скачков макета.
 */
export function ProductImage({ slot, placeholder, className }: ProductImageProps) {
  const classes = `${styles.frame} ${className ?? ''}`
  const style = { aspectRatio: String(slot.aspectRatio) }

  if (slot.src) {
    return (
      <img
        className={`${classes} ${styles.photo}`}
        src={slot.src}
        alt={slot.alt}
        style={style}
        decoding="async"
      />
    )
  }

  return (
    <span className={classes} style={style} role="img" aria-label={slot.alt} data-placeholder="true">
      {placeholder}
    </span>
  )
}
