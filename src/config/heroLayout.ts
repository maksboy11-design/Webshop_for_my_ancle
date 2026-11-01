/**
 * Фоны первого экрана. Файлы скопированы без пережатия из Design/References.
 * Старый природный кадр лежит в public/hero/_archive/ и на Hero больше не используется.
 * Координаты ниже — пиксели десктопного кадра 1280×720; в CSS уходят в проценты.
 */
export const HERO_BACKGROUNDS = {
  desktop: {
    /** Оригинал JPEG — источник истины и e2e SHA-256. Не перезаписывать. */
    /** v2: ванна, озеро слева, товары на бортике, генератор справа. AVIF/WebP — апскейл 2048w (Lanczos + мягкий unsharp). */
    src: '/hero/hero-bg-desktop-v2.jpg?v=1',
    path: 'hero/hero-bg-desktop-v2.jpg',
    avif: '/hero/hero-bg-desktop-v2-2048.avif?v=1',
    webp: '/hero/hero-bg-desktop-v2-2048.webp?v=1',
    width: 1280,
    height: 720,
    sha256: 'f1720302f2197ee5089b90b6e6f60222b89e23c3824b15af5d6a6f2d3fe9e6e2',
  },
  /**
   * Мобильный кадр v4 (720×1280, JPEG-оригинал без пережатия; новая бутылка Эра ботаника), показывается целиком (ванна, генератор справа, трубка в воде, товары на бортике).
   * Оригинал — PNG без пережатия, источник истины для e2e SHA-256. JPG — только фолбэк <img>.
   */
  mobile: {
    src: '/hero/hero-bg-mobile-v4.jpg?v=1',
    path: 'hero/hero-bg-mobile-v4.jpg',
    avif: '/hero/hero-bg-mobile-v4.avif?v=1',
    webp: '/hero/hero-bg-mobile-v4.webp?v=1',
    width: 720,
    height: 1280,
    sha256: '4664d3f6e1ef651a952644cac654bdb466e4eeaa631851dd251aba5773d68e02',
  },
} as const

/** Прежние оригиналы: на Hero мобильный больше не используется, но файлы не трогаем (SHA в e2e). */
export const LEGACY_HERO_ORIGINALS = {
  desktop: { path: 'hero/hero-bg-desktop.jpg', sha256: '65e776d62e3e66208974ce967b712ad0a7b85b5974145e0c8708c0ed4920ee4d' },
  mobileV3: { path: 'hero/hero-bg-mobile-v3.png', sha256: 'dc314cdafca1575d453abac0261c1fba0d4b38c97827d17928432df655fd2f39' },
  mobileV2: { path: 'hero/hero-bg-mobile-v2.png', sha256: '252a5c74062897891f829a543d3ff321ca4c0b3d437d267bb53fa164352a036b' },
  mobile: { path: 'hero/hero-bg-mobile.jpg', sha256: '825e2dd826da0d662907ba78bf9df13e1e92a5032cbd6ab60d7fef4cd4d1fb9b' },
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
 * Фон desktop-v2: левый край 900, правый 1022, верх 262, низ корпуса 452.
 * Соотношение сторон 220/310 = 0.710. У PNG корпуса 524/835 = 0.628, расхождение около 13 %.
 * Плюс другой наклон: PNG вертикальнее, дисплей смещён. Поэтому PNG не кладётся поверх фона.
 */
export const GENERATOR_BODY: Rect = { x: 900, y: 262, w: 122, h: 190 }

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
    desktop: { x: 832, y: 347, w: 54, h: 170 },
    /** Пиксели мобильного кадра v4 720×1280: бутылка Silkway на бортике. */
    mobile: { x: 364, y: 656, w: 76, h: 230 },
  },
  astaxanthin: {
    desktop: { x: 644, y: 346, w: 112, h: 52 },
    /** В мобильном кадре v4 коробки астаксантина нет — зоны на телефоне нет. */
    mobile: null,
  },
} as const satisfies Record<string, { desktop: Rect; mobile: Rect | null }>

export function cardStyle(rect: Rect) {
  return boxStyle(rect)
}
