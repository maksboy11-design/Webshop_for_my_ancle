import { useEffect, useMemo, useState } from 'react'
import { formatPrice } from '../data/price'
import type { ProductImage } from '../data/products'
import { adminErrorText, productsApi, type AdminProductDetail } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import {
  buildSet,
  emptySection,
  initialState,
  isDirty,
  move,
  parsePv,
  rubFromPv,
  type EditSection,
  type ProductFormState,
} from './productFormModel'

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
}

function Thumb({ image, size = 72 }: { image: ProductImage; size?: number }) {
  return (
    <img className={admin.formThumb} src={image.thumb ?? image.src} alt="" width={size} height={size} loading="lazy" decoding="async" />
  )
}

export default function ProductForm({ initData, product, editable, onDirtyChange, onSaved }: Props) {
  const original = product.merged
  const [state, setState] = useState<ProductFormState>(() => initialState(original))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = useMemo(() => isDirty(state, original), [state, original])
  const disabled = !editable || saving || uploading !== null

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const patch = (p: Partial<ProductFormState>) => setState((s) => ({ ...s, ...p }))
  const patchSection = (index: number, p: Partial<EditSection>) =>
    setState((s) => ({ ...s, sections: s.sections.map((sec, i) => (i === index ? { ...sec, ...p } : sec)) }))

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
    const built = buildSet(state, original)
    if (!built.ok) {
      setError(built.message)
      return
    }
    if (Object.keys(built.set).length === 0) return
    setSaving(true)
    setError(null)
    try {
      const res = await productsApi.patch(initData, product.id, { set: built.set })
      onSaved(res.product)
    } catch (err) {
      setError(adminErrorText(err)) // данные формы не сбрасываются
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
      const res = await productsApi.patch(initData, product.id, { reset: [field] })
      onSaved(res.product)
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setSaving(false)
    }
  }

  const resetBtn = (field: string, label: string) =>
    product.overridden.includes(field) ? (
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
      </p>

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Название {resetBtn('name', 'Название')}
        </legend>
        <input className={styles.input} aria-label="Название" value={state.name} maxLength={200} onChange={(e) => patch({ name: e.target.value })} />
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Фасовка {resetBtn('pack', 'Фасовка')}
        </legend>
        <label className={admin.check}>
          <input type="checkbox" checked={state.packNone} onChange={(e) => patch({ packNone: e.target.checked })} /> Без фасовки
        </label>
        {!state.packNone ? (
          <input className={styles.input} aria-label="Фасовка" value={state.pack} maxLength={120} onChange={(e) => patch({ pack: e.target.value })} />
        ) : null}
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Цена {resetBtn('price', 'Цена')}
        </legend>
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
        {rubMismatch ? <p className={admin.hint}>Рубли отличаются от курса 1 PV = 84 ₽ ({pvNum !== null ? rubFromPv(pvNum) : ''} ₽).</p> : null}
        {original.price ? <p className={admin.hint}>Сейчас на сайте: {formatPrice(original.price)}</p> : null}
      </fieldset>

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Главное фото {resetBtn('image', 'Главное фото')}
        </legend>
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

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Галерея ({state.gallery.length}/{GALLERY_MAX}) {resetBtn('gallery', 'Галерея')}
        </legend>
        <ul className={admin.galleryList} aria-label="Галерея">
          {state.gallery.map((img, i) => (
            <li key={`${img.src}-${i}`} className={admin.galleryItem}>
              <Thumb image={img} />
              <div className={admin.smallActions}>
                <button type="button" className={admin.iconBtn} aria-label={`Фото ${i + 1} выше`} disabled={i === 0} onClick={() => patch({ gallery: move(state.gallery, i, i - 1) })}>
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

      <fieldset className={admin.fieldset} disabled={disabled}>
        <legend className={admin.legend}>
          Описание {resetBtn('description', 'Описание')}
        </legend>
        <p className={admin.hint}>Тексты сохраняются ровно так, как введены — без автоисправлений.</p>
        <label className={admin.check}>
          <input type="checkbox" checked={state.descNone} onChange={(e) => patch({ descNone: e.target.checked })} /> Без описания
        </label>
        {!state.descNone
          ? state.sections.map((sec, i) => (
              <SectionEditor
                key={sec.key}
                index={i}
                total={state.sections.length}
                section={sec}
                onChange={(p) => patchSection(i, p)}
                onMove={(to) => patch({ sections: move(state.sections, i, to) })}
                onDelete={() => {
                  if (window.confirm(`Удалить секцию ${i + 1}?`)) patch({ sections: state.sections.filter((_, j) => j !== i) })
                }}
              />
            ))
          : null}
        {!state.descNone ? (
          <button type="button" className={styles.btn} onClick={() => patch({ sections: [...state.sections, emptySection()] })}>
            Добавить секцию
          </button>
        ) : null}
      </fieldset>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={admin.saveBar}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!editable || !dirty || saving || uploading !== null}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!dirty || saving}
          onClick={() => {
            if (window.confirm('Отменить несохранённые изменения?')) setState(initialState(original))
          }}
        >
          Отменить правки
        </button>
        {dirty ? <span className={admin.hint}>Есть несохранённые изменения</span> : null}
      </div>
    </form>
  )
}

