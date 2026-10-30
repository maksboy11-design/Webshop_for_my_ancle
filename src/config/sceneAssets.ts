/**
 * Источники слоёв сцены. Фон — отдельно (src/config/heroLayout.ts).
 * Прибор, флаконы, стакан и капсулы — отдельные PNG с прозрачностью, не единый баннер.
 */
export interface AssetSlot {
  /** Путь/URL изображения или null, пока используется заглушка. */
  src: string | null
  alt: string
  /** ширина / высота — резервирует место, чтобы не было скачков при загрузке. */
  aspectRatio: number
  /** false — слой в покое прозрачен. */
  visible: boolean
}

export interface BottleSlot extends AssetSlot {
  id: 'omega' | 'vitamin' | 'magnesium'
  tone: 'dark' | 'light'
}

export const SCENE_ASSETS = {
  /** Прибор для обогащения воды водородом и душевая панель (один вырезанный слой). */
  device: {
    src: '/products/catalog/flagship-device.webp',
    /* Кнопка прибора уже называет действие; картинка внутри неё декоративна для скринридера. */
    alt: '',
    aspectRatio: 601 / 873,
    visible: true,
  },
  /** То же фото в карточке товара. */
  productCardImage: {
    src: '/products/catalog/flagship-device.webp',
    alt: 'Прибор для обогащения воды водородом с душевой панелью',
    aspectRatio: 601 / 873,
    visible: true,
  },
  bottles: [
    {
      id: 'omega',
      tone: 'dark',
      src: '/products/bottle-omega.png',
      alt: 'Флакон SILKWAY Omega-3',
      aspectRatio: 89 / 186,
      visible: true,
    },
    {
      id: 'vitamin',
      tone: 'light',
      src: '/products/bottle-vitamin.png',
      alt: 'Флакон SILKWAY Vitamin D3',
      aspectRatio: 109 / 170,
      visible: true,
    },
    {
      id: 'magnesium',
      tone: 'dark',
      src: '/products/bottle-magnesium.png',
      alt: 'Флакон SILKWAY Magnesium',
      aspectRatio: 98 / 192,
      visible: true,
    },
  ] satisfies readonly BottleSlot[],
  glass: {
    src: '/products/glass.png',
    alt: 'Стакан воды',
    aspectRatio: 108 / 176,
    visible: true,
  },
  capsules: {
    src: '/products/capsules.png',
    alt: 'Капсулы рядом с прибором',
    aspectRatio: 140 / 67,
    visible: true,
  },
} as const satisfies Record<string, AssetSlot | readonly BottleSlot[]>
