import { useEffect, useRef } from 'react'
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
import { isSettled } from './waterCore'
import { RippleSim, detectSimFormat } from './waterSim'

const TILE_SRC = '/textures/water-tile.webp'
const TILE_SIZE_PX = 720
const DESKTOP_QUERY = '(min-width: 64rem)'
/** Custom event: растекание воды с карточки товара (гидродинамика, не CSS). */
export const WATER_SPREAD_EVENT = 'silkway:water-spread'

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

/**
 * Полностраничный слой воды: pointer-events: none (клики по карточкам/кнопкам сохраняются).
 * На [data-water-spread] pointerdown вливает объём в PDE — вода растекается по экрану.
 */
export function WaterSpread() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduceMotion.matches) return

    // Initial hide without putting opacity in React style (avoids re-render wipe on card click).
    canvas.style.opacity = '0'
    canvas.style.visibility = 'hidden'

    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return

    let disposed = false
    let ready = false
    let raf = 0
    let active = false
    let holdUntil = 0
    let fading = false
    let opacity = 0
    let lastSimT = 0
    let lastStats = 0
    let lastInputT = 0
    let heroImg: HTMLImageElement | null = null
    const textures: WebGLTexture[] = []
    const shaders: WebGLShader[] = []
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    shaders.push(vs, fs)
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPos')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    const loc: Record<string, WebGLUniformLocation | null> = {}
    const num = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < num; i++) {
      const u = gl.getActiveUniform(program, i)
      if (u) loc[u.name.replace(/\[0]$/, '')] = gl.getUniformLocation(program, u.name)
    }
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    let sim: RippleSim | null = null
    try {
      sim = new RippleSim(gl, detectSimFormat(gl), (type, src) => {
        const sh = compile(gl, type, src)
        shaders.push(sh)
        return sh
      })
    } catch {
      sim = null
    }

    // Статические художественные uniform'ы (как в WaterSurface).
    const toPx = (m: number) => m / PX_TO_M
    const k: number[] = []
    const omega: number[] = []
    const amp: number[] = []
    const phase: number[] = []
    for (const w of WAVES) {
      const kPx = (2 * Math.PI) / toPx(w.wavelength)
      const len = Math.hypot(w.direction[0], w.direction[1])
      k.push((w.direction[0] / len) * kPx, (w.direction[1] / len) * kPx)
      omega.push(angularFrequency(kPx, PUDDLE_THICKNESS_M))
      amp.push(toPx(w.amplitude))
      phase.push(w.phase)
    }
    const thicknessPx = toPx(PUDDLE_THICKNESS_M)
    const edgePx = thicknessPx / Math.tan(PHYSICAL.contactAngle)
    const absorbPx = PHYSICAL.absorptionRGB.map((a) => a * PX_TO_M * ARTISTIC.absorptionBoost)
    gl.useProgram(program)
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
    gl.uniform1f(loc.uEnabled, 1)
    gl.uniform1f(loc.uTileSize, TILE_SIZE_PX)
    gl.uniform1i(loc.uTile, 0)
    gl.uniform1i(loc.uHero, 1)
    gl.uniform1i(loc.uSim, 2)
    gl.uniform3fv(
      loc.uPageBg,
      cssColorToRgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg-page').trim()),
    )

    const syncSize = () => {
      const cssW = window.innerWidth
      const cssH = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, ARTISTIC.maxDpr) * (lowPower ? ARTISTIC.lowPowerScale : 1)
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      if (sim) {
        const radius = Math.min(48, cssW / 2, cssH / 2)
        sim.resize(cssW, cssH, radius, lowPower || !desktop.matches ? RIPPLE_ARTISTIC.gridLongSmall : RIPPLE_ARTISTIC.gridLong)
      }
      return { cssW, cssH }
    }

    const updateLayout = (cssW: number, cssH: number) => {
      const main = document.querySelector('main') ?? document.body
      const mainRect = main.getBoundingClientRect()
      const stage = main.querySelector('[data-testid=stage]')
      const stageRect = stage?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)
      const radius = Math.min(48, cssW / 2, cssH / 2)
      gl.uniform2f(loc.uRes, canvas.width, canvas.height)
      gl.uniform2f(loc.uSize, cssW, cssH)
      gl.uniform1f(loc.uRadius, radius)
      // Холст на весь viewport: локальные = page-relative к main с поправкой на scroll/fixed.
      gl.uniform2f(loc.uElemPage, -mainRect.left, -mainRect.top)
      gl.uniform4f(
        loc.uStage,
        stageRect.left - mainRect.left,
        stageRect.top - mainRect.top,
        stageRect.width,
        stageRect.height,
      )
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const vw = document.documentElement.clientWidth || window.innerWidth
      gl.uniform1f(loc.uStageH, stageRect.height)
      gl.uniform1f(loc.uFade, Math.min(Math.max(6 * rem, 0.22 * vw), 14 * rem))
      gl.uniform1f(loc.uTileOffX, (mainRect.width - TILE_SIZE_PX) / 2)
      const useHero = desktop.matches && heroImg !== null && stageRect.height > 0
      gl.uniform1f(loc.uHasHero, useHero ? 1 : 0)
      if (heroImg && stageRect.height > 0) {
        const scale = Math.max(stageRect.width / heroImg.naturalWidth, stageRect.height / heroImg.naturalHeight)
        const dw = heroImg.naturalWidth * scale
        const dh = heroImg.naturalHeight * scale
        gl.uniform4f(loc.uHeroMap, (stageRect.width - dw) / 2, (stageRect.height - dh) / 2, dw, dh)
      }
      gl.uniform3f(loc.uEye, window.innerWidth / 2, window.innerHeight / 2, ARTISTIC.eyeDistancePx)
    }

    const setOpacity = (v: number) => {
      opacity = Math.min(1, Math.max(0, v))
      canvas.style.opacity = String(opacity)
      canvas.style.visibility = opacity > 0.01 ? 'visible' : 'hidden'
    }

    const kick = () => {
      if (!raf && !disposed && active) raf = requestAnimationFrame(loop)
    }

    const trigger = (clientX: number, clientY: number) => {
      if (!ready || !sim || disposed) return
      const { cssW, cssH } = syncSize()
      // Без removeMean: лист воды с положительным объёмом должен покрыть страницу.
      for (let i = 0; i < RIPPLE_ARTISTIC.floodPulses; i++) {
        sim.flood(clientX, clientY, RIPPLE_ARTISTIC.floodDepthPx, RIPPLE_ARTISTIC.floodSigmaPx)
      }
      lastInputT = performance.now()
      holdUntil = lastInputT + RIPPLE_ARTISTIC.floodHoldMs
      fading = false
      active = true
      lastSimT = 0
      setOpacity(1)
      canvas.dataset.spread = 'active'
      kick()
      void cssW
      void cssH
    }

    const loop = (now: number) => {
      raf = 0
      if (disposed || !active || !ready) return
      const { cssW, cssH } = syncSize()
      if (sim) {
        const dtReal = lastSimT ? Math.min((now - lastSimT) / 1000, 0.05) : 1 / 60
        sim.step(dtReal, { path: null, impulse: null })
        if (now - lastStats > RIPPLE_ARTISTIC.statsIntervalMs) {
          lastStats = now
          const st = sim.stats()
          // После hold — физический сток: проекция среднего постепенно убирает лист (испарение/уход).
          if (now > holdUntil && st && Math.abs(st.mean) > 0.02) {
            sim.removeMean(st.mean * 0.35)
            fading = true
          }
          if (fading && st && isSettled(st) && now - lastInputT > 400) {
            sim.clear()
            active = false
            setOpacity(0)
            canvas.dataset.spread = 'idle'
            lastSimT = now
            return
          }
          if (fading) setOpacity(Math.max(0, opacity - 0.08))
        }
      }
      lastSimT = now
      gl.useProgram(program)
      if (sim) {
        sim.bind(2)
        gl.uniform2f(loc.uSimGrid, sim.grid[0], sim.grid[1])
        gl.uniform1f(loc.uSimDx, sim.dx)
        gl.uniform1f(loc.uSimOn, 1)
      }
      updateLayout(cssW, cssH)
      gl.uniform1f(loc.uTime, ((now / 1000) * ARTISTIC.timeScale) % 1e6)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (active) raf = requestAnimationFrame(loop)
    }

    const onPointerDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-water-spread]')
      if (!el) return
      // capture: до перехода по ссылке; pointer-events у слоя none — карточка получает клик сама.
      trigger(e.clientX, e.clientY)
      window.dispatchEvent(new CustomEvent(WATER_SPREAD_EVENT, { detail: { x: e.clientX, y: e.clientY } }))
    }
    document.addEventListener('pointerdown', onPointerDown, true)

    const onLost = (e: Event) => {
      e.preventDefault()
      ready = false
      active = false
    }
    canvas.addEventListener('webglcontextlost', onLost)

    Promise.all([loadImage(TILE_SRC), loadImage(HERO_BACKGROUNDS.desktop.src)])
      .then(([tile, hero]) => {
        if (disposed) return
        gl.activeTexture(gl.TEXTURE0)
        textures.push(makeTexture(gl, tile))
        gl.activeTexture(gl.TEXTURE1)
        textures.push(makeTexture(gl, hero))
        heroImg = hero
        syncSize()
        ready = true
        canvas.dataset.ready = 'true'
      })
      .catch(() => {
        ready = false
      })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('pointerdown', onPointerDown, true)
      canvas.removeEventListener('webglcontextlost', onLost)
      sim?.dispose()
      textures.forEach((t) => gl.deleteTexture(t))
      if (buffer) gl.deleteBuffer(buffer)
      shaders.forEach((s) => gl.deleteShader(s))
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="water-spread"
      data-spread="idle"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 40,
        pointerEvents: 'none',
        display: 'block',
        // opacity/visibility only via canvas.style in effect — React must not reset them on re-render
      }}
    />
  )
}
