export type SectionId = 'reviews' | 'products' | 'webinars'

export interface SectionProps {
  initData: string
  /** Раздел сейчас на экране (скрытые разделы остаются смонтированными, чтобы не терять форму). */
  active: boolean
  /** Обработчик системной кнопки «Назад» MAX для открытого экрана раздела (null — на списке). */
  setBack: (fn: (() => void) | null) => void
  setDirty: (dirty: boolean) => void
}
