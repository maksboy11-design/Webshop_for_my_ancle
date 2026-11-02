import type { ExtrasPayload, ProductTab, VideoItem } from '../../cms/richBlocks'
import type { EditBlock } from './blockEditors'
/** Операции над упорядоченным списком (общие для блоков, видео и будущего редактора страниц). */
export { duplicateAt, moveItem, newBlockId, removeAt } from './arrayOps'

export function extrasPayload(
  blocks: EditBlock[],
  showVideos: boolean,
  videos: VideoItem[],
  tabs: ProductTab[] = [],
): ExtrasPayload {
  const ids = new Set(tabs.map((t) => t.id))
  return {
    tabs,
    blocks: blocks.map((b) => {
      const { tab, ...rest } = b
      return tab && ids.has(tab) ? { ...rest, tab } : rest
    }),
    showVideos,
    videos: videos.map((v) => ({
      key: v.key,
      ...(v.provider === 'upload' ? { mediaId: v.mediaId } : { link: v.link ?? v.src }),
      title: v.title,
      description: v.description,
      poster: v.poster?.mediaId ? { mediaId: v.poster.mediaId } : null,
      ...(v.tab && ids.has(v.tab) ? { tab: v.tab } : {}),
    })),
  }
}
