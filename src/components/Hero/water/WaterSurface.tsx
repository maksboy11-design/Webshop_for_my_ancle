import { useEffect, useRef, useState } from 'react'
import { HERO_BACKGROUNDS } from '../../../config/heroLayout'
import {
  ARTISTIC,
  CAPILLARY_LENGTH_M,
  PHYSICAL,
  PUDDLE_THICKNESS_M,
  PX_TO_M,
  RIPPLE_ARTISTIC,
  WAVES,
  angularFrequency,
  fresnelF0,
} from './waterParams'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './waterShader'
import { PointerTracker, isSettled, type FieldStats } from './waterCore'
import { RippleSim, detectSimFormat, type SimInput } from './waterSim'

const TILE_SRC = '/textures/water-tile.webp'
/** Совпадает с --water-size в App.module.css. */
const TILE_SIZE_PX = 720
const DESKTOP_QUERY = '(min-width: 64rem)'

export type WaterMode = 'webgl' | 'fallback'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image ${src}`))
    img.src = src
  })
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`shader compile: ${log ?? ''}`)
  }
  return shader
}

function makeTexture(gl: WebGLRenderingContext, img: HTMLImageElement): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  // NPOT-безопасно для WebGL1: без мип-карт, CLAMP, повтор тайла — через fract() в шейдере.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function cssColorToRgb(value: string): [number, number, number] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return [0.984, 0.992, 0.969]
  ctx.fillStyle = '#fbfdf7'
  ctx.fillStyle = value || '#fbfdf7'
  const hex = ctx.fillStyle
  if (hex.startsWith('#') && hex.length === 7) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  return [0.984, 0.992, 0.969]
}

function isLowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4
}

/** effectEnabled: ?water=off — проход фона без воды (для сверки выборки фона). */
function effectEnabledFromUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('water') !== 'off'
  } catch {
    return true
  }
}

/**
 * Тонкий слой воды (плоская лужа) строго в границах родителя.
 * Холст под содержимым, pointer-events: none, размеры берутся у родителя — без layout shift.
 */
export function WaterSurface({
  className,
  onModeChange,
}: {
  className?: string
  onModeChange?: (mode: WaterMode) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, setTick] = useState(0)
  const modeCb = useRef(onModeChange)

  useEffect(() => {
    modeCb.current = onModeChange
  }, [onModeChange])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const report = (mode: WaterMode) => modeCb.current?.(mode)

    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) {
      report('fallback')
      return
    }

    let disposed = false
    let raf = 0
    let visible = true
    let pageVisible = document.visibilityState === 'visible'
    let ready = false
    let dirty = true
    let lastFrame = 0
    const lowPower = isLowPower()
    const minFrameMs = lowPower ? 1000 / 30 : 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const enabled = effectEnabledFromUrl()
    const start = performance.now()
    // ?water=diag — тестовый режим: фоновые волны заморожены, статистика поля в data-diag
    // (раз в statsIntervalMs, без логов в консоль).
    const diag = new URLSearchParams(window.location.search).get('water') === 'diag'

    let program: WebGLProgram | null = null
    let buffer: WebGLBuffer | null = null
    const textures: WebGLTexture[] = []
    const shaders: WebGLShader[] = []
    let heroImg: HTMLImageElement | null = null
    let loc: Record<string, WebGLUniformLocation | null> = {}

    const simFormat = detectSimFormat(gl)
    let sim: RippleSim | null = null
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
      const fs = compile(gl, gl.FRAGMENT_SHADER, (simFormat === 'pack' ? '#define PACK 1\n' : '') + FRAGMENT_SHADER)
      shaders.push(vs, fs)
      program = gl.createProgram()
      if (!program) throw new Error('program')
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.bindAttribLocation(program, 0, 'aPos')
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link')
      gl.useProgram(program)
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(program, 'aPos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      const names = [
        'uRes', 'uSize', 'uRadius', 'uTime', 'uEnabled', 'uK', 'uOmega', 'uAmp', 'uPhase',
        'uThick', 'uEdgeL', 'uDampW', 'uEta', 'uF0', 'uDepthK', 'uAbsorb', 'uCaust', 'uAlpha',
        'uSunDir', 'uSkyDir', 'uSunI', 'uSkyI', 'uEye', 'uTile', 'uHero', 'uHasHero',
        'uElemPage', 'uStage', 'uStageH', 'uFade', 'uTileOffX', 'uTileSize', 'uHeroMap', 'uPageBg',
        'uSim', 'uSimGrid', 'uSimDx', 'uSimOn',
      ]
      loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program!, n)]))
    } catch {
      report('fallback')
      return
    }
    // Интерактивные волны: необязательная часть — без них эффект работает как раньше.
    if (enabled) {
      try {
        sim = new RippleSim(gl, simFormat, (type, src) => {
          const sh = compile(gl, type, src)
          return sh
        })
      } catch {
        sim = null
      }
    }
    canvas.dataset.sim = sim ? sim.format : 'off'

    // Неизменные данные: волны и физика — один раз.
    const toPx = (m: number) => m / PX_TO_M
    const k: number[] = []
    const omega: number[] = []
    const amp: number[] = []
    const phase: number[] = []
    for (const w of WAVES) {
      const kMag = (2 * Math.PI) / w.wavelength // 1/м
      const len = Math.hypot(w.direction[0], w.direction[1])
      const kPx = kMag * PX_TO_M // рад/px
      k.push((w.direction[0] / len) * kPx, (w.direction[1] / len) * kPx)
      omega.push(angularFrequency(kMag, PUDDLE_THICKNESS_M))
      amp.push(toPx(w.amplitude))
      phase.push(w.phase)
    }
    const thicknessPx = toPx(PUDDLE_THICKNESS_M)
    // Ширина профиля края: наклон у контактной линии равен tan θc → ℓ = h∞ / tan θc.
    const edgePx = thicknessPx / Math.tan(PHYSICAL.contactAngle)
    const absorbPx = PHYSICAL.absorptionRGB.map((a) => a * PX_TO_M * ARTISTIC.absorptionBoost)
    gl.uniform2fv(loc.uK, k)
    gl.uniform1fv(loc.uOmega, omega)
    gl.uniform1fv(loc.uAmp, amp)
    gl.uniform1fv(loc.uPhase, phase)
    gl.uniform1f(loc.uThick, thicknessPx)
    gl.uniform1f(loc.uEdgeL, edgePx)
    gl.uniform1f(loc.uDampW, toPx(CAPILLARY_LENGTH_M) * ARTISTIC.waveDampingLc)
    gl.uniform1f(loc.uEta, PHYSICAL.iorAir / PHYSICAL.iorWater)
    gl.uniform1f(loc.uF0, fresnelF0(PHYSICAL.iorAir, PHYSICAL.iorWater))
    gl.uniform1f(loc.uDepthK, ARTISTIC.refractionStrength)
    gl.uniform3fv(loc.uAbsorb, absorbPx)
    gl.uniform1f(loc.uCaust, ARTISTIC.causticsIntensity)
    gl.uniform1f(loc.uAlpha, ARTISTIC.surfaceRoughness ** 2)
    gl.uniform3fv(loc.uSunDir, PHYSICAL.sunDirection as unknown as number[])
    gl.uniform3fv(loc.uSkyDir, PHYSICAL.skyDirection as unknown as number[])
    gl.uniform1f(loc.uSunI, ARTISTIC.sunIntensity)
    gl.uniform1f(loc.uSkyI, ARTISTIC.skyIntensity)
    gl.uniform1f(loc.uEnabled, enabled ? 1 : 0)
    gl.uniform1f(loc.uTileSize, TILE_SIZE_PX)
    gl.uniform1i(loc.uTile, 0)
    gl.uniform1i(loc.uHero, 1)
    gl.uniform1i(loc.uSim, 2)
    gl.uniform1f(loc.uSimOn, 0)
    gl.uniform3fv(loc.uPageBg, cssColorToRgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg-page').trim()))

    let cssW = 0
    let cssH = 0
    const resize = () => {
      const rect = host.getBoundingClientRect()
      cssW = rect.width
      cssH = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, ARTISTIC.maxDpr) * (lowPower ? ARTISTIC.lowPowerScale : 1)
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      if (sim && cssW > 0 && cssH > 0) {
        const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0
        const small = lowPower || !desktop.matches
        // Поле не сбрасывается: сетка переносит текущие волны, материал не переинициализируется.
        sim.resize(cssW, cssH, Math.min(radius, cssW / 2, cssH / 2), small ? RIPPLE_ARTISTIC.gridLongSmall : RIPPLE_ARTISTIC.gridLong)
      }
      dirty = true
    }

    const updateLayout = () => {
      const main = host.closest('main') ?? document.body
      const mainRect = main.getBoundingClientRect()
      const rect = host.getBoundingClientRect()
      const stage = main.querySelector('[data-testid=stage]')
      const stageRect = stage?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)
      const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0
      gl.uniform2f(loc.uRes, canvas.width, canvas.height)
      gl.uniform2f(loc.uSize, cssW, cssH)
      gl.uniform1f(loc.uRadius, Math.min(radius, cssW / 2, cssH / 2))
      gl.uniform2f(loc.uElemPage, rect.left - mainRect.left, rect.top - mainRect.top)
      gl.uniform4f(loc.uStage, stageRect.left - mainRect.left, stageRect.top - mainRect.top, stageRect.width, stageRect.height)
      // --hero-stage-h = высота кадра; --water-fade = clamp(6rem, 22vw, 14rem).
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const vw = document.documentElement.clientWidth || window.innerWidth
      gl.uniform1f(loc.uStageH, stageRect.height)
      gl.uniform1f(loc.uFade, Math.min(Math.max(6 * rem, 0.22 * vw), 14 * rem))
      gl.uniform1f(loc.uTileOffX, (mainRect.width - TILE_SIZE_PX) / 2)
      const useHero = desktop.matches && heroImg !== null
      gl.uniform1f(loc.uHasHero, useHero ? 1 : 0)
      if (heroImg) {
        const scale = Math.max(stageRect.width / heroImg.naturalWidth, stageRect.height / heroImg.naturalHeight)
        const dw = heroImg.naturalWidth * scale
        const dh = heroImg.naturalHeight * scale
        gl.uniform4f(loc.uHeroMap, (stageRect.width - dw) / 2, (stageRect.height - dh) / 2, dw, dh)
      }
      gl.uniform3f(loc.uEye, window.innerWidth / 2 - rect.left, window.innerHeight / 2 - rect.top, ARTISTIC.eyeDistancePx)
    }

    // Успокоение — по фактическому полю (max|h|, max|∇h|), а не по таймеру: обнуление
    // происходит, когда волны уже ниже порога видимости, поэтому «щелчка» нет.
    let canRead = true
    let lastStats = 0
    let modelSinceInput = 0
    let clears = 0
    let nanResets = 0
    let steps = 0
    let lastSt: FieldStats | null = null
    const settleCheck = (now: number) => {
      if (!sim || now - lastStats < RIPPLE_ARTISTIC.statsIntervalMs) return
      lastStats = now
      const st = canRead ? sim.stats() : null
      if (!st) canRead = false
      lastSt = st
      const quiet = now - lastInputT > 300 && !pressed
      let settled: boolean
      if (st) {
        if (st.bad > 0) {
          nanResets++
          settled = true
        } else {
          if (Math.abs(st.mean) > 1e-4) sim.removeMean(st.mean)
          settled = quiet && isSettled(st)
        }
      } else {
        // Запасной критерий без считывания: огибающая e^(−βt/2) после последнего ввода.
        settled = quiet && (sim.beta * modelSinceInput) / 2 > Math.log(RIPPLE_ARTISTIC.settleEnvelopeDrop)
      }
      if (settled) {
        sim.clear()
        simActive = false
        clears++
      }
      if (diag) {
        canvas.dataset.diag = JSON.stringify({
          t: Math.round(now), active: simActive, clears, nanResets, steps, read: canRead,
          dropped: +sim.droppedTime.toFixed(4), v: Math.round(tracker.speed), ...(st ?? {}),
        })
      }
    }

    const draw = (now: number) => {
      if (!ready || disposed) return
      if (sim && simActive) {
        // Единая база времени — rAF now; после скрытой вкладки lastSimT = 0 → обычный кадр.
        const dtReal = lastSimT ? (now - lastSimT) / 1000 : 1 / 60
        const input = takeInput(now)
        const n = sim.step(dtReal, input)
        steps += n
        modelSinceInput = input.path || input.impulse ? 0 : modelSinceInput + n * sim.dt
        settleCheck(now)
      } else if (diag && sim && now - lastStats > 500) {
        lastStats = now
        canvas.dataset.diag = JSON.stringify({ t: Math.round(now), active: false, clears, nanResets, steps, read: canRead, ...(lastSt ? { maxH: 0, maxSlope: 0, mean: 0, bad: 0 } : {}) })
      }
      lastSimT = now
      gl.useProgram(program)
      if (sim) {
        sim.bind(2)
        gl.uniform2f(loc.uSimGrid, sim.grid[0], sim.grid[1])
        gl.uniform1f(loc.uSimDx, sim.dx)
      }
      gl.uniform1f(loc.uSimOn, sim && simActive ? 1 : 0)
      updateLayout()
      const t = diag ? 1 : reduceMotion.matches ? 0 : ((now - start) / 1000) * ARTISTIC.timeScale
      gl.uniform1f(loc.uTime, t)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      dirty = false
    }

    const loop = (now: number) => {
      raf = 0
      if (disposed || !visible || !pageVisible) return
      const animate = !reduceMotion.matches || simActive
      if (animate || dirty) {
        if (now - lastFrame >= minFrameMs) {
          lastFrame = now
          draw(now)
        }
      }
      if (animate) raf = requestAnimationFrame(loop)
    }

    const kick = () => {
      dirty = true
      if (!raf && !disposed) raf = requestAnimationFrame(loop)
    }

    // ── Курсор как источник давления ──
    // Слушаем обёртку (холст pointer-events: none), всё пассивно: скролл и клики не трогаем.
    let simActive = false
    let lastSimT = 0
    let lastInputT = 0
    let pressed = false
    // Вход сглаживается только здесь (скорость, EMA); само поле не фильтруется.
    const tracker = new PointerTracker()
    let impulse: { x: number; y: number } | null = null
    const interactive = () => sim !== null && ready && !reduceMotion.matches
    const toLocal = (cx: number, cy: number) => {
      const r = host.getBoundingClientRect()
      return { x: cx - r.left, y: cy - r.top }
    }
    const wake = () => {
      lastInputT = performance.now()
      if (!simActive) {
        simActive = true
        lastSimT = 0
      }
      kick()
    }
    const press = (cx: number, cy: number) => {
      if (!interactive()) return
      const p = toLocal(cx, cy)
      const now = performance.now()
      impulse = p
      pressed = true
      tracker.add(p.x, p.y, now, now)
      wake()
    }
    const move = (cx: number, cy: number, tStamp: number) => {
      if (!interactive()) return
      const p = toLocal(cx, cy)
      tracker.add(p.x, p.y, tStamp, performance.now())
      if (tracker.speed > 1) wake()
    }
    const release = () => {
      pressed = false
      tracker.end()
    }
    const takeInput = (now: number): SimInput => {
      const tr = tracker.take(now)
      // Сила источника ∝ v_eff = v_cap·tanh(v/v_cap): медленное движение почти не возбуждает волн.
      const out: SimInput = { impulse, path: tr ? { pts: tr.pts, accel: RIPPLE_ARTISTIC.moveGain * tr.speed } : null }
      impulse = null
      return out
    }
    // Ссылки навигации: не создаём импульс — вода остаётся фоном, клик идёт сразу.
    const isNavLink = (t: EventTarget | null) =>
      t instanceof Element && Boolean(t.closest('a[href]'))
    const onPointerDown = (e: PointerEvent) => {
      if (isNavLink(e.target)) return
      if (e.pointerType !== 'touch') press(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      // Все промежуточные точки (coalesced events): быстрый зигзаг внутри кадра не теряется.
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      if (list.length > 1) for (const c of list) move(c.clientX, c.clientY, c.timeStamp)
      else move(e.clientX, e.clientY, e.timeStamp)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') pressed = false
    }
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') release()
    }
    // Touch — отдельными пассивными событиями: touchmove продолжает приходить и во время
    // прокрутки страницы, а pointer-события браузер отменяет (pointercancel) при скролле.
    const onTouchStart = (e: TouchEvent) => {
      if (isNavLink(e.target)) return
      const t = e.changedTouches[0]
      if (t) press(t.clientX, t.clientY)
    }
    const onTouchMove = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (t) move(t.clientX, t.clientY, e.timeStamp)
    }
    const onTouchEnd = () => release()
    const passive = { passive: true } as const
    host.addEventListener('pointerdown', onPointerDown, passive)
    host.addEventListener('pointermove', onPointerMove, passive)
    host.addEventListener('pointerleave', onPointerLeave, passive)
    host.addEventListener('pointerup', onPointerUp, passive)
    host.addEventListener('touchstart', onTouchStart, passive)
    host.addEventListener('touchmove', onTouchMove, passive)
    host.addEventListener('touchend', onTouchEnd, passive)
    host.addEventListener('touchcancel', onTouchEnd, passive)

    const ro = new ResizeObserver(() => {
      resize()
      kick()
    })
    ro.observe(host)
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible) kick()
    })
    io.observe(host)
    const onVisibility = () => {
      pageVisible = document.visibilityState === 'visible'
      // Скрытая вкладка: rAF стоит, время не копится — по возвращении шаг обычный, без рывка.
      lastSimT = 0
      if (pageVisible) kick()
    }
    const onScroll = () => {
      if (reduceMotion.matches) kick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', kick)
    reduceMotion.addEventListener('change', kick)
    desktop.addEventListener('change', kick)
    const onLost = (e: Event) => {
      e.preventDefault()
      ready = false
      report('fallback')
    }
    canvas.addEventListener('webglcontextlost', onLost)

    resize()
    Promise.all([loadImage(TILE_SRC), loadImage(HERO_BACKGROUNDS.desktop.src)])
      .then(([tile, hero]) => {
        if (disposed) return
        gl.activeTexture(gl.TEXTURE0)
        textures.push(makeTexture(gl, tile))
        gl.activeTexture(gl.TEXTURE1)
        textures.push(makeTexture(gl, hero))
        heroImg = hero
        ready = true
        report('webgl')
        canvas.dataset.ready = 'true'
        setTick((n) => n + 1)
        kick()
      })
      .catch(() => {
        if (!disposed) report('fallback')
      })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', kick)
      reduceMotion.removeEventListener('change', kick)
      desktop.removeEventListener('change', kick)
      canvas.removeEventListener('webglcontextlost', onLost)
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('touchstart', onTouchStart)
      host.removeEventListener('touchmove', onTouchMove)
      host.removeEventListener('touchend', onTouchEnd)
      host.removeEventListener('touchcancel', onTouchEnd)
      sim?.dispose()
      textures.forEach((t) => gl.deleteTexture(t))
      if (buffer) gl.deleteBuffer(buffer)
      shaders.forEach((s) => gl.deleteShader(s))
      if (program) gl.deleteProgram(program)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" data-testid="water-surface" />
}
