/**
 * Фоны первого экрана. Файлы скопированы без пережатия из Design/References.
 * Старый природный кадр лежит в public/hero/_archive/ и на Hero больше не используется.
 * Координаты ниже — пиксели десктопного кадра 1280×720; в CSS уходят в проценты.
 */
export const HERO_BACKGROUNDS = {
  desktop: {
    /** Оригинал JPEG — источник истины и e2e SHA-256. Не перезаписывать. */
    src: '/hero/hero-bg-desktop.jpg?v=3',
    path: 'hero/hero-bg-desktop.jpg',
    avif: '/hero/hero-bg-desktop.avif?v=3',
    webp: '/hero/hero-bg-desktop.webp?v=3',
    width: 1280,
    height: 720,
    sha256: '65e776d62e3e66208974ce967b712ad0a7b85b5974145e0c8708c0ed4920ee4d',
  },
  mobile: {
    src: '/hero/hero-bg-mobile.jpg?v=3',
    path: 'hero/hero-bg-mobile.jpg',
    avif: '/hero/hero-bg-mobile.avif?v=3',
    webp: '/hero/hero-bg-mobile.webp?v=3',
    width: 720,
    height: 1280,
    sha256: '825e2dd826da0d662907ba78bf9df13e1e92a5032cbd6ab60d7fef4cd4d1fb9b',
  },
} as const

/** Вырезы генератора без трубки. На Hero не накладываются: ракурс не совпадает с фоном. */
export const GENERATOR_FILES = {
  desktop: '/hero/generator-desktop.png',
  mobile: '/hero/generator-mobile.png',
} as const

/** Десктопный кадр — система координат карточки и зоны генератора. */
export const HERO_IMAGE = HERO_BACKGROUNDS.desktop

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Корпус генератора на десктопном фоне, без металлической трубки.
 * Ось-параллельный прямоугольник по сетке кадра: левый край 860, правый 1080, верх 195, низ корпуса 505.
 * Соотношение сторон 220/310 = 0.710. У PNG корпуса 524/835 = 0.628, расхождение около 13 %.
 * Плюс другой наклон: PNG вертикальнее, дисплей смещён. Поэтому PNG не кладётся поверх фона.
 */
export const GENERATOR_BODY: Rect = { x: 860, y: 195, w: 220, h: 310 }

/**
 * Слои старой природной сцены (кадр 1024×682 в архиве). На новом фоне не используются:
 * флаконов, стакана и душевой панели в утверждённом кадре нет.
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
export const CARD_RECT: Rect = { x: 500, y: 48, w: 270, h: 280 }

const W = HERO_IMAGE.width
const H = HERO_IMAGE.height

const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`

/** Абсолютная зона от левого верхнего угла, в процентах от кадра. */
export function boxStyle(rect: Rect) {
  return boxStyleIn(rect, W, H)
}

/** Проценты от кадра заданного размера: десктоп 1280×720 или телефон 720×1280. */
export function boxStyleIn(rect: Rect, width: number, height: number) {
  return {
    left: pct(rect.x, width),
    top: pct(rect.y, height),
    width: pct(rect.w, width),
    height: pct(rect.h, height),
  }
}

/**
 * Зоны полки чуть шире нарисованных товаров из Design/hero_new/placement.json.
 * Края, которыми бутылка и коробка соприкасаются, не раздуваются — иначе зоны накрывают друг друга.
 * PNG товаров поверх фона не кладутся.
 */
export const SHELF_HOTSPOTS = {
  hydrogenBottle: {
    desktop: { x: 692, y: 327, w: 62, h: 148 },
    mobile: { x: 334, y: 658, w: 76, h: 176 },
  },
  astaxanthin: {
    desktop: { x: 602, y: 378, w: 89, h: 80 },
    mobile: { x: 226, y: 728, w: 104, h: 92 },
  },
} as const satisfies Record<string, { desktop: Rect; mobile: Rect }>

export function cardStyle(rect: Rect) {
  return boxStyle(rect)
}
