/** Фото и документы товара из медиатеки (product_media): каждое действие сохраняется сразу. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes, type MediaKind } from '../../cms/mediaTypes'
import { adminErrorText, AdminHttpError } from '../adminHttp'
import styles from '../App.module.css'
import admin from '../Admin.module.css'
import m from './Media.module.css'
import { MediaPager, MediaTile, MediaToolbar, useMediaList } from './MediaBrowser'
import { mediaApi, type MediaItem, type ProductMediaItem } from './mediaApi'
import { DropZone, IMAGE_ACCEPT, useMediaUploads } from './MediaUploads'

export const GALLERY_LIMIT = 30
const DOCS_LIMIT = 20
const DOC_ACCEPT = 'application/pdf'

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length || from === to) return list
  const next = list.slice()
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x!)
  return next
}

/** Первое фото — главное; на сайт: main = первое, gallery = все по порядку. */
function splitLinks(items: ProductMediaItem[]) {
  const main = items.find((i) => i.role === 'main')?.media
  const gallery = items.filter((i) => i.role === 'gallery').map((i) => i.media)
  const images = main ? [main, ...gallery.filter((g) => g.id !== main.id)] : gallery
  const docs = items.filter((i) => i.role === 'document').map((i) => i.media)
  return { images, docs }
}

