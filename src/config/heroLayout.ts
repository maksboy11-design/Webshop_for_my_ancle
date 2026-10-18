/**
 * Раскладка первого экрана поверх неизменного фонового изображения.
 *
 * Фон — исходный файл-референс HALOS (public/halos-hero-reference.png), подключается как есть:
 * без фильтров, градиентов, затемнений и размытия. Все координаты ниже — в пикселях ИСХОДНОГО
 * изображения (1535 × 1024); в CSS они переводятся в проценты, поэтому слои точно следуют за
 * фоном на любой ширине. Чтобы подстроить зону — меняйте только числа здесь.
 */
export const HERO_IMAGE = {
  src: '/halos-hero-reference.png',
  width: 1535,
  height: 1024,
  /** SHA-256 оригинального файла (проверяется в e2e-тесте). */
  sha256: '0b9361601bc7bd29336d32cbe00e38b84ebc66e8176865044f9780638157d328',
} as const

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Интерактивные зоны над вшитыми в фон объектами (в покое полностью прозрачные). */
export const HOTSPOTS = {
  logo: { x: 70, y: 22, w: 165, h: 46 },
  nav: {
    home: { x: 402, y: 28, w: 70, h: 40 },
    catalog: { x: 503, y: 28, w: 70, h: 40 },
    videos: { x: 603, y: 28, w: 62, h: 40 },
    webinars: { x: 693, y: 28, w: 84, h: 40 },
    about: { x: 808, y: 28, w: 84, h: 40 },
  },
  search: { x: 985, y: 28, w: 240, h: 42 },
  searchButton: { x: 1325, y: 28, w: 46, h: 42 },
  profile: { x: 1371, y: 28, w: 46, h: 42 },
  cart: { x: 1424, y: 28, w: 46, h: 42 },
  cta: { x: 80, y: 528, w: 254, h: 58 },
  /** Прибор (корпус и верх излива). Правый край — левее вшитой карточки. */
  device: { x: 812, y: 315, w: 313, h: 462 },
} as const satisfies Record<string, Rect | Record<string, Rect>>

/** Места флаконов и стакана на фоне — сюда встают заменяемые слои-заглушки. */
export const LAYER_RECTS = {
  omega: { x: 660, y: 510, w: 100, h: 235 },
  vitamin: { x: 733, y: 547, w: 80, h: 190 },
  magnesium: { x: 1075, y: 483, w: 105, h: 292 },
  glass: { x: 1165, y: 577, w: 145, h: 218 },
} as const satisfies Record<string, Rect>

/** Вшитая в фон карточка товара (справа сверху): живая карточка накладывается на неё. */
export const BAKED_CARD: Rect = { x: 1144, y: 165, w: 330, h: 229 }

/**
 * Область живой карточки: полностью накрывает вшитую и растёт только вверх и вправо
 * (слева и снизу — прибор и излив, их закрывать нельзя).
 */
export const CARD_RECT: Rect = { x: 1135, y: 95, w: 365, h: 300 }

/** Вшитые в фон тексты — защищённые области (карточка их перекрывать не должна). */
export const BAKED_TEXT = {
  eyebrow: { x: 78, y: 198, w: 300, h: 20 },
  headline: { x: 75, y: 222, w: 545, h: 165 },
  lead: { x: 78, y: 405, w: 445, h: 100 },
  benefits: { x: 78, y: 668, w: 545, h: 120 },
} as const satisfies Record<string, Rect>

const W = HERO_IMAGE.width
const H = HERO_IMAGE.height

const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`

/**
 * Стиль абсолютного позиционирования зоны в процентах от фона. Позиция задаётся центром зоны +
 * translate(-50%, -50%), чтобы min-width/min-height (44px) растили зону от центра.
 */
export function hotspotStyle(rect: Rect) {
  return {
    left: pct(rect.x + rect.w / 2, W),
    top: pct(rect.y + rect.h / 2, H),
    width: pct(rect.w, W),
    height: pct(rect.h, H),
  }
}

/** Стиль зоны без центрирования (левый верхний угол) — для карточки и слоёв. */
export function boxStyle(rect: Rect) {
  return {
    left: pct(rect.x, W),
    top: pct(rect.y, H),
    width: pct(rect.w, W),
    height: pct(rect.h, H),
  }
}

export function cardStyle(rect: Rect) {
  return {
    left: pct(rect.x, W),
    top: pct(rect.y, H),
    width: pct(rect.w, W),
    height: pct(rect.h, H),
  }
}
