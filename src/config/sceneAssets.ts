/**
 * Источники изображений слоёв сцены — ОДИН конфиг для будущих фотографий.
 *
 * Прибор, флаконы и стакан сейчас вшиты в неизменный фон Hero. Слои-заглушки лежат поверх них в
 * тех же местах и в покое НЕВИДИМЫ (visible: false), чтобы не менять вид фона.
 *
 * Как заменить: укажите `src` (PNG/WebP с прозрачным фоном), поправьте `alt` и `aspectRatio`
 * (ширина / высота реального изображения) и поставьте `visible: true` — слой закроет вшитый объект.
 * Для этого понадобится фон без вшитых предметов (иначе объекты будут двоиться).
 */
export interface AssetSlot {
  /** Путь/URL изображения или null, пока используется заглушка. */
  src: string | null
  alt: string
  /** ширина / высота — резервирует место, чтобы не было скачков при загрузке. */
  aspectRatio: number
  /** false — слой в покое прозрачен (поверх вшитого в фон объекта). */
  visible: boolean
}

export interface BottleSlot extends AssetSlot {
  id: 'omega' | 'vitamin' | 'magnesium'
  tone: 'dark' | 'light'
}

export const SCENE_ASSETS = {
  /** Фото прибора для обогащения воды водородом (главный акцент сцены). */
  device: {
    src: null,
    alt: 'Бежевый прибор для обогащения воды водородом (заглушка, будет заменена фотографией)',
    aspectRatio: 0.62,
    visible: false,
  },
  /** Изображение прибора в карточке товара. */
  productCardImage: {
    src: null,
    alt: 'Прибор для обогащения воды водородом (заглушка изображения)',
    aspectRatio: 0.78,
    visible: true,
  },
  /** Три флакона БАДов. Названия — условные, заменить на реальные продукты. */
  bottles: [
    {
      id: 'omega',
      tone: 'dark',
      src: null,
      alt: 'Флакон с добавкой Omega-3 (заглушка)',
      aspectRatio: 0.5,
      visible: false,
    },
    {
      id: 'vitamin',
      tone: 'light',
      src: null,
      alt: 'Флакон с добавкой Vitamin D3 (заглушка)',
      aspectRatio: 0.5,
      visible: false,
    },
    {
      id: 'magnesium',
      tone: 'dark',
      src: null,
      alt: 'Флакон с добавкой Magnesium (заглушка)',
      aspectRatio: 0.5,
      visible: false,
    },
  ] satisfies readonly BottleSlot[],
  /** Стакан воды. */
  glass: {
    src: null,
    alt: 'Стакан воды (заглушка)',
    aspectRatio: 0.72,
    visible: false,
  },
} as const satisfies Record<string, AssetSlot | readonly BottleSlot[]>
