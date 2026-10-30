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

/** Типизированное назначение блока навигации на водной поверхности. */
export type BenefitDestination =
  | { kind: 'product'; slug: 'flagship-device' | 'silkway-filter' }
  | { kind: 'route'; id: 'webinars' | 'videos' }

export interface Benefit {
  icon: BenefitIconName
  title: string
  destination: BenefitDestination
}

/** Четыре навигационных блока Hero: название + назначение маршрута. */
export const BENEFITS: readonly Benefit[] = [
  {
    icon: 'drop',
    title: 'Водородная ванна',
    destination: { kind: 'product', slug: 'flagship-device' },
  },
  {
    icon: 'leaf',
    title: 'Водородная бутылка',
    destination: { kind: 'product', slug: 'silkway-filter' },
  },
  {
    icon: 'home',
    title: 'Научные факты',
    destination: { kind: 'route', id: 'webinars' },
  },
  {
    icon: 'heart',
    title: 'Отзывы',
    destination: { kind: 'route', id: 'videos' },
  },
]
