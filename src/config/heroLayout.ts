/**
 * Раскладка первого экрана поверх чистого природного фона.
 *
 * Фон — исходный файл public/hero-nature.jpg (1024×682), без фильтров и перерисовки.
 * Координаты слоёв — в пикселях этого файла; в CSS они переводятся в проценты и
 * следуют за кадром, пока сцена показывает изображение целиком.
 */
export const HERO_IMAGE = {
  src: '/hero-nature.jpg',
  width: 1024,
  height: 682,
  /** SHA-256 оригинального файла природы (проверяется в e2e). */
  sha256: '96e00a6092590ef26475be76e0b06953fee591e104556fe43c6395640b32a546',
} as const

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Слои продукции на каменном уступе справа.
 * Основания флаконов, стакана и рукоятки стоят на верхней плоскости камня.
 * Прямоугольники совпадают с пропорциями вырезанных PNG, чтобы object-fit: contain
 * не оставлял пустых полей.
 */
export const LAYER_RECTS = {
  magnesium: { x: 512, y: 388, w: 66, h: 130 },
  vitamin: { x: 584, y: 400, w: 77, h: 120 },
  device: { x: 656, y: 236, w: 205, h: 298 },
  glass: { x: 868, y: 416, w: 64, h: 104 },
  omega: { x: 938, y: 396, w: 59, h: 124 },
  capsules: { x: 700, y: 496, w: 75, h: 36 },
} as const satisfies Record<string, Rect>

/**
 * Живая карточка в просвете неба между колонкой текста и прибором.
 * Не накрывает заголовок, прибор и флаконы.
 */
export const CARD_RECT: Rect = { x: 408, y: 20, w: 210, h: 210 }

const W = HERO_IMAGE.width
const H = HERO_IMAGE.height

const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`

/** Абсолютная зона от левого верхнего угла, в процентах от кадра. */
export function boxStyle(rect: Rect) {
  return {
    left: pct(rect.x, W),
    top: pct(rect.y, H),
    width: pct(rect.w, W),
    height: pct(rect.h, H),
  }
}

export function cardStyle(rect: Rect) {
  return boxStyle(rect)
}
