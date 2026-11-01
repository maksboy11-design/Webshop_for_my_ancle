import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { PanelWater, ritterDepth } from './outflow'
import styles from './WaterSelect.module.css'

export interface WaterOption {
  value: string
  label: string
}

interface Props {
  label: string
  value: string
  options: readonly WaterOption[]
  onChange: (value: string) => void
  className?: string
}

const OPTION_H = 44
const PAD = 6
/** Белая вода ~50% непрозрачности. */
const BASE_ALPHA = 0.5

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Список-«лужа»: вытекает из кнопки и затекает обратно по модели воды главной страницы. */
export function WaterSelect({ label, value, options, onChange, className }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const [front, setFront] = useState(0)
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const water = useRef<PanelWater | null>(null)
  const raf = useRef(0)
  const H = options.length * OPTION_H + PAD * 2
  const current = options.find((o) => o.value === value) ?? options[0]

  const draw = useCallback(() => {
    const w = water.current
    const c = canvas.current
    if (!w || !c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const { gw, gh, dx } = w.sim
    if (c.width !== gw || c.height !== gh) {
      c.width = gw
      c.height = gh
    }
    const img = ctx.createImageData(gw, gh)
    const f = w.front
    for (let j = 0; j < gh; j++) {
      const y = (j + 0.5) * dx
      const depth = ritterDepth(y, f)
      if (depth <= 0) continue
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i
        if (!w.sim.mask[k]) continue
        const hx = w.heightAt((i + 1.5) * dx, y) - w.heightAt((i - 0.5) * dx, y)
        const hy = w.heightAt((i + 0.5) * dx, y + dx) - w.heightAt((i + 0.5) * dx, y - dx)
        // освещение склона ряби светом сверху-слева
        const light = Math.max(-1, Math.min(1, (-hx - hy) * 0.6))
        const a = BASE_ALPHA * (0.35 + 0.65 * Math.sqrt(depth)) + light * 0.12
        const p = k * 4
        const tone = 255 - Math.max(0, -light) * 25
        img.data[p] = tone
        img.data[p + 1] = tone
        img.data[p + 2] = tone
        img.data[p + 3] = Math.round(Math.max(0, Math.min(0.85, a)) * 255)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
  }, [])

  const run = useCallback(() => {
    if (raf.current) return
    let last = performance.now()
    const tick = (now: number) => {
      const w = water.current
      if (!w) return stop()
      const moving = w.advance((now - last) / 1000)
      last = now
      setFront(w.front)
      setPhase(w.phase)
      draw()
      if (moving) raf.current = requestAnimationFrame(tick)
      else raf.current = 0
    }
    raf.current = requestAnimationFrame(tick)
  }, [draw, stop])

  useEffect(() => stop, [stop])

  const ensureWater = () => {
    const width = root.current?.getBoundingClientRect().width ?? 200
    const w = water.current
    if (!w || Math.abs(w.W - width) > 1 || w.H !== H) water.current = new PanelWater(Math.max(80, Math.round(width)), H)
    return water.current!
  }

  const openList = (index = Math.max(0, options.findIndex((o) => o.value === value))) => {
    setActive(index)
    setOpen(true)
    if (reducedMotion()) {
      setPhase('open')
      setFront(H)
      return
    }
    const w = water.current && water.current.phase !== 'closed' ? water.current : ensureWater()
    w.open()
    run()
  }

  const closeList = (focusButton = true) => {
    setOpen(false)
    if (focusButton) button.current?.focus()
    if (reducedMotion() || !water.current) {
      setPhase('closed')
      setFront(0)
      return
    }
    water.current.close()
    run()
  }

  useEffect(() => {
    if (open) list.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) closeList(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })

  const choose = (index: number) => {
    const opt = options[index]
    closeList()
    if (opt && opt.value !== value) onChange(opt.value)
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeList()
    } else if (e.key === 'Tab') {
      closeList(false)
    }
  }

  const shown = phase !== 'closed'
  const reduced = reducedMotion()
  return (
    <div ref={root} className={`${styles.root} ${className ?? ''}`} data-phase={phase}>
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onButtonKey}
      >
        <span>{current?.label}</span>
        <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={styles.panel} style={{ height: H, visibility: open || shown ? 'visible' : 'hidden' }} data-reduced={reduced ? 'true' : undefined}>
        {!reduced && <canvas ref={canvas} className={styles.water} aria-hidden="true" data-testid="water-canvas" />}
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          className={styles.list}
          hidden={!open && !shown}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => {
            const bottom = PAD + (i + 1) * OPTION_H
            const wet = reduced ? (phase === 'open' ? 1 : 0) : Math.min(1, Math.max(0, (front - bottom + OPTION_H * 0.6) / (OPTION_H * 0.6)))
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active ? 'true' : undefined}
                className={styles.option}
                style={{ height: OPTION_H, opacity: wet }}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.label}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
