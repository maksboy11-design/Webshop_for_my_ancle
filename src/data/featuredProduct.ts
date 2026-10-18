import { SCENE_ASSETS, type AssetSlot } from '../config/sceneAssets'

export interface FeaturedProduct {
  title: string
  /** Ровно шесть слов (проверяется в e2e-тесте). */
  description: string
  price: {
    amount: number
    currency: 'RUB'
    /** true → цена демонстрационная, не цена бренда. */
    isDemo: boolean
    demoLabel: string
  }
  image: AssetSlot
  ctaLabel: string
}

/** Данные карточки товара, всплывающей у прибора. Отделены от разметки. */
export const FEATURED_PRODUCT: FeaturedProduct = {
  title: 'Прибор для обогащения воды водородом',
  description: 'Компактный прибор для обогащения воды водородом',
  price: {
    amount: 49990,
    currency: 'RUB',
    isDemo: true, // ДЕМО-цена-заглушка, не выдавать за цену бренда
    demoLabel: 'Демо-цена',
  },
  image: SCENE_ASSETS.productCardImage,
  ctaLabel: 'Перейти в карточку',
}

const priceFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

/** «49 990 ₽» (неразрывные пробелы подставляет Intl). */
export function formatPrice(amount: number): string {
  return priceFormatter.format(amount)
}