export function ProductMediaPanel({
  initData,
  productId,
  productName,
  disabled,
  onAvailability,
}: {
  initData: string
  productId: string
  productName: string
  disabled?: boolean
  /** false — медиатека на сервере не включена: форма показывает прежний блок фото. */
  onAvailability: (available: boolean) => void
}) {
  const { onDone, setSuggested } = useMediaUploads()
  const [images, setImages] = useState<MediaItem[] | null>(null)
  const [docs, setDocs] = useState<MediaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState<MediaKind | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const imagesRef = useRef<MediaItem[]>([])
  const docsRef = useRef<MediaItem[]>([])
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const apply = useCallback((items: ProductMediaItem[]) => {
    const s = splitLinks(items)
    imagesRef.current = s.images
    docsRef.current = s.docs
    setImages(s.images)
    setDocs(s.docs)
  }, [])

  const load = useCallback(async () => {
    try {
      apply((await mediaApi.productMedia(initData, productId)).items)
      onAvailability(true)
    } catch (err) {
      if (err instanceof AdminHttpError && (err.code === 'media_unavailable' || err.status === 404 || err.status === 405))
        onAvailability(false)
      else setError(adminErrorText(err))
    }
  }, [apply, initData, productId, onAvailability])

  useEffect(() => {
    let stale = false
    mediaApi.productMedia(initData, productId).then(
      (r) => {
        if (stale) return
        apply(r.items)
        onAvailability(true)
      },
      (err) => {
        if (stale) return
        if (err instanceof AdminHttpError && (err.code === 'media_unavailable' || err.status === 404 || err.status === 405)) onAvailability(false)
        else setError(adminErrorText(err))
      },
    )
    return () => {
      stale = true
    }
  }, [apply, initData, productId, onAvailability])

  useEffect(() => {
    setSuggested({ type: 'product', productId, productName })
    return () => setSuggested(null)
  }, [productId, productName, setSuggested])

  /** Последовательные сохранения: следующее ждёт предыдущее, при ошибке — перечитываем с сервера. */
  const saveImages = useCallback(
    (next: MediaItem[]) => {
      imagesRef.current = next
      setImages(next)
      setSaving(true)
      chain.current = chain.current
        .then(() =>
          mediaApi.setProductMedia(initData, productId, [
            ...(next[0] ? [{ mediaId: next[0].id, role: 'main' as const }] : []),
            ...next.map((x) => ({ mediaId: x.id, role: 'gallery' as const })),
          ]),
        )
        .then(() => setError(null))
        .catch(async (err) => {
          setError(adminErrorText(err))
          await load()
        })
        .finally(() => setSaving(false))
    },
    [initData, productId, load],
  )
  const saveDocs = useCallback(
    (next: MediaItem[]) => {
      docsRef.current = next
      setDocs(next)
      setSaving(true)
      chain.current = chain.current
        .then(() =>
          mediaApi.setProductDocuments(
            initData,
            productId,
            next.map((d) => d.id),
          ),
        )
        .then(() => setError(null))
        .catch(async (err) => {
          setError(adminErrorText(err))
          await load()
        })
        .finally(() => setSaving(false))
    },
    [initData, productId, load],
  )

  const addMedia = useCallback(
    (list: MediaItem[], replace?: string) => {
      const imgs = list.filter((x) => x.kind === 'image' && x.status !== 'failed')
      const ds = list.filter((x) => x.kind === 'document')
      if (imgs.length) {
        let next = imagesRef.current.slice()
        for (const x of imgs) {
          if (replace && next.some((n) => n.id === replace))
            next = next.map((n) => (n.id === replace ? x : n)).filter((n, i, a) => a.findIndex((y) => y.id === n.id) === i)
          else if (!next.some((n) => n.id === x.id)) next.push(x)
        }
        if (next.length > GALLERY_LIMIT) {
          setError(`В галерее не больше ${GALLERY_LIMIT} фото — лишние файлы остались в медиатеке.`)
          next = next.slice(0, GALLERY_LIMIT)
        }
        saveImages(next)
      }
      if (ds.length) {
        let next = docsRef.current.slice()
        for (const x of ds) {
          if (replace && next.some((n) => n.id === replace)) next = next.map((n) => (n.id === replace ? x : n))
          else if (!next.some((n) => n.id === x.id)) next.push(x)
        }
        saveDocs(next.slice(0, DOCS_LIMIT))
      }
    },
    [saveImages, saveDocs],
  )

  useEffect(
    () =>
      onDone((item) => {
        if (item.target.type !== 'product' || item.target.productId !== productId || !item.media) return
        if (item.media.kind === 'video' || item.target.slot === 'block') return
        addMedia([item.media], item.target.replace)
      }),
    [onDone, productId, addMedia],
  )

  if (!images) return error ? <p className={styles.error}>{error}</p> : <p className={m.hintText}>Загрузка фото товара…</p>
  const target = { type: 'product' as const, productId, productName }

  return (
    <>
      <fieldset className={admin.fieldset} disabled={disabled} data-testid="product-gallery">
        <legend className={admin.legend}>
          Фото товара ({images.length}/{GALLERY_LIMIT}){saving ? ' · сохранение…' : ''}
        </legend>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {!images.length ? <p className={m.hintText}>Пока здесь пусто, на сайте показываются прежние фото товара.</p> : null}
        <p className={m.hintText}>Первое фото — главное. Порядок меняется перетаскиванием или стрелками; изменения сохраняются сразу.</p>
        <GalleryList
          images={images}
          onChange={saveImages}
          onOpen={setLightbox}
          replaceTarget={(id) => ({ ...target, slot: 'gallery', replace: id })}
        />
        <DropZone target={{ ...target, slot: 'gallery' }} accept={IMAGE_ACCEPT} label="Перетащите фото сюда" testId="gallery-drop" />
        <button type="button" className={styles.btn} onClick={() => setPicker('image')}>
          Выбрать из медиатеки
        </button>
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled} data-testid="product-documents">
        <legend className={admin.legend}>Документы ({docs.length})</legend>
        <p className={m.hintText}>PDF для скачивания на странице товара. Подпись видна покупателю.</p>
        <ul className={m.gList}>
          {docs.map((d, i) => (
            <li key={d.id} className={m.gItem} data-testid="product-doc">
              <span className={m.gThumb} aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                PDF
              </span>
              <div className={m.gMeta}>
                <DocTitle key={d.title ?? ''} initData={initData} doc={d} onSaved={(x) => saveDocsLocal(x)} />
                <span className={m.hintText}>
                  {d.name} · {formatBytes(d.size)} ·{' '}
                  <a href={d.url} target="_blank" rel="noreferrer">
                    открыть
                  </a>
                </span>
              </div>
              <div className={m.gActions}>
                <button
                  type="button"
                  className={m.iconBtn}
                  aria-label={`Документ ${i + 1} выше`}
                  disabled={i === 0}
                  onClick={() => saveDocs(move(docs, i, i - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={m.iconBtn}
                  aria-label={`Документ ${i + 1} ниже`}
                  disabled={i === docs.length - 1}
                  onClick={() => saveDocs(move(docs, i, i + 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={m.iconBtn}
                  aria-label={`Убрать документ ${i + 1}`}
                  onClick={() => saveDocs(docs.filter((x) => x.id !== d.id))}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
        <DropZone target={{ ...target, slot: 'documents' }} accept={DOC_ACCEPT} label="Перетащите PDF сюда" testId="documents-drop" />
        <button type="button" className={styles.btn} onClick={() => setPicker('document')}>
          Выбрать PDF из медиатеки
        </button>
      </fieldset>

      {picker ? (
        <MediaPicker
          initData={initData}
          kind={picker}
          exclude={new Set((picker === 'image' ? images : docs).map((x) => x.id))}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            setPicker(null)
            addMedia(list)
          }}
        />
      ) : null}
      {lightbox !== null && images[lightbox] ? (
        <Lightbox images={images} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      ) : null}
    </>
  )

  function saveDocsLocal(x: MediaItem) {
    const next = docsRef.current.map((d) => (d.id === x.id ? x : d))
    docsRef.current = next
    setDocs(next)
  }
}

function DocTitle({ initData, doc, onSaved }: { initData: string; doc: MediaItem; onSaved: (m: MediaItem) => void }) {
  const [value, setValue] = useState(doc.title ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const save = async () => {
    const v = value.trim()
    if (v === (doc.title ?? '')) return
    setState('saving')
    try {
      onSaved((await mediaApi.setTitle(initData, doc.id, v || null)).media)
      setState('saved')
    } catch {
      setState('error')
    }
  }
  return (
    <label className={m.hintText}>
      Подпись{state === 'saving' ? ' · сохранение…' : state === 'saved' ? ' · сохранено' : state === 'error' ? ' · не сохранилось' : ''}
      <input
        type="text"
        maxLength={120}
        value={value}
        placeholder={doc.name}
        aria-label={`Подпись документа ${doc.name}`}
        onChange={(e) => {
          setValue(e.target.value)
          setState('idle')
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{ display: 'block', width: '100%' }}
      />
    </label>
  )
}

function GalleryList({
  images,
  onChange,
  onOpen,
  replaceTarget,
}: {
  images: MediaItem[]
  onChange: (next: MediaItem[]) => void
  onOpen: (i: number) => void
  replaceTarget: (id: string) => Parameters<ReturnType<typeof useMediaUploads>['enqueue']>[1]
}) {
  const { enqueue } = useMediaUploads()
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  return (
    <ul className={m.gList} aria-label="Фото товара">
      {images.map((img, i) => (
        <li
          key={img.id}
          className={m.gItem}
          data-testid="gallery-item"
          draggable
          data-dragging={drag === i ? 'true' : undefined}
          data-over={over === i && drag !== null && drag !== i ? 'true' : undefined}
          onDragStart={(e) => {
            setDrag(i)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(i))
          }}
          onDragOver={(e) => {
            if (drag === null) return
            e.preventDefault()
            setOver(i)
          }}
          onDrop={(e) => {
            if (drag === null) return
            e.preventDefault()
            e.stopPropagation()
            onChange(move(images, drag, i))
            setDrag(null)
            setOver(null)
          }}
          onDragEnd={() => {
            setDrag(null)
            setOver(null)
          }}
        >
          <span className={m.dragHandle} aria-hidden="true">
            ⠿
          </span>
          <button type="button" className={m.gThumbBtn} aria-label={`Открыть фото ${i + 1}`} onClick={() => onOpen(i)}>
            {img.thumb ? <img className={m.gThumb} src={img.thumb} alt="" width={64} height={64} /> : <span className={m.gThumb} />}
          </button>
          <div className={m.gMeta}>
            {i === 0 ? <span className={m.mainBadge}>Главное</span> : null}
            <span className={m.tileName}>{img.name}</span>
            <span className={m.hintText}>
              {img.status === 'ready' ? formatBytes(img.size) : 'Обрабатывается — на сайте появится после обработки'}
            </span>
          </div>
          <div className={m.gActions}>
            <button
              type="button"
              className={m.iconBtn}
              aria-label={`Фото ${i + 1} выше`}
              disabled={i === 0}
              onClick={() => onChange(move(images, i, i - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className={m.iconBtn}
              aria-label={`Фото ${i + 1} ниже`}
              disabled={i === images.length - 1}
              onClick={() => onChange(move(images, i, i + 1))}
            >
              ↓
            </button>
            {i > 0 ? (
              <button
                type="button"
                className={m.iconBtn}
                aria-label={`Сделать фото ${i + 1} главным`}
                title="Сделать главным"
                onClick={() => onChange(move(images, i, 0))}
              >
                ★
              </button>
            ) : null}
            <label
              className={m.iconBtn}
              title="Заменить"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
            >
              ⇄
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                className={m.fileInput}
                aria-label={`Заменить фото ${i + 1}`}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) enqueue([f], replaceTarget(img.id))
                  e.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              className={m.iconBtn}
              aria-label={`Убрать фото ${i + 1}`}
              title="Убрать из товара (файл останется в медиатеке)"
              onClick={() => onChange(images.filter((x) => x.id !== img.id))}
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: MediaItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const img = images[index]!
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, images.length, onIndex, onClose])
  return (
    <div className={m.lightbox} role="dialog" aria-modal="true" aria-label="Просмотр фото" data-testid="lightbox" onClick={onClose}>
      <img src={img.variants.large?.url ?? img.url} alt={img.name} onClick={(e) => e.stopPropagation()} />
      <div className={m.lightboxBar} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={m.iconBtn} aria-label="Предыдущее фото" disabled={index === 0} onClick={() => onIndex(index - 1)}>
          ←
        </button>
        <span>
          {index + 1} / {images.length}
        </span>
        <button
          type="button"
          className={m.iconBtn}
          aria-label="Следующее фото"
          disabled={index === images.length - 1}
          onClick={() => onIndex(index + 1)}
        >
          →
        </button>
        <button type="button" className={m.iconBtn} aria-label="Закрыть просмотр" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}

export function MediaPicker({
  initData,
  kind,
  exclude,
  onPick,
  onClose,
}: {
  initData: string
  kind: MediaKind
  exclude: Set<string>
  onPick: (list: MediaItem[]) => void
  onClose: () => void
}) {
  const list = useMediaList(initData, { kind })
  const [sel, setSel] = useState<Map<string, MediaItem>>(new Map())
  const items = (list.data?.items ?? []).filter((x) => !exclude.has(x.id) && x.status !== 'failed')
  return (
    <div className={m.modal} role="dialog" aria-modal="true" aria-label="Выбор из медиатеки" data-testid="media-picker">
      <div className={m.modalBox}>
        <strong>Выбор из медиатеки</strong>
        <MediaToolbar list={list} fixedKind />
        {list.error ? <p className={styles.error}>{list.error}</p> : null}
        {list.data && !items.length ? <p className={m.hintText}>Подходящих файлов нет.</p> : null}
        <ul className={m.grid}>
          {items.map((item) => (
            <li key={item.id}>
              <MediaTile
                item={item}
                pressed={sel.has(item.id)}
                onClick={() =>
                  setSel((s) => {
                    const n = new Map(s)
                    if (n.has(item.id)) n.delete(item.id)
                    else n.set(item.id, item)
                    return n
                  })
                }
              />
            </li>
          ))}
        </ul>
        <MediaPager list={list} />
        <div className={styles.actionsRow}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!sel.size}
            onClick={() => onPick([...sel.values()])}
          >
            Добавить{sel.size ? ` (${sel.size})` : ''}
          </button>
          <button type="button" className={styles.btn} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
