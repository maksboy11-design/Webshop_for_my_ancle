import type { ExtrasPayload, VideoItem } from '../../cms/richBlocks'
import type { EditBlock } from './blockEditors'
/** Операции над упорядоченным списком (общие для блоков, видео и будущего редактора страниц). */
export { duplicateAt, moveItem, newBlockId, removeAt } from './arrayOps'

export function extrasPayload(blocks: EditBlock[], showVideos: boolean, videos: VideoItem[]): ExtrasPayload {
  return {
    blocks,
    showVideos,
    videos: videos.map((v) => ({
      key: v.key,
      ...(v.provider === 'upload' ? { mediaId: v.mediaId } : { link: v.link ?? v.src }),
      title: v.title,
      description: v.description,
      poster: v.poster?.mediaId ? { mediaId: v.poster.mediaId } : null,
    })),
  }
}
