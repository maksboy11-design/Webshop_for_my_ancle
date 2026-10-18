/**
 * Тексты первого экрана — редактируются здесь.
 * Намеренно без технических характеристик, исследований и лечебных/медицинских обещаний.
 */
export const HERO_COPY = {
  eyebrow: 'Чистая вода • Больше жизни',
  title: 'Вода, которая заботится о вас',
  description: 'Прибор для обогащения воды водородом — современное решение для дома',
  ctaLabel: 'Узнать больше',
} as const

export type BenefitIconName = 'drop' | 'leaf' | 'home' | 'heart'

export interface Benefit {
  icon: BenefitIconName
  title: string
  note: string
}

/** ЗАГЛУШКИ преимуществ: нейтральные формулировки, замените на утверждённые бренд-тексты. */
export const BENEFITS: readonly Benefit[] = [
  { icon: 'drop', title: 'Водородная вода', note: 'каждый день' },
  { icon: 'leaf', title: 'Спокойный ритуал', note: 'в привычном ритме' },
  { icon: 'home', title: 'Удобно дома', note: 'компактный формат' },
  { icon: 'heart', title: 'Стильный дизайн', note: 'для вашего дома' },
]
