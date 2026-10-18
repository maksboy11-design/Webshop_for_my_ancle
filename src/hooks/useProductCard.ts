import { useCallback, useEffect, useId, useState } from 'react'
import type { FocusEvent, PointerEvent } from 'react'
import { CARD_OVERLAY_QUERY } from '../config/breakpoints'
import { CARD_HOVER } from '../config/interaction'
import { useMediaQuery } from './useMediaQuery'

export type CardMode = 'overlay' | 'flow'

interface InteractionState {
  /** Режим, в котором накоплено состояние; при смене режима состояние считается сброшенным. */
  mode: CardMode
  /** Указатель сейчас над прибором или карточкой (мгновенно). */
  inside: boolean
  /** Hover-intent: inside с задержкой открытия/закрытия. */
  hovered: boolean
  focused: boolean
  pinned: boolean
}

const idle = (mode: CardMode): InteractionState => ({
  mode,
  inside: false,
  hovered: false,
  focused: false,
  pinned: false,
})

/**
 * Логика карточки товара у прибора — самостоятельный хук.
 *
 * Режимы:
 *  - overlay (широкий экран + настоящий hover): карточка проявляется в зарезервированной зоне при
 *    наведении на прибор ИЛИ на саму карточку, либо при клавиатурном фокусе. Закрытие — с небольшой
 *    задержкой (hover-intent), чтобы курсор мог перейти с прибора на карточку.
 *  - flow (мобильные/планшеты/тач): карточка открывается по нажатию на прибор или на кнопку-триггер
 *    и показывается в потоке страницы под сценой.
 *
 * Escape закрывает карточку в любом режиме.
 */
export function useProductCard() {
  const mode: CardMode = useMediaQuery(CARD_OVERLAY_QUERY) ? 'overlay' : 'flow'
  const cardId = useId()

  const [raw, setRaw] = useState<InteractionState>(() => idle(mode))
  const state = raw.mode === mode ? raw : idle(mode)

  const update = useCallback(
    (patch: Partial<Omit<InteractionState, 'mode'>>) => {
      setRaw((prev) => ({ ...(prev.mode === mode ? prev : idle(mode)), ...patch }))
    },
    [mode],
  )

  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null)
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null)

  // Hover-intent: открытие/закрытие по указателю — с короткой задержкой, чтобы курсор успел
  // перейти с прибора на карточку, а случайный пролёт не вызывал карточку.
  const { inside, hovered } = state
  useEffect(() => {
    if (mode !== 'overlay' || inside === hovered) return
    const id = window.setTimeout(
      () => update({ hovered: inside }),
      inside ? CARD_HOVER.openDelay : CARD_HOVER.closeDelay,
    )
    return () => window.clearTimeout(id)
  }, [mode, inside, hovered, update])

  const open = mode === 'overlay' ? state.hovered || state.focused || state.pinned : state.pinned

  const close = useCallback(() => {
    update({ inside: false, hovered: false, focused: false, pinned: false })
  }, [update])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    // В overlay-режиме нажатие вне прибора и карточки (в т.ч. тап на тач-ноутбуке) закрывает карточку.
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (mode !== 'overlay') return
      const target = event.target as Node
      if (triggerEl?.contains(target) || cardEl?.contains(target)) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, mode, close, triggerEl, cardEl])

  const handlePointerEnter = (event: PointerEvent) => {
    if (mode !== 'overlay' || event.pointerType === 'touch') return
    update({ inside: true })
  }

  const handlePointerLeave = (event: PointerEvent) => {
    if (mode !== 'overlay' || event.pointerType === 'touch') return
    update({ inside: false })
  }

  // Фокус учитываем только «клавиатурный» (:focus-visible): клик мышью по прибору не залипает.
  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    if (mode !== 'overlay') return
    if (event.target.matches(':focus-visible')) update({ focused: true })
  }

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && (triggerEl?.contains(next) || cardEl?.contains(next))) return
    update({ focused: false })
  }

  const toggle = () => update({ pinned: !state.pinned })

  return {
    mode,
    open,
    cardId,
    /** Нажатие на прибор: в flow — переключает карточку, в overlay — закрепляет (hover уже открыл). */
    activate: mode === 'flow' ? toggle : () => update({ pinned: true }),
    toggle,
    /** callback-ref кнопки-триггера (прибора) */
    bindTrigger: setTriggerEl,
    /** callback-ref карточки */
    bindCard: setCardEl,
    hoverHandlers: {
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
  }
}