function SectionEditor({
  index,
  total,
  section,
  onChange,
  onMove,
  onDelete,
}: {
  index: number
  total: number
  section: EditSection
  onChange: (p: Partial<EditSection>) => void
  onMove: (to: number) => void
  onDelete: () => void
}) {
  const n = index + 1
  return (
    <div className={admin.section} data-testid="desc-section">
      <div className={admin.sectionHead}>
        <strong>Секция {n}</strong>
        <div className={admin.smallActions}>
          <button type="button" className={admin.iconBtn} aria-label={`Секция ${n} выше`} disabled={index === 0} onClick={() => onMove(index - 1)}>
            ↑
          </button>
          <button type="button" className={admin.iconBtn} aria-label={`Секция ${n} ниже`} disabled={index === total - 1} onClick={() => onMove(index + 1)}>
            ↓
          </button>
          <button type="button" className={admin.iconBtn} aria-label={`Удалить секцию ${n}`} onClick={onDelete}>
            ✕
          </button>
        </div>
      </div>
      <div className={styles.filters}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Уровень</span>
          <select className={styles.input} value={section.level} onChange={(e) => onChange({ level: e.target.value as EditSection['level'] })}>
            <option value="major">Заголовок блока</option>
            <option value="group">Крупный разделитель</option>
            <option value="minor">Малый заголовок</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Номер</span>
          <input className={styles.input} value={section.number} maxLength={8} onChange={(e) => onChange({ number: e.target.value })} />
        </label>
      </div>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Заголовок</span>
        <input className={styles.input} aria-label={`Заголовок секции ${n}`} value={section.heading} onChange={(e) => onChange({ heading: e.target.value })} />
      </label>
      <span className={styles.filterLabel}>Абзацы</span>
      {section.paragraphs.map((p, j) => (
        <div key={p.key} className={admin.rowEdit}>
          <input
            className={styles.input}
            placeholder="Выделенное начало (необязательно)"
            aria-label={`Подпись абзаца ${j + 1}`}
            value={p.label}
            onChange={(e) => onChange({ paragraphs: section.paragraphs.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })}
          />
          <textarea
            className={admin.textarea}
            aria-label={`Абзац ${j + 1} секции ${n}`}
            value={p.text}
            rows={3}
            onChange={(e) => onChange({ paragraphs: section.paragraphs.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)) })}
          />
          <div className={admin.smallActions}>
            <button type="button" className={admin.iconBtn} aria-label="Абзац выше" disabled={j === 0} onClick={() => onChange({ paragraphs: move(section.paragraphs, j, j - 1) })}>
              ↑
            </button>
            <button
              type="button"
              className={admin.iconBtn}
              aria-label="Абзац ниже"
              disabled={j === section.paragraphs.length - 1}
              onClick={() => onChange({ paragraphs: move(section.paragraphs, j, j + 1) })}
            >
              ↓
            </button>
            <button type="button" className={admin.iconBtn} aria-label="Удалить абзац" onClick={() => onChange({ paragraphs: section.paragraphs.filter((_, k) => k !== j) })}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={admin.linkBtn}
        onClick={() => onChange({ paragraphs: [...section.paragraphs, { key: `p${Date.now()}${Math.random()}`, label: '', text: '' }] })}
      >
        + абзац
      </button>
      <span className={styles.filterLabel}>Список</span>
      {section.list.map((item, j) => (
        <div key={item.key} className={admin.rowEdit}>
          <input
            className={styles.input}
            aria-label={`Пункт ${j + 1} секции ${n}`}
            value={item.text}
            onChange={(e) => onChange({ list: section.list.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)) })}
          />
          <div className={admin.smallActions}>
            <button type="button" className={admin.iconBtn} aria-label="Пункт выше" disabled={j === 0} onClick={() => onChange({ list: move(section.list, j, j - 1) })}>
              ↑
            </button>
            <button
              type="button"
              className={admin.iconBtn}
              aria-label="Пункт ниже"
              disabled={j === section.list.length - 1}
              onClick={() => onChange({ list: move(section.list, j, j + 1) })}
            >
              ↓
            </button>
            <button type="button" className={admin.iconBtn} aria-label="Удалить пункт" onClick={() => onChange({ list: section.list.filter((_, k) => k !== j) })}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={admin.linkBtn} onClick={() => onChange({ list: [...section.list, { key: `i${Date.now()}${Math.random()}`, text: '' }] })}>
        + пункт
      </button>
      {section.list.length > 0 ? (
        <label className={admin.check}>
          <input type="checkbox" checked={section.listStyle === 'none'} onChange={(e) => onChange({ listStyle: e.target.checked ? 'none' : 'bullet' })} /> Без маркеров
        </label>
      ) : null}
    </div>
  )
}
