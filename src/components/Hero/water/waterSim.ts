/**
 * Интерактивное высотное поле лужи на GPU (WebGL1, ping-pong FBO).
 *
 * Уравнение (единицы: px, с модельного времени):
 *   ∂²h/∂t² = a ∇²h − b ∇⁴h − β ∂h/∂t + S(x, t)
 * a, b — подгонка дисперсии гравитационно-капиллярных волн (waterParams.rippleDispersionFit),
 * β = 2νk_c² · dampingBoost, S — давление курсора (гауссово пятно вдоль отрезка движения).
 * Явная схема «чехарда» по времени, центральные разности по пространству:
 *   h⁺ = [2h − (1 − βΔt/2) h⁻ + aΔt²/Δx² · L(h) − bΔt²/Δx⁴ · L²(h) + Δt² S] / (1 + βΔt/2)
 * L — 5-точечный лапласиан, L² — 13-точечный бигармонический шаблон.
 * Устойчивость: ω_max Δt ≤ 2, ω_max² = 8a/Δx² + 64b/Δx⁴ (для b = 0 это CFL cΔt/Δx ≤ 1/√2).
 * Граница — контур лужи: Нейман ∂h/∂n = 0 (соседи снаружи маски берут значение центра),
 * поэтому волны отражаются от края.
 */
import {
  KINEMATIC_VISCOSITY,
  PX_TO_M,
  RIPPLE_ARTISTIC as R,
  RIPPLE_WAVELENGTH_M,
  rippleDispersionFit,
} from './waterParams'

export type SimFormat = 'float' | 'half' | 'pack'

/** Диапазон высоты для упаковки в RGBA8, px. */
export const PACK_RANGE_PX = 16

export const SIM_CODEC = `
#ifdef PACK
const float PACK_R = ${PACK_RANGE_PX.toFixed(1)};
vec2 enc16(float v) {
  float u = clamp(v / PACK_R * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}
float dec16(vec2 c) { return ((c.x * 255.0 * 256.0 + c.y * 255.0) / 65535.0 - 0.5) * 2.0 * PACK_R; }
vec2 decodeState(vec4 c) { return vec2(dec16(c.rg), dec16(c.ba)); }
vec4 encodeState(vec2 s) { return vec4(enc16(s.x), enc16(s.y)); }
#else
vec2 decodeState(vec4 c) { return c.rg; }
vec4 encodeState(vec2 s) { return vec4(s, 0.0, 1.0); }
#endif
`

const SIM_FRAGMENT = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;      // ячеек по x, y
uniform float uDx;       // CSS px на ячейку
uniform vec2 uSize;      // блок, CSS px
uniform float uRadius;
uniform float uA;        // a Δt²/Δx²
uniform float uB;        // b Δt²/Δx⁴
uniform float uBeta;     // β Δt
uniform vec4 uSeg;       // отрезок источника за подшаг, px
uniform float uSegAmp;   // Δt² S0, px
uniform float uSigma;
uniform vec3 uImpulse;   // x, y, глубина впадины (px), применяется один раз
uniform float uImpSigma;
uniform float uReset;
${SIM_CODEC}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
bool inside(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x > uGrid.x || c.y > uGrid.y) return false;
  return sdRoundBox(c * uDx - uSize * 0.5, uSize * 0.5, uRadius) < -0.5 * uDx;
}
vec2 st(vec2 c) { return decodeState(texture2D(uState, c / uGrid)); }
// Нейман: сосед за контуром = значение в центре (зеркальное отражение).
float H(vec2 c, float hc) { return inside(c) ? st(c).x : hc; }

