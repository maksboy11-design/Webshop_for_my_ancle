/**
 * Тексты первого экрана — редактируются здесь.
 * Намеренно без технических характеристик, исследований и лечебных/медицинских обещаний.
 */
export const HERO_COPY = {
  eyebrow: 'Здоровье- это главное',
  title: 'Ваше здоровье- наш приоритет',
  description: 'Инновационные решения для дома и здорового образа жизни',
  /** Десктоп: ведёт в раздел о бренде, как в утверждённой сцене. */
  ctaLabel: 'Узнать больше',
  /** Мобильный Hero по эталону 12_Hero_Mobile: одна кнопка в каталог. */
  ctaMobile: 'Смотреть каталог',
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
