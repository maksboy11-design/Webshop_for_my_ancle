import { SCENE_ASSETS, type AssetSlot } from '../config/sceneAssets'
import type { ProductPrice } from './price'
import { productById } from './products'

export interface FeaturedProduct {
  title: string
  /** Ровно шесть слов (проверяется в e2e-тесте). */
  description: string
  /** Цена из прайс-листа (₽ и PV); null — цена не указана, строка не показывается. */
  price: ProductPrice | null
  image: AssetSlot
  ctaLabel: string
}

/** Данные карточки товара, всплывающей у прибора. Отделены от разметки. */
export const FEATURED_PRODUCT: FeaturedProduct = {
  title: 'Прибор для обогащения воды водородом',
  description: 'Компактный прибор для обогащения воды водородом',
  // Карточка у прибора — флагман каталога; цену берём из его записи, а не дублируем цифры
  price: productById('flagship')?.price ?? null,
  image: SCENE_ASSETS.productCardImage,
  ctaLabel: 'Перейти в карточку',
}