void main() {
  vec2 c = gl_FragCoord.xy;
  if (uReset > 0.5 || !inside(c)) { gl_FragColor = encodeState(vec2(0.0)); return; }
  vec2 s = st(c);
  float h = s.x;
  float hp = s.y;
  float n4 = H(c + vec2(1.0, 0.0), h) + H(c - vec2(1.0, 0.0), h) + H(c + vec2(0.0, 1.0), h) + H(c - vec2(0.0, 1.0), h);
  float dg = H(c + vec2(1.0, 1.0), h) + H(c + vec2(1.0, -1.0), h) + H(c + vec2(-1.0, 1.0), h) + H(c + vec2(-1.0, -1.0), h);
  float f2 = H(c + vec2(2.0, 0.0), h) + H(c - vec2(2.0, 0.0), h) + H(c + vec2(0.0, 2.0), h) + H(c - vec2(0.0, 2.0), h);
  // Изотропный 9-точечный лапласиан (Oono–Puri): анизотропия O(k⁴) вместо O(k²),
  // фронт кольца остаётся круглым, а не «квадратным».
  float lap = (4.0 * n4 + dg - 20.0 * h) / 6.0;
  float bih = 20.0 * h - 8.0 * n4 + 2.0 * dg + f2;

  vec2 p = c * uDx;
  // Источник вдоль отрезка (капсула): движение интерполировано, пунктира нет.
  vec2 ab = uSeg.zw - uSeg.xy;
  float t = clamp(dot(p - uSeg.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  vec2 dv = p - uSeg.xy - ab * t;
  float src = uSegAmp * exp(-dot(dv, dv) / (2.0 * uSigma * uSigma));

  float hn = (2.0 * h - (1.0 - 0.5 * uBeta) * hp + uA * lap - uB * bih - src) / (1.0 + 0.5 * uBeta);
  vec2 di = p - uImpulse.xy;
  float imp = -uImpulse.z * exp(-dot(di, di) / (2.0 * uImpSigma * uImpSigma));
  gl_FragColor = encodeState(vec2(hn + imp, h + imp));
}
`

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const HALF_FLOAT_OES = 0x8d61

function tryFormat(gl: WebGLRenderingContext, type: number): boolean {
  const tex = gl.createTexture()
  const fb = gl.createFramebuffer()
  if (!tex || !fb) return false
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fb)
  gl.deleteTexture(tex)
  return ok
}

/** float → half-float → упаковка 16 бит в RGBA8. */
export function detectSimFormat(gl: WebGLRenderingContext): SimFormat {
  if (gl.getExtension('OES_texture_float') && tryFormat(gl, gl.FLOAT)) return 'float'
  if (gl.getExtension('OES_texture_half_float') && tryFormat(gl, HALF_FLOAT_OES)) return 'half'
  return 'pack'
}

export interface SimInput {
  /** Отрезок движения курсора за кадр, px блока; amp — ускорение источника, px/с². */
  seg: { ax: number; ay: number; bx: number; by: number; accel: number } | null
  impulse: { x: number; y: number } | null
}

export class RippleSim {
  readonly format: SimFormat
  private gl: WebGLRenderingContext
  private program: WebGLProgram
  private shaders: WebGLShader[] = []
  private tex: WebGLTexture[] = []
  private fbo: WebGLFramebuffer[] = []
  private cur = 0
  private loc: Record<string, WebGLUniformLocation | null>
  private type: number
  grid: [number, number] = [1, 1]
  dx = 1
  /** Фиксированный шаг модельного времени, с. */
  dt = 0
  private acc = 0
  private beta = 0
  /** 1/β в реальном времени, мс. */
  settleMs = 0
  private size: [number, number] = [1, 1]

  constructor(gl: WebGLRenderingContext, format: SimFormat, compile: (t: number, s: string) => WebGLShader) {
    this.gl = gl
    this.format = format
    this.type = format === 'float' ? gl.FLOAT : format === 'half' ? HALF_FLOAT_OES : gl.UNSIGNED_BYTE
    const defs = format === 'pack' ? '#define PACK 1\n' : ''
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, defs + SIM_FRAGMENT)
    this.shaders.push(vs, fs)
    const program = gl.createProgram()
    if (!program) throw new Error('sim program')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPos')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('sim link')
    this.program = program
    const names = ['uState', 'uGrid', 'uDx', 'uSize', 'uRadius', 'uA', 'uB', 'uBeta', 'uSeg', 'uSegAmp', 'uSigma', 'uImpulse', 'uImpSigma', 'uReset']
    this.loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]))
  }

  /** Пересоздаёт сетку под размер блока; шаг по времени — из условия устойчивости. */
  resize(cssW: number, cssH: number, radius: number, long: number) {
    const gl = this.gl
    this.dx = Math.max(cssW, cssH) / long
    const gw = Math.max(4, Math.round(cssW / this.dx))
    const gh = Math.max(4, Math.round(cssH / this.dx))
    this.size = [cssW, cssH]
    if (gw !== this.grid[0] || gh !== this.grid[1] || this.tex.length === 0) {
      this.freeTargets()
      this.grid = [gw, gh]
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture()
        const f = gl.createFramebuffer()
        if (!t || !f) throw new Error('sim target')
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, this.type, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindFramebuffer(gl.FRAMEBUFFER, f)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
        this.tex.push(t)
        this.fbo.push(f)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    // Физика → px. a [м²/с²] → px²/с², b [м⁴/с²] → px⁴/с².
    const kc = (2 * Math.PI) / RIPPLE_WAVELENGTH_M
    const { a, b } = rippleDispersionFit(kc)
    const aPx = a / PX_TO_M ** 2
    const bPx = b / PX_TO_M ** 4
    const dx2 = this.dx * this.dx
    const omegaMax = Math.sqrt((8 * aPx) / dx2 + (64 * bPx) / (dx2 * dx2))
    this.dt = (R.stabilitySafety * 2) / omegaMax
    this.beta = 2 * KINEMATIC_VISCOSITY * kc * kc * R.dampingBoost
    this.settleMs = (1000 / (this.beta * R.timeScale)) * R.settleTimeConstants
    const dt2 = this.dt * this.dt
    gl.useProgram(this.program)
    gl.uniform2f(this.loc.uGrid, gw, gh)
    gl.uniform1f(this.loc.uDx, this.dx)
    gl.uniform2f(this.loc.uSize, cssW, cssH)
    gl.uniform1f(this.loc.uRadius, radius)
    gl.uniform1f(this.loc.uA, (aPx * dt2) / dx2)
    gl.uniform1f(this.loc.uB, (bPx * dt2) / (dx2 * dx2))
    gl.uniform1f(this.loc.uBeta, this.beta * this.dt)
    gl.uniform1f(this.loc.uSigma, R.spotSigmaPx)
    gl.uniform1f(this.loc.uImpSigma, R.impulseSigmaPx)
    gl.uniform1i(this.loc.uState, 3)
    this.clear()
  }

  /** Обнулить поле (после успокоения или при смене размера). */
  clear() {
    this.pass(() => this.gl.uniform1f(this.loc.uReset, 1))
    this.pass(() => this.gl.uniform1f(this.loc.uReset, 1))
    this.acc = 0
  }

  private pass(setup: () => void) {
    const gl = this.gl
    if (this.tex.length < 2) return
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur])
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.cur])
    gl.viewport(0, 0, this.grid[0], this.grid[1])
    gl.uniform1f(this.loc.uReset, 0)
    gl.uniform3f(this.loc.uImpulse, 0, 0, 0)
    gl.uniform1f(this.loc.uSegAmp, 0)
    gl.uniform4f(this.loc.uSeg, -1e4, -1e4, -1e4, -1e4)
    setup()
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur
  }

  /**
   * Продвигает поле на dtReal реальных секунд фиксированными подшагами dt.
   * Отрезок курсора делится между подшагами: источник движется непрерывно.
   */
  step(dtReal: number, input: SimInput) {
    this.acc += Math.min(dtReal, 1 / 20) * R.timeScale
    let n = Math.floor(this.acc / this.dt)
    if (n > R.maxSubsteps) {
      n = R.maxSubsteps
      this.acc = 0
    } else {
      this.acc -= n * this.dt
    }
    if (n === 0 && input.impulse) n = 1
    const gl = this.gl
    const dt2 = this.dt * this.dt
    for (let i = 0; i < n; i++) {
      this.pass(() => {
        if (i === 0 && input.impulse) {
          gl.uniform3f(this.loc.uImpulse, input.impulse.x, input.impulse.y, R.impulseDepthPx)
        }
        const s = input.seg
        if (s) {
          const t0 = i / n
          const t1 = (i + 1) / n
          const ax = s.ax + (s.bx - s.ax) * t0
          const ay = s.ay + (s.by - s.ay) * t0
          const bx = s.ax + (s.bx - s.ax) * t1
          const by = s.ay + (s.by - s.ay) * t1
          // Пятно, «размазанное» по подотрезку длины ℓ, — среднее по времени подшага:
          // интенсивность делится на (ℓ + σ√(2π)) / (σ√(2π)), импульс сохраняется.
          const w = R.spotSigmaPx * Math.sqrt(2 * Math.PI)
          const len = Math.hypot(bx - ax, by - ay)
          gl.uniform4f(this.loc.uSeg, ax, ay, bx, by)
          gl.uniform1f(this.loc.uSegAmp, dt2 * s.accel * (w / (len + w)))
        }
      })
    }
  }

  /** Привязать текущее поле к текстурному блоку для шейдера отрисовки. */
  bind(unit: number) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur])
  }

  get cssSize() {
    return this.size
  }

  private freeTargets() {
    this.tex.forEach((t) => this.gl.deleteTexture(t))
    this.fbo.forEach((f) => this.gl.deleteFramebuffer(f))
    this.tex = []
    this.fbo = []
    this.cur = 0
  }

  dispose() {
    this.freeTargets()
    this.shaders.forEach((s) => this.gl.deleteShader(s))
    this.gl.deleteProgram(this.program)
  }
}
