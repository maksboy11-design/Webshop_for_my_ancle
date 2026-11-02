import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice } from '../data/price'
import type { ProductImage } from '../data/products'
import { AdminHttpError, adminErrorText, productsApi, type AdminProductDetail, type ProductContentView } from './adminHttp'
// Токены сайта — чтобы предпросмотр описания выглядел ровно как на странице товара.
import '../styles/fonts-playfair.css'
import '../styles/tokens.css'
import styles from './App.module.css'
import admin from './Admin.module.css'
import { ProductMediaPanel } from './media/ProductMedia'
import { ProductExtrasPanel } from './blocks/ProductExtrasPanel'
import type { ExtrasPayload } from '../cms/richBlocks'
import {
  buildSet,
  descriptionForCompare,
  descriptionToSave,
  initialState,
  isDirty,
  move,
  parsePv,
  rubFromPv,
  type ProductFormState,
} from './productFormModel'
import {
  checkDocLimits,
  docCharCount,
  DOC_TEXT_MAX,
  emptyDoc,
  isDescriptionDoc,
  toEditableDoc,
  type DescriptionDoc,
} from '../cms/descriptionDoc'

function withNumbered(doc: DescriptionDoc, numbered: boolean): DescriptionDoc {
  const { numbered: _drop, ...rest } = doc
  void _drop
  return numbered ? { ...rest, numbered: true } : rest
}
import { DescriptionContent } from '../components/site/ProductDescriptionBlock'
import { ProductChecklistPanel } from './ProductChecklistPanel'
import { ProductAdaptivePreview } from './ProductAdaptivePreview'

const DescriptionEditor = lazy(() => import('./DescriptionEditor'))
const AUTOSAVE_MS = 1500
const DRAFT_PREFIX = 'silkway-admin:desc-draft:'

interface Draft {
  doc: DescriptionDoc
  savedAt: number
}

function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id)
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    return d && d.doc && d.doc.type === 'doc' ? d : null
  } catch {
    return null
  }
}
function writeDraft(id: string, doc: DescriptionDoc | null) {
  try {
    if (doc) localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ doc, savedAt: Date.now() }))
    else localStorage.removeItem(DRAFT_PREFIX + id)
  } catch {
    /* хранилище недоступно — черновик не критичен */
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type AutoStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid'

const UPLOAD_LIMIT = 3.8 * 1024 * 1024
const MAX_SIDE = 2400
const GALLERY_MAX = 12

/** Уменьшает фото на телефоне до отправки (сервер всё равно перекодирует в WebP и проверяет файл). */
async function prepareUpload(file: File): Promise<Blob> {
  const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  if (okType && file.size <= UPLOAD_LIMIT) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const quality of [0.88, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= UPLOAD_LIMIT) return blob
  }
  throw new Error('too_large')
}

interface Props {
  initData: string
  product: AdminProductDetail
  editable: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (product: AdminProductDetail) => void
  /** Автосохранение описания: обновить список, не пересоздавая форму. */
  onAutoSaved?: (product: AdminProductDetail) => void
  onDuplicated?: (newId: string) => void
}

function Thumb({ image, size = 72 }: { image: ProductImage; size?: number }) {
  return (
    <img className={admin.formThumb} src={image.thumb ?? image.src} alt="" width={size} height={size} loading="lazy" decoding="async" />
  )
}

