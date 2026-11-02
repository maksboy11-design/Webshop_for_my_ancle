/**
 * Авто-обложка видео: кадр ~0.1s с локального файла (без CORS) или с URL (нужен CORS).
 * Кэш по сигнатуре File — чтобы успеть снять кадр до onDone загрузки видео.
 */
import { capturePosterFromFile, capturePosterFromSrc } from '../pages/videoProbe'

export function fileSig(f: File): string {
  return `${f.name}\0${f.size}\0${f.lastModified}`
}

/** Кэш локально снятых кадров до завершения загрузки видео. */
export class PendingAutoPosters {
  private readonly map = new Map<string, File>()

  /** Снять кадр с локального файла и положить в кэш (ошибка/CORS → тихий пропуск). */
  async stashFromVideoFile(file: File): Promise<File | null> {
    try {
      const poster = await capturePosterFromFile(file)
      if (poster) this.map.set(fileSig(file), poster)
      return poster
    } catch {
      return null
    }
  }

  take(file: File | null | undefined): File | null {
    if (!file) return null
    const k = fileSig(file)
    const p = this.map.get(k) ?? null
    this.map.delete(k)
    return p
  }

  /** Локальный кадр из кэша, иначе попытка с URL (CORS); null → публичный FirstFrame #t=0.001. */
  async resolve(file: File | null | undefined, videoUrl: string): Promise<File | null> {
    const local = this.take(file)
    if (local) return local
    try {
      return await capturePosterFromSrc(videoUrl)
    } catch {
      return null
    }
  }
}
