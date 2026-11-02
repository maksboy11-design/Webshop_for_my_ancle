/**
 * «Видео о товаре» и дополнительные блоки (таблица, преимущества, инфо, фото, галерея).
 * Всё сохраняется в черновик product_content кнопкой «Сохранить блоки»; на сайт — только «Опубликовать описание».
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  EXTRA_LABEL,
  parseVideoLink,
  VIDEOS_MAX,
  EXTRAS_MAX,
  type BlockImage,
  type ExtraType,
  type ExtrasPayload,
  type ExtrasView,
  type VideoItem,
} from '../../cms/richBlocks'
import { VideoCard } from '../../components/site/ProductExtras'
import styles from '../App.module.css'
import admin from '../Admin.module.css'
import m from '../media/Media.module.css'
import { MediaPicker } from '../media/ProductMedia'
import { DropZone, IMAGE_ACCEPT, useDevicePicker, useMediaUploads } from '../media/MediaUploads'
import type { MediaItem } from '../media/mediaApi'
import type { MediaKind } from '../../cms/mediaTypes'
import { BLOCK_EDITORS, BLOCK_TYPE_OPTIONS, mediaToBlockImage, type EditBlock } from './blockEditors'
import { duplicateAt, newBlockId, removeAt } from './listOps'
import { ReorderList } from './Reorder'
import { extrasPayload } from './listOps'

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const PROVIDER: Record<VideoItem['provider'], string> = { upload: 'Файл', youtube: 'YouTube', vk: 'VK Видео', rutube: 'Rutube' }

type Picker = { kind: MediaKind; multiple: boolean; onPick: (list: MediaItem[]) => void }

export function ProductExtrasPanel({
  initData,
  productId,
  productName,
  initial,
  disabled,
  onSave,
  onDirty,
}: {
  initData: string
  productId: string
  productName: string
  initial: ExtrasView
  disabled?: boolean
  onSave: (payload: ExtrasPayload) => Promise<ExtrasView | null>
  onDirty?: (dirty: boolean) => void
}) {
  const [base, setBase] = useState(() => JSON.stringify(extrasPayload(initial.blocks, initial.showVideos, initial.videos)))
  const [blocks, setBlocks] = useState<EditBlock[]>(() => clone(initial.blocks))
  const [videos, setVideos] = useState<VideoItem[]>(() => clone(initial.videos))
  const [showVideos, setShowVideos] = useState(initial.showVideos)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [newType, setNewType] = useState<ExtraType>('specs_table')
  const [picker, setPicker] = useState<Picker | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const { onDone, enqueue } = useMediaUploads()
  const device = useDevicePicker()
  const payload = useMemo(() => extrasPayload(blocks, showVideos, videos), [blocks, showVideos, videos])
  const dirty = JSON.stringify(payload) !== base
  useEffect(() => onDirty?.(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  const target = { type: 'product' as const, productId, productName, slot: 'block' as const }

  // Загруженные файлы для блоков: replace = `${что}:${ключ}`.
  useEffect(
    () =>
      onDone((item) => {
        const t = item.target
        if (t.type !== 'product' || t.productId !== productId || t.slot !== 'block' || !item.media || !t.replace) return
        const media = item.media
        const [what, key] = t.replace.split(':') as [string, string]
        if (media.kind === 'video' && what === 'video') {
          const v: VideoItem = {
            key: key === 'new' ? newBlockId('v') : key,
            provider: 'upload',
            src: media.url,
            mediaId: media.id,
            title: '',
            description: '',
            poster: null,
          }
          setVideos((list) =>
            key === 'new'
              ? [...list, v].slice(0, VIDEOS_MAX)
              : list.map((x) => (x.key === key ? { ...v, title: x.title, description: x.description, poster: x.poster } : x)),
          )
          return
        }
        if (media.kind !== 'image') return
        const img: BlockImage = { mediaId: media.id, src: media.thumb ?? media.url, width: 1, height: 1 }
        if (what === 'cover')
          setVideos((list) => list.map((x) => (x.key === key ? { ...x, poster: { src: img.src, mediaId: img.mediaId } } : x)))
        if (what === 'image' || what === 'gallery')
          setBlocks((list) =>
            list.map((b) =>
              b.id !== key
                ? b
                : what === 'image'
                  ? { ...b, content: { ...b.content, image: img } }
                  : { ...b, content: { ...b.content, items: [...((b.content.items as BlockImage[]) ?? []), img].slice(0, 30) } },
            ),
          )
      }),
    [onDone, productId],
  )

  const addLink = () => {
    const p = parseVideoLink(link)
    if (!p) {
      setLinkError('Ссылка не поддерживается. Можно: YouTube, VK Видео, Rutube.')
      return
    }
    setLinkError(null)
    setVideos((list) =>
      [
        ...list,
        {
          key: newBlockId('v'),
          provider: p.provider,
          src: p.embed,
          link: link.trim(),
          title: '',
          description: '',
          poster: p.poster ? { src: p.poster } : null,
        },
      ].slice(0, VIDEOS_MAX),
    )
    setLink('')
  }

  const replaceLink = (key: string, raw: string) => {
    const p = parseVideoLink(raw)
    if (!p) {
      setLinkError('Ссылка не поддерживается. Можно: YouTube, VK Видео, Rutube.')
      return false
    }
    setLinkError(null)
    setVideos((list) =>
      list.map((x) =>
        x.key === key
          ? {
              ...x,
              provider: p.provider,
              src: p.embed,
              link: raw.trim(),
              mediaId: undefined,
              poster: x.poster?.mediaId ? x.poster : p.poster ? { src: p.poster } : null,
            }
          : x,
      ),
    )
    return true
  }

  const patchVideo = (key: string, p: Partial<VideoItem>) => setVideos((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const patchBlock = (id: string, p: Partial<EditBlock>) => setBlocks((list) => list.map((b) => (b.id === id ? { ...b, ...p } : b)))

  const save = async () => {
    setStatus('saving')
    const sent = JSON.stringify(payload)
    const view = await onSave(payload)
    if (!view) {
      setStatus('error')
      return
    }
    // Сервер подставил адреса медиа/обложек — берём его версию, если пока не правили дальше.
    setBase(JSON.stringify(extrasPayload(view.blocks, view.showVideos, view.videos)))
    if (JSON.stringify(extrasPayload(blocks, showVideos, videos)) === sent) {
      setBlocks(clone(view.blocks))
      setVideos(clone(view.videos))
      setShowVideos(view.showVideos)
    }
    setStatus('saved')
  }

  const ctx = {
    disabled,
    pickImages: (multiple: boolean, onPick: (images: BlockImage[]) => void) =>
      setPicker({ kind: 'image', multiple, onPick: (list) => onPick((multiple ? list : list.slice(0, 1)).map(mediaToBlockImage)) }),
    uploadDevice: (kind: 'image' | 'gallery', id: string) =>
      device.open(IMAGE_ACCEPT, kind === 'gallery', (files) =>
        enqueue(kind === 'gallery' ? files : files.slice(0, 1), { ...target, replace: `${kind}:${id}` }),
      ),
    uploadZone: (kind: 'image' | 'gallery', id: string): ReactNode => (
      <DropZone
        target={{ ...target, replace: `${kind}:${id}` }}
        accept={IMAGE_ACCEPT}
        label="Или перетащите фото сюда"
        testId={`block-drop-${id}`}
      />
    ),
  }

  return (
    <>
      {device.input}
      <fieldset className={admin.fieldset} disabled={disabled} data-testid="product-videos-editor">
        <legend className={admin.legend}>Видео о товаре ({videos.length})</legend>
        <label className={admin.check}>
          <input type="checkbox" checked={showVideos} data-testid="videos-toggle" onChange={(e) => setShowVideos(e.target.checked)} />{' '}
          Показывать раздел «Видео о товаре» на сайте
        </label>
        {showVideos && !videos.length ? <p className={m.hintText}>Нет видео — раздел на сайте не появится.</p> : null}
        <ReorderList
          items={videos}
          keyOf={(v) => v.key}
          label={(_, i) => `Видео ${i + 1}`}
          onChange={setVideos}
          disabled={disabled}
          testId="video-list"
          render={(v, i, controls) => (
            <div style={{ display: 'grid', gap: 6, flex: '1 1 100%' }} data-testid="video-item">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {controls}
                <strong>
                  {i + 1}. {PROVIDER[v.provider]}
                </strong>
                {v.poster ? (
                  <img src={v.poster.src} alt="Обложка" width={64} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <span className={m.hintText}>без обложки</span>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className={m.linkBtn} onClick={() => setPreview(preview === v.key ? null : v.key)}>
                  {preview === v.key ? 'Скрыть просмотр' : 'Просмотр'}
                </button>
                <button type="button" className={m.linkBtn} onClick={() => setReplacing(replacing === v.key ? null : v.key)}>
                  Заменить
                </button>
                <button
                  type="button"
                  className={m.dangerLink}
                  aria-label={`Удалить видео ${i + 1}`}
                  onClick={() => window.confirm('Удалить видео из списка?') && setVideos(removeAt(videos, i))}
                >
                  Удалить
                </button>
              </div>
              <input
                className={styles.input}
                aria-label={`Название видео ${i + 1}`}
                placeholder="Название"
                maxLength={200}
                value={v.title}
                onChange={(e) => patchVideo(v.key, { title: e.target.value })}
              />
              <textarea
                className={styles.input}
                aria-label={`Описание видео ${i + 1}`}
                placeholder="Короткое описание (необязательно)"
                rows={2}
                maxLength={600}
                value={v.description}
                onChange={(e) => patchVideo(v.key, { description: e.target.value })}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={m.hintText}>Обложка:</span>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() =>
                    setPicker({
                      kind: 'image',
                      multiple: false,
                      onPick: ([x]) => x && patchVideo(v.key, { poster: { src: x.thumb ?? x.url, mediaId: x.id } }),
                    })
                  }
                >
                  Выбрать из медиатеки
                </button>
                <label className={styles.btn}>
                  Загрузить
                  <UploadInput accept={IMAGE_ACCEPT} label={`Обложка видео ${i + 1}`} target={{ ...target, replace: `cover:${v.key}` }} />
                </label>
                {v.poster?.mediaId ? (
                  <button
                    type="button"
                    className={m.linkBtn}
                    onClick={() => {
                      const auto = v.link ? parseVideoLink(v.link)?.poster : null
                      patchVideo(v.key, { poster: auto ? { src: auto } : null })
                    }}
                  >
                    Убрать свою обложку
                  </button>
                ) : null}
              </div>
              {replacing === v.key ? (
                <ReplaceVideo
                  video={v}
                  onLink={(raw) => replaceLink(v.key, raw) && setReplacing(null)}
                  onPick={() =>
                    setPicker({
                      kind: 'video',
                      multiple: false,
                      onPick: ([x]) => x && patchVideo(v.key, { provider: 'upload', src: x.url, mediaId: x.id, link: undefined }),
                    })
                  }
                  target={{ ...target, replace: `video:${v.key}` }}
                />
              ) : null}
              {preview === v.key ? (
                <div style={{ maxWidth: 480 }} data-testid="video-preview">
                  <VideoCard video={v} />
                </div>
              ) : null}
            </div>
          )}
        />
        {videos.length < VIDEOS_MAX ? (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input
                className={styles.input}
                style={{ flex: '1 1 16rem' }}
                aria-label="Ссылка на видео"
                placeholder="Ссылка YouTube, VK Видео или Rutube"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())}
              />
              <button type="button" className={styles.btn} disabled={!link.trim()} onClick={addLink}>
                Добавить ссылку
              </button>
            </div>
            {linkError ? (
              <p className={styles.error} role="alert">
                {linkError}
              </p>
            ) : null}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => device.open(VIDEO_ACCEPT, true, (files) => enqueue(files, { ...target, replace: 'video:new' }))}
            >
              Добавить видео
            </button>
            <DropZone
              target={{ ...target, replace: 'video:new' }}
              accept={VIDEO_ACCEPT}
              label="Перетащите видео (MP4, WebM, MOV)"
              testId="video-drop"
            />
            <button
              type="button"
              className={styles.btn}
              onClick={() =>
                setPicker({
                  kind: 'video',
                  multiple: true,
                  onPick: (list) =>
                    setVideos((cur) =>
                      [
                        ...cur,
                        ...list.map((x): VideoItem => ({
                          key: newBlockId('v'),
                          provider: 'upload',
                          src: x.url,
                          mediaId: x.id,
                          title: '',
                          description: '',
                          poster: null,
                        })),
                      ].slice(0, VIDEOS_MAX),
                    ),
                })
              }
            >
              Выбрать видео из медиатеки
            </button>
          </>
        ) : null}
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled} data-testid="product-blocks-editor">
        <legend className={admin.legend}>Дополнительные блоки ({blocks.length})</legend>
        <p className={m.hintText}>Показываются на сайте после описания, в этом порядке. Пустые и выключенные блоки не выводятся.</p>
        <ReorderList
          items={blocks}
          keyOf={(b) => b.id}
          label={(b, i) => `Блок ${i + 1} (${EXTRA_LABEL[b.type]})`}
          onChange={setBlocks}
          disabled={disabled}
          testId="block-list"
          render={(b, i, controls) => {
            const { Editor } = BLOCK_EDITORS[b.type]
            return (
              <div style={{ display: 'grid', gap: 6, flex: '1 1 100%' }} data-testid="extra-block" data-type={b.type}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {controls}
                  <strong>
                    {i + 1}. {EXTRA_LABEL[b.type]}
                  </strong>
                  <label className={admin.check}>
                    <input type="checkbox" checked={b.active} onChange={(e) => patchBlock(b.id, { active: e.target.checked })} /> Показывать
                  </label>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className={m.linkBtn}
                    disabled={blocks.length >= EXTRAS_MAX}
                    aria-label={`Дублировать блок ${i + 1}`}
                    onClick={() => setBlocks(duplicateAt(blocks, i, (x) => ({ ...clone(x), id: newBlockId() })))}
                  >
                    Дублировать
                  </button>
                  <button
                    type="button"
                    className={m.dangerLink}
                    aria-label={`Удалить блок ${i + 1}`}
                    onClick={() => window.confirm('Удалить блок?') && setBlocks(removeAt(blocks, i))}
                  >
                    Удалить
                  </button>
                </div>
                <Editor block={b} onChange={(content) => patchBlock(b.id, { content })} ctx={ctx} />
              </div>
            )
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select
            className={styles.input}
            aria-label="Тип нового блока"
            value={newType}
            onChange={(e) => setNewType(e.target.value as ExtraType)}
          >
            {BLOCK_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.btn}
            data-testid="add-block"
            disabled={blocks.length >= EXTRAS_MAX}
            onClick={() =>
              setBlocks([...blocks, { id: newBlockId(), type: newType, active: true, content: BLOCK_EDITORS[newType].empty() }])
            }
          >
            Добавить блок
          </button>
        </div>
      </fieldset>

      <div className={admin.publishRow}>
        <span className={admin.hint} data-testid="extras-status" role="status">
          {status === 'saving'
            ? 'Сохранение…'
            : status === 'error'
              ? 'Не сохранено — см. ошибку выше.'
              : dirty
                ? 'Есть несохранённые изменения блоков и видео.'
                : status === 'saved'
                  ? 'Сохранено в черновик. На сайт — кнопкой «Опубликовать описание».'
                  : 'Блоки и видео попадают на сайт после «Опубликовать описание».'}
        </span>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          data-testid="extras-save"
          disabled={disabled || !dirty || status === 'saving'}
          onClick={() => void save()}
        >
          Сохранить блоки и видео
        </button>
      </div>

      {picker ? (
        <MediaPicker
          initData={initData}
          kind={picker.kind}
          exclude={new Set()}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            picker.onPick(list.filter((x) => x.status === 'ready'))
            setPicker(null)
          }}
        />
      ) : null}
    </>
  )
}

function UploadInput({
  accept,
  label,
  target,
}: {
  accept: string
  label: string
  target: Parameters<ReturnType<typeof useMediaUploads>['enqueue']>[1]
}) {
  const { enqueue } = useMediaUploads()
  return (
    <input
      type="file"
      accept={accept}
      className={m.fileInput}
      aria-label={label}
      onChange={(e) => {
        if (e.target.files?.length) enqueue([e.target.files[0]!], target)
        e.target.value = ''
      }}
    />
  )
}

function ReplaceVideo({
  video,
  onLink,
  onPick,
  target,
}: {
  video: VideoItem
  onLink: (raw: string) => void
  onPick: () => void
  target: Parameters<ReturnType<typeof useMediaUploads>['enqueue']>[1]
}) {
  const [raw, setRaw] = useState(video.link ?? '')
  return (
    <div style={{ display: 'grid', gap: 6 }} data-testid="video-replace">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          className={styles.input}
          style={{ flex: '1 1 16rem' }}
          aria-label="Новая ссылка на видео"
          placeholder="Новая ссылка"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <button type="button" className={styles.btn} disabled={!raw.trim()} onClick={() => onLink(raw)}>
          Заменить ссылкой
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <label className={styles.btn}>
          Загрузить другой файл
          <UploadInput accept={VIDEO_ACCEPT} label="Файл для замены видео" target={target} />
        </label>
        <button type="button" className={styles.btn} onClick={onPick}>
          Из медиатеки
        </button>
      </div>
    </div>
  )
}
