/**
 * Клиентская проверка видео для блока страницы перед загрузкой: формат (MP4/WebM), длительность, целостность.
 * Размер и сигнатуру (magic bytes) дополнительно проверяет сервер медиатеки; транскодирования нет.
 */
import { mimeOf, sniffMime } from '../../cms/mediaTypes'
import { VIDEO_MIMES } from '../../cms/pageDoc'

const envSeconds = Number((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PAGE_VIDEO_MAX_SECONDS)
/** Максимальная длительность видео блока (сек); настраивается VITE_PAGE_VIDEO_MAX_SECONDS. */
export const VIDEO_MAX_SECONDS = Number.isFinite(envSeconds) && envSeconds > 0 ? envSeconds : 600
export const VIDEO_ACCEPT = [...VIDEO_MIMES].join(',')

export interface VideoMeta {
  /** Метаданные прочитаны браузером. */
  loaded: boolean
  /** Браузер в принципе умеет этот формат (иначе метаданные не проверяем — проверит сервер). */
  canPlay: boolean
  duration: number
}

/** Чистая проверка (покрыта unit-тестами). Возвращает текст ошибки или null. */
export function checkVideoFile(
  name: string,
  type: string,
  head: Uint8Array,
  meta: VideoMeta,
  maxSeconds = VIDEO_MAX_SECONDS,
): string | null {
  const mime = mimeOf(name, type)
  if (!mime || !VIDEO_MIMES.has(mime)) return `«${name}»: нужен MP4 (H.264) или WebM.`
  const sniffed = sniffMime(head)
  if (sniffed !== mime) return `«${name}»: содержимое файла не похоже на ${mime === 'video/webm' ? 'WebM' : 'MP4'} — файл повреждён или переименован.`
  if (meta.canPlay && !meta.loaded) return `«${name}»: файл повреждён — браузер не может его прочитать.`
  if (meta.loaded && Number.isFinite(meta.duration) && meta.duration > maxSeconds)
    return `«${name}»: видео длиннее ${Math.round(maxSeconds / 60)} мин (${Math.round(meta.duration / 60)} мин).`
  return null
}

function readMeta(file: File, mime: string): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const canPlay = v.canPlayType(mime) !== ''
    if (!canPlay) return resolve({ loaded: false, canPlay, duration: NaN })
    const url = URL.createObjectURL(file)
    let done = false
    const finish = (m: VideoMeta) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      v.removeAttribute('src')
      resolve(m)
    }
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => finish({ loaded: true, canPlay, duration: v.duration })
    v.onerror = () => finish({ loaded: false, canPlay, duration: NaN })
    setTimeout(() => finish({ loaded: true, canPlay, duration: NaN }), 8000)
    v.src = url
  })
}

/** Проверка выбранных файлов; возвращает годные и тексты ошибок. */
export async function probeVideos(files: readonly File[]): Promise<{ ok: File[]; errors: string[] }> {
  const ok: File[] = []
  const errors: string[] = []
  for (const f of files) {
    const mime = mimeOf(f.name, f.type) ?? ''
    const head = new Uint8Array(await f.slice(0, 64).arrayBuffer())
    const meta = VIDEO_MIMES.has(mime) && sniffMime(head) === mime ? await readMeta(f, mime) : { loaded: false, canPlay: false, duration: NaN }
    const err = checkVideoFile(f.name, f.type, head, meta)
    if (err) errors.push(err)
    else ok.push(f)
  }
  return { ok, errors }
}

/** Кадр из видео как обложка (JPEG). null — кадр снять нельзя (CORS/кодек). */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) return resolve(null)
      const c = document.createElement('canvas')
      const k = Math.min(1, 1920 / w)
      c.width = Math.round(w * k)
      c.height = Math.round(h * k)
      c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.88)
    } catch {
      resolve(null)
    }
  })
}
