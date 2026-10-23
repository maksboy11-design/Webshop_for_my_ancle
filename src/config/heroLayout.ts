/**
 * Фоны первого экрана. Файлы скопированы без пережатия из Design/References.
 * Старый природный кадр лежит в public/hero/_archive/ и на Hero больше не используется.
 * Координаты ниже — пиксели десктопного кадра 1280×720; в CSS уходят в проценты.
 */
export const HERO_BACKGROUNDS = {
  desktop: {
    src: '/hero/hero-bg-desktop.jpg',
    width: 1280,
    height: 720,
    sha256: '6168e3294ae73b9b696b4645890ca84a65a722381764d87355afd147dc1270b1',
  },
  mobile: {
    src: '/hero/hero-bg-mobile.jpg',
    width: 720,
    height: 1280,
    sha256: 'ffa183ea5755d01f8c127c994ee21f3c7db0960a3a051787a51c1b1fe027b58f',
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