export default function ProductForm({ initData, product, editable, onDirtyChange, onSaved, onAutoSaved, onDuplicated }: Props) {
  // Базовая версия: после автосохранения описания меняется только description (форма не пересоздаётся).
  const [original, setOriginal] = useState(product.merged)
  const [overridden, setOverridden] = useState(product.overridden)
  const [state, setState] = useState<ProductFormState>(() => initialState(product.merged))
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [resetToken, setResetToken] = useState(0)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('idle')
  const [autoError, setAutoError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(product.id)
    return d && !same(descriptionToSave(d.doc), descriptionForCompare(product.merged.description)) ? d : null
  })
  /**
   * Где живёт описание: 'draft' — черновик product_content (сайт не меняется до «Опубликовать»),
   * 'legacy' — старое хранилище (если сервер без миграции 007), 'loading' — ещё не знаем.
   */
  const [descMode, setDescMode] = useState<'loading' | 'draft' | 'legacy'>('loading')
  const [content, setContent] = useState<ProductContentView | null>(null)
  /** База сравнения описания: черновик, если он есть, иначе то, что сейчас на сайте. */
  const [baseline, setBaseline] = useState<DescriptionDoc | null>(() => descriptionForCompare(product.merged.description))
  const [numbered, setNumbered] = useState(
    () => isDescriptionDoc(product.merged.description) && product.merged.description.numbered === true,
  )
  const [publishing, setPublishing] = useState(false)
  const [versions, setVersions] = useState<{ rev: number; reason: string; createdAt: string }[] | null>(null)
  const [cmsBusy, setCmsBusy] = useState(false)
  const [showAdaptivePreview, setShowAdaptivePreview] = useState(false)
  const contentRef = useRef(content)
  const baselineRef = useRef(baseline)
  const stateRef = useRef(state)
  const originalRef = useRef(original)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    stateRef.current = state
    originalRef.current = original
    contentRef.current = content
    baselineRef.current = baseline
  })
  /** Все запросы (автосохранение и ручное) идут строго по очереди — без гонок и перезаписи. */
  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(fn, fn)
    queue.current = run.catch(() => undefined)
    return run
  }, [])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = useMemo(() => isDirty(state, original, { skipDescription: descMode !== 'legacy' }), [state, original, descMode])
  const disabled = !editable || saving || uploading !== null
  /** null — проверяем; false — медиатека не включена на сервере, работает прежний блок фото. */
  const [mediaAvailable, setMediaAvailable] = useState<boolean | null>(null)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const patch = (p: Partial<ProductFormState>) => setState((s) => ({ ...s, ...p }))

  const count = useMemo(() => docCharCount(state.doc), [state.doc])
  const limits = useMemo(() => {
    const r = checkDocLimits(state.doc)
    const near = count >= Math.floor(DOC_TEXT_MAX * 0.9)
    return {
      over: !r.ok,
      near,
      message: !r.ok ? r.message : near ? `Близко к лимиту: осталось ${DOC_TEXT_MAX - count} символов.` : null,
    }
  }, [state.doc, count])
  /** Документ целиком (с флагом нумерации секций) — то, что уходит в черновик и в предпросмотр. */
  const fullDoc = useMemo<DescriptionDoc>(() => withNumbered(state.doc, numbered), [state.doc, numbered])
  const fullDocRef = useRef(fullDoc)
  useEffect(() => {
    fullDocRef.current = fullDoc
  })
  const previewDoc = useMemo(() => (mode === 'preview' ? descriptionToSave(fullDoc) : null), [mode, fullDoc])
  const descDirty = useMemo(() => descMode !== 'loading' && !same(descriptionToSave(fullDoc), baseline), [fullDoc, baseline, descMode])

  // Загрузка черновика описания. Нет таблицы/ответа — работаем по-старому (сохранение сразу на сайт).
  useEffect(() => {
    let alive = true
    productsApi
      .content(initData, product.id)
      .then((res) => {
        if (!alive) return
        const c = res && typeof res === 'object' ? res.content : undefined
        if (!c || typeof c.draftRev !== 'number') {
          setDescMode('legacy')
          return
        }
        setContent(c)
        if (c.draftDoc) {
          const base = descriptionForCompare(c.draftDoc)
          setBaseline(base)
          setNumbered(c.draftDoc.numbered === true)
          setState((s) => ({ ...s, doc: toEditableDoc(c.draftDoc) }))
          setResetToken((n) => n + 1)
          setDraft((d) => (d && same(descriptionToSave(withNumbered(d.doc, c.draftDoc!.numbered === true)), base) ? null : d))
        }
        setDescMode('draft')
      })
      .catch(() => {
        // content_unavailable (нет миграции 007) или сбой сети — прежний путь, текст не теряется.
        if (alive) setDescMode('legacy')
      })
    return () => {
      alive = false
    }
  }, [initData, product.id])

  // Локальный черновик: защищает от потери текста при закрытии мини-приложения/обрыве сети.
  useEffect(() => {
    if (draft) return // пока пользователь не решил судьбу старого черновика — не перезаписываем его
    const t = window.setTimeout(() => writeDraft(product.id, descDirty ? fullDoc : null), 300)
    return () => window.clearTimeout(t)
  }, [fullDoc, descDirty, draft, product.id])

  const autosave = useCallback(
    () =>
      exclusive(async () => {
        const doc = fullDocRef.current
        const value = descriptionToSave(doc)
        if (same(value, baselineRef.current)) {
          setAutoStatus('saved')
          return
        }
        if (!checkDocLimits(doc).ok) {
          setAutoStatus('invalid')
          return
        }
        setAutoStatus('saving')
        if (descMode === 'draft') {
          try {
            const res = await productsApi.saveDraft(initData, product.id, value ?? emptyDoc(), contentRef.current?.draftRev ?? 0)
            setContent(res.content)
            setBaseline(value)
            setAutoError(null)
            setAutoStatus('saved')
            if (same(fullDocRef.current, doc)) writeDraft(product.id, null)
          } catch (err) {
            // Конфликт: берём свежую ревизию, но текст в редакторе не трогаем — следующее сохранение его запишет.
            const fresh = err instanceof AdminHttpError ? (err.body.content as ProductContentView | undefined) : undefined
            if (fresh && typeof fresh.draftRev === 'number') setContent(fresh)
            setAutoError(adminErrorText(err))
            setAutoStatus('error')
          }
          return
        }
        try {
          const res = await productsApi.patch(initData, product.id, { set: { description: value } })
          setOriginal((o) => ({ ...o, description: res.product.merged.description }))
          setBaseline(descriptionForCompare(res.product.merged.description))
          setOverridden(res.product.overridden)
          setAutoError(null)
          setAutoStatus('saved')
          if (same(stateRef.current.doc, doc)) writeDraft(product.id, null)
          onAutoSaved?.(res.product)
        } catch (err) {
          setAutoError(adminErrorText(err))
          setAutoStatus('error')
        }
      }),
    [exclusive, initData, product.id, onAutoSaved, descMode],
  )

  /** Публикация — только по кнопке и после подтверждения; публикуется ровно сохранённый черновик. */
  const publish = async () => {
    if (!content) return
    if (extrasDirty && !window.confirm('Есть несохранённые изменения блоков и видео — они не попадут на сайт. Продолжить?')) return
    if (!window.confirm('Опубликовать черновик (описание и поля карточки) на сайте? Посетители увидят изменения в течение минуты.')) return
    setPublishing(true)
    setError(null)
    try {
      await autosave()
      const rev = contentRef.current?.draftRev ?? 0
      const res = await exclusive(() => productsApi.publish(initData, product.id, rev))
      setContent(res.content)
      // После publish карточка из meta уходит в overrides — обновим форму.
      try {
        const det = await productsApi.get(initData, product.id)
        onSaved(det.product)
      } catch {
        /* форма уже имеет content */
      }
    } catch (err) {
      const fresh = err instanceof AdminHttpError ? (err.body.content as ProductContentView | undefined) : undefined
      if (fresh && typeof fresh.draftRev === 'number') setContent(fresh)
      setError(adminErrorText(err))
    } finally {
      setPublishing(false)
    }
  }
  /** Блоки и видео: сохраняются в тот же черновик (общая ревизия, общая очередь запросов). */
  const [extrasDirty, setExtrasDirty] = useState(false)
  const saveExtras = useCallback(
    async (payload: ExtrasPayload) => {
      setError(null)
      try {
        const res = await exclusive(() => productsApi.saveExtras(initData, product.id, payload, contentRef.current?.draftRev ?? 0))
        setContent(res.content)
        return res.content.draftExtras ?? null
      } catch (err) {
        const fresh = err instanceof AdminHttpError ? (err.body.content as ProductContentView | undefined) : undefined
        if (fresh && typeof fresh.draftRev === 'number') setContent(fresh)
        setError(adminErrorText(err))
        return null
      }
    },
    [exclusive, initData, product.id],
  )
  const unpublished = !!content && content.draftRev > 0 && (!content.hasPublished || content.publishedRev !== content.draftRev)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!editable || !descDirty || draft || descMode === 'loading') return
    if (limits.over) return
    timer.current = window.setTimeout(() => void autosave(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer.current)
  }, [fullDoc, descDirty, editable, limits.over, draft, autosave, descMode])

  const restoreDraft = () => {
    if (!draft) return
    patch({ doc: draft.doc })
    setNumbered(draft.doc.numbered === true)
    setResetToken((n) => n + 1)
    setDraft(null)
  }
  const discardDraft = () => {
    writeDraft(product.id, null)
    setDraft(null)
  }

  const shownStatus: AutoStatus =
    editable && descDirty && limits.over
      ? 'invalid'
      : editable && descDirty && !draft && autoStatus !== 'saving' && autoStatus !== 'error'
        ? 'pending'
        : autoStatus
  const autoText =
    shownStatus === 'saving'
      ? 'Сохранение…'
      : shownStatus === 'pending'
        ? 'Есть изменения…'
        : shownStatus === 'saved'
          ? 'Сохранено'
          : shownStatus === 'error'
            ? `Ошибка автосохранения: ${autoError ?? ''}. Текст сохранён на устройстве.`
            : shownStatus === 'invalid'
              ? 'Не сохраняется: превышен лимит'
              : ''

  const upload = async (file: File | undefined, target: 'image' | 'gallery') => {
    if (!file) return
    setUploading(target)
    setError(null)
    try {
      const blob = await prepareUpload(file)
      const { image } = await productsApi.upload(initData, product.id, blob)
      setState((s) => (target === 'image' ? { ...s, image } : { ...s, gallery: [...s.gallery, image].slice(0, GALLERY_MAX) }))
    } catch (err) {
      setError(err instanceof Error && err.message === 'too_large' ? 'Файл слишком большой даже после сжатия.' : adminErrorText(err))
    } finally {
      setUploading(null)
    }
  }

  const save = async () => {
    window.clearTimeout(timer.current)
    setSaving(true)
    setError(null)
    try {
      // Ручное сохранение ждёт текущее автосохранение и считает изменения от актуальной базы.
      // В режиме draft карточка уходит в product_content (не на сайт), пока не publish.
      const res = await exclusive(async () => {
        const built = buildSet(stateRef.current, originalRef.current, { skipDescription: descMode !== 'legacy' })
        if (!built.ok) throw new Error(`invalid:${built.message}`)
        if (Object.keys(built.set).length === 0) return null
        if (descMode === 'draft') {
          const card: Record<string, unknown> = {}
          for (const k of ['name', 'pack', 'price', 'image', 'gallery'] as const) {
            if (k in built.set) card[k] = built.set[k]
          }
          if (Object.keys(card).length) {
            const c = await productsApi.saveCard(initData, product.id, card, contentRef.current?.draftRev ?? 0)
            setContent(c.content)
          }
          // Описание в draft уже автосохраняется; legacy-поля без карточки — через overrides не пишем.
          return null
        }
        return productsApi.patch(initData, product.id, { set: built.set })
      })
      writeDraft(product.id, null)
      if (res) onSaved(res.product)
    } catch (err) {
      // данные формы не сбрасываются
      setError(err instanceof Error && err.message.startsWith('invalid:') ? err.message.slice(8) : adminErrorText(err))
    } finally {
      setSaving(false)
    }
  }

  const resetField = async (field: string, label: string) => {
    const extra = dirty ? ' Несохранённые правки в форме будут потеряны.' : ''
    if (!window.confirm(`Вернуть «${label}» как в базовом каталоге?${extra}`)) return
    setSaving(true)
    setError(null)
    try {
      window.clearTimeout(timer.current)
      const res = await exclusive(() => productsApi.patch(initData, product.id, { reset: [field] }))
      if (field === 'description') writeDraft(product.id, null)
      onSaved(res.product)
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setSaving(false)
    }
  }

  const resetBtn = (field: string, label: string) =>
    overridden.includes(field) ? (
      <button type="button" className={admin.linkBtn} disabled={disabled} onClick={() => void resetField(field, label)}>
        Вернуть из каталога
      </button>
    ) : null

  const pvNum = parsePv(state.pv)
  const rubMismatch = !state.priceNone && pvNum !== null && String(rubFromPv(pvNum)) !== state.rub.trim()

  return (
    <form
      className={admin.form}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      aria-label="Редактирование товара"
    >
      <p className={styles.meta}>
        {product.brand} · id: {product.id}
        {product.updatedAt ? ` · изменён ${product.updatedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}
        {content?.status ? ` · статус: ${content.status}` : ''}
      </p>
      <div className={styles.actionsRow} style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }} data-testid="product-cms-actions">
        <button
          type="button"
          className={styles.btn}
          disabled={!editable || cmsBusy}
          onClick={() => {
            void (async () => {
              setCmsBusy(true)
              setError(null)
              try {
                const parts = {
                  card: window.confirm('Копировать поля карточки?'),
                  content: window.confirm('Копировать описание и блоки?'),
                  media: window.confirm('Связать те же фото (без копирования файлов)?'),
                  documents: window.confirm('Связать те же документы?'),
                }
                const r = await productsApi.duplicate(initData, product.id, parts)
                onDuplicated?.(r.id)
              } catch (err) {
                setError(adminErrorText(err))
              } finally {
                setCmsBusy(false)
              }
            })()
          }}
        >
          Дублировать
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={cmsBusy}
          onClick={() => setShowAdaptivePreview((v) => !v)}
        >
          {showAdaptivePreview ? 'Скрыть предпросмотр' : 'Предпросмотр черновика'}
        </button>
        <ProductChecklistPanel initData={initData} productId={product.id} />
        <button
          type="button"
          className={styles.btn}
          disabled={!editable || cmsBusy || descMode !== 'draft'}
          onClick={() => {
            const status = window.prompt('Статус (draft / review / archived):', content?.status ?? 'draft')
            if (!status) return
            void (async () => {
              setCmsBusy(true)
              setError(null)
              try {
                const r = await productsApi.setStatus(initData, product.id, status)
                setContent(r.content)
              } catch (err) {
                setError(adminErrorText(err))
              } finally {
                setCmsBusy(false)
              }
            })()
          }}
        >
          Сменить статус
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={cmsBusy}
          onClick={() => {
            void (async () => {
              setCmsBusy(true)
              setError(null)
              try {
                const r = await productsApi.versions(initData, product.id)
                setVersions(r.versions)
              } catch (err) {
                setError(adminErrorText(err))
              } finally {
                setCmsBusy(false)
              }
            })()
          }}
        >
          История версий
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!editable || cmsBusy}
          onClick={() => {
            if (!window.confirm('Убрать товар в корзину?')) return
            void (async () => {
              setCmsBusy(true)
              setError(null)
              try {
                await productsApi.trash(initData, product.id)
                window.alert('Товар в корзине. Вернитесь к списку.')
              } catch (err) {
                setError(adminErrorText(err))
              } finally {
                setCmsBusy(false)
              }
            })()
          }}
        >
          В корзину
        </button>
      </div>
      {versions ? (
        <div className={admin.fieldset} data-testid="product-versions">
          <p className={admin.legend}>Версии ({versions.length})</p>
          <ul className={admin.galleryList}>
            {versions.map((v) => (
              <li key={v.rev} className={admin.galleryItem}>
                <span className={styles.meta}>
                  #{v.rev} · {v.reason} · {new Date(v.createdAt).toLocaleString('ru-RU')}
                </span>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={!editable || cmsBusy}
                  onClick={() => {
                    if (!window.confirm(`Восстановить версию #${v.rev} в черновик? (создаст новую версию)`)) return
                    void (async () => {
                      setCmsBusy(true)
                      setError(null)
                      try {
                        const r = await productsApi.restoreVersion(initData, product.id, v.rev)
                        setContent(r.content)
                        if (r.content.draftDoc) {
                          setBaseline(descriptionForCompare(r.content.draftDoc))
                          setState((st) => ({ ...st, doc: toEditableDoc(r.content.draftDoc) }))
                          setResetToken((n) => n + 1)
                        }
                        const vs = await productsApi.versions(initData, product.id)
                        setVersions(vs.versions)
                      } catch (err) {
                        setError(adminErrorText(err))
                      } finally {
                        setCmsBusy(false)
                      }
                    })()
                  }}
                >
                  Восстановить
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setVersions(null)}>
            Скрыть
          </button>
        </div>
      ) : null}
      {showAdaptivePreview ? <ProductAdaptivePreview initData={initData} productId={product.id} /> : null}

      <fieldset className={admin.fieldset} disabled={disabled} data-field="name">
        <legend className={admin.legend}>Название {resetBtn('name', 'Название')}</legend>
        <input
          className={styles.input}
          aria-label="Название"
          value={state.name}
          maxLength={200}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled} data-field="pack">
        <legend className={admin.legend}>Фасовка {resetBtn('pack', 'Фасовка')}</legend>
        <label className={admin.check}>
          <input type="checkbox" checked={state.packNone} onChange={(e) => patch({ packNone: e.target.checked })} /> Без фасовки
        </label>
        {!state.packNone ? (
          <input
            className={styles.input}
            aria-label="Фасовка"
            value={state.pack}
            maxLength={120}
            onChange={(e) => patch({ pack: e.target.value })}
          />
        ) : null}
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled} data-field="price">
        <legend className={admin.legend}>Цена {resetBtn('price', 'Цена')}</legend>
        <label className={admin.check}>
          <input type="checkbox" checked={state.priceNone} onChange={(e) => patch({ priceNone: e.target.checked })} /> Цена уточняется
        </label>
        {!state.priceNone ? (
          <div className={styles.filters}>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>PV</span>
              <input
                className={styles.number}
                inputMode="decimal"
                aria-label="PV"
                value={state.pv}
                onChange={(e) => {
                  const pv = e.target.value
                  const n = parsePv(pv)
                  setState((s) => ({ ...s, pv, rub: s.rubAuto && n !== null ? String(rubFromPv(n)) : s.rub }))
                }}
              />
            </label>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Рубли (1 PV = 84 ₽)</span>
              <input
                className={styles.number}
                inputMode="numeric"
                aria-label="Рубли"
                value={state.rub}
                onChange={(e) => patch({ rub: e.target.value, rubAuto: false })}
              />
            </label>
          </div>
        ) : null}
        {!state.priceNone && !state.rubAuto ? (
          <label className={admin.check}>
            <input
              type="checkbox"
              checked={false}
              onChange={() => setState((s) => ({ ...s, rubAuto: true, rub: pvNum !== null ? String(rubFromPv(pvNum)) : s.rub }))}
            />{' '}
            Считать рубли по курсу
          </label>
        ) : null}
        {rubMismatch ? (
          <p className={admin.hint}>Рубли отличаются от курса 1 PV = 84 ₽ ({pvNum !== null ? rubFromPv(pvNum) : ''} ₽).</p>
        ) : null}
        {original.price ? <p className={admin.hint}>Сейчас на сайте: {formatPrice(original.price)}</p> : null}
      </fieldset>

      <div data-field="media">
        <ProductMediaPanel
          initData={initData}
          productId={product.id}
          productName={product.name}
          disabled={!editable}
          onAvailability={setMediaAvailable}
        />
      </div>
      {mediaAvailable === false ? (
        <>
          <fieldset className={admin.fieldset} disabled={disabled} data-field="image">
            <legend className={admin.legend}>Главное фото {resetBtn('image', 'Главное фото')}</legend>
            <div className={admin.mediaRow}>
              <Thumb image={state.image} size={96} />
              <label className={styles.btn}>
                {uploading === 'image' ? 'Загрузка…' : 'Заменить'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={admin.fileInput}
                  aria-label="Загрузить главное фото"
                  onChange={(e) => {
                    void upload(e.target.files?.[0], 'image')
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className={admin.fieldset} disabled={disabled} data-field="gallery">
            <legend className={admin.legend}>
              Галерея ({state.gallery.length}/{GALLERY_MAX}) {resetBtn('gallery', 'Галерея')}
            </legend>
            <ul className={admin.galleryList} aria-label="Галерея">
              {state.gallery.map((img, i) => (
                <li key={`${img.src}-${i}`} className={admin.galleryItem}>
                  <Thumb image={img} />
                  <div className={admin.smallActions}>
                    <button
                      type="button"
                      className={admin.iconBtn}
                      aria-label={`Фото ${i + 1} выше`}
                      disabled={i === 0}
                      onClick={() => patch({ gallery: move(state.gallery, i, i - 1) })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={admin.iconBtn}
                      aria-label={`Фото ${i + 1} ниже`}
                      disabled={i === state.gallery.length - 1}
                      onClick={() => patch({ gallery: move(state.gallery, i, i + 1) })}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={admin.iconBtn}
                      aria-label={`Убрать фото ${i + 1}`}
                      onClick={() => patch({ gallery: state.gallery.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {state.gallery.length < GALLERY_MAX ? (
              <label className={styles.btn}>
                {uploading === 'gallery' ? 'Загрузка…' : 'Добавить фото'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={admin.fileInput}
                  aria-label="Добавить фото в галерею"
                  onChange={(e) => {
                    void upload(e.target.files?.[0], 'gallery')
                    e.target.value = ''
                  }}
                />
              </label>
            ) : null}
          </fieldset>
        </>
      ) : null}

      <fieldset className={admin.fieldset} disabled={!editable} data-field="description">
        <legend className={admin.legend}>Описание {resetBtn('description', 'Описание')}</legend>
        {draft ? (
          <div className={admin.draftBanner} role="status" data-testid="desc-draft">
            Найден несохранённый черновик описания ({new Date(draft.savedAt).toLocaleString('ru-RU')}).
            <div className={admin.smallActions}>
              <button type="button" className={styles.btn} onClick={restoreDraft}>
                Восстановить
              </button>
              <button type="button" className={styles.btn} onClick={discardDraft}>
                Отбросить
              </button>
            </div>
          </div>
        ) : null}
        <div className={admin.modeTabs} role="tablist" aria-label="Режим описания">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            className={`${admin.modeTab} ${mode === 'edit' ? admin.modeTabOn : ''}`}
            onClick={() => setMode('edit')}
          >
            Редактирование
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            className={`${admin.modeTab} ${mode === 'preview' ? admin.modeTabOn : ''}`}
            onClick={() => setMode('preview')}
          >
            Предпросмотр
          </button>
        </div>
        <div hidden={mode !== 'edit'} data-testid="desc-edit">
          <Suspense fallback={<p className={admin.hint}>Загрузка редактора…</p>}>
            <DescriptionEditor value={state.doc} resetToken={resetToken} disabled={disabled} onChange={(doc) => patch({ doc })} />
          </Suspense>
        </div>
        {mode === 'preview' ? (
          <div className={admin.previewBox} data-testid="desc-preview">
            {previewDoc ? (
              <DescriptionContent description={previewDoc} />
            ) : (
              <p className={admin.hint}>Описание пустое — на сайте блок не показывается.</p>
            )}
          </div>
        ) : null}
        <div className={admin.descFooter}>
          <span
            className={`${admin.counter} ${limits.over ? admin.counterOver : limits.near ? admin.counterNear : ''}`}
            data-testid="desc-counter"
            aria-live="polite"
          >
            {count} / {DOC_TEXT_MAX} · {limits.over ? `превышено на ${count - DOC_TEXT_MAX}` : `осталось ${DOC_TEXT_MAX - count}`}
          </span>
          <span className={admin.autosave} data-testid="desc-autosave" role="status">
            {autoText}
          </span>
        </div>
        {limits.message ? <p className={`${admin.hint} ${limits.over ? admin.counterOver : ''}`}>{limits.message}</p> : null}
        <label className={admin.check}>
          <input type="checkbox" checked={numbered} data-testid="desc-numbered" onChange={(e) => setNumbered(e.target.checked)} />{' '}
          Нумеровать секции на сайте
        </label>
        {descMode === 'draft' ? (
          <div className={admin.publishRow} data-testid="desc-publish-row">
            <span className={admin.hint} data-testid="desc-publish-status">
              {!content || content.draftRev === 0
                ? 'Черновика ещё нет — на сайте прежнее описание.'
                : unpublished || descDirty
                  ? 'Черновик не опубликован — на сайте прежняя версия.'
                  : `Опубликовано${content.publishedAt ? ` ${new Date(content.publishedAt).toLocaleString('ru-RU')}` : ''}.`}
            </span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              data-testid="desc-publish"
              disabled={
                !editable ||
                publishing ||
                limits.over ||
                autoStatus === 'saving' ||
                !content ||
                (content.draftRev === 0 && !descDirty) ||
                (!unpublished && !descDirty)
              }
              onClick={() => void publish()}
            >
              {publishing ? 'Публикация…' : 'Опубликовать описание'}
            </button>
          </div>
        ) : null}
        <p className={admin.hint}>
          Каждый новый абзац автоматически жирный; пункты списков — обычным шрифтом. «Заголовок секции» начинает новую карточку на сайте.{' '}
          {descMode === 'legacy'
            ? 'Описание сохраняется автоматически.'
            : 'Описание сохраняется в черновик автоматически; на сайт — только кнопкой «Опубликовать».'}
        </p>
      </fieldset>

      {descMode === 'draft' && content ? (
        <div data-field="extras">
          <div data-field="videos" />
          <ProductExtrasPanel
            key={`${product.id}:${content.draftExtras ? 'x' : '-'}`}
            initData={initData}
            productId={product.id}
            productName={product.name}
            initial={content.draftExtras ?? { blocks: [], showVideos: false, videos: [], tabs: [] }}
            disabled={!editable}
            onSave={saveExtras}
            onDirty={setExtrasDirty}
          />
        </div>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={admin.saveBar}>
        <button
          type="submit"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!editable || !dirty || saving || uploading !== null}
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!dirty || saving}
          onClick={() => {
            if (window.confirm('Отменить несохранённые изменения?')) {
              setState(initialState(original))
              setResetToken((n) => n + 1)
            }
          }}
        >
          Отменить правки
        </button>
        {dirty ? <span className={admin.hint}>Есть несохранённые изменения</span> : null}
      </div>
    </form>
  )
}
