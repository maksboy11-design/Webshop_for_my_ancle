/* eslint-disable react-refresh/only-export-components -- реестр редакторов блоков: компоненты и описания типов вместе */
/**
 * Реестр редакторов блоков: тип → пустое содержимое + форма. Новые типы (и редактор страниц)
 * добавляются сюда же, без правок списка.
 */
import type { ReactNode } from 'react'
import type { BlockImage, ExtraType, InfoTone } from '../../cms/richBlocks'
import { EXTRA_LABEL } from '../../cms/richBlocks'
import type { MediaItem } from '../media/mediaApi'
import styles from '../App.module.css'
import m from '../media/Media.module.css'
import { moveItem, removeAt } from './listOps'

export interface EditBlock {
  id: string
  type: ExtraType
  active: boolean
  content: Record<string, unknown>
}

export interface BlockEditorCtx {
  /** Открыть выбор изображений из медиатеки; multiple — для галереи. */
  pickImages: (multiple: boolean, onPick: (images: BlockImage[]) => void) => void
  /** Зона загрузки нового фото для блока (slot block, replace = `${kind}:${blockId}`). */
  uploadZone: (kind: 'image' | 'gallery', blockId: string) => ReactNode
  disabled?: boolean
}

type Props = { block: EditBlock; onChange: (content: Record<string, unknown>) => void; ctx: BlockEditorCtx }

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const txt = (v: unknown) => (typeof v === 'string' ? v : '')

export function mediaToBlockImage(x: MediaItem): BlockImage {
  return { mediaId: x.id, src: x.thumb ?? x.url, width: x.width ?? 1, height: x.height ?? 1 }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.filterField} style={{ display: 'grid', gap: 4 }}>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </label>
  )
}

function TitleField({ block, onChange, label = 'Заголовок блока (необязательно)' }: Props & { label?: string }) {
  return (
    <Field label={label}>
      <input
        className={styles.input}
        value={txt(block.content.title)}
        maxLength={160}
        onChange={(e) => onChange({ ...block.content, title: e.target.value })}
      />
    </Field>
  )
}

function Rows<T extends Record<string, string>>({
  rows,
  fields,
  onChange,
  addLabel,
  max,
}: {
  rows: T[]
  fields: { key: keyof T & string; label: string; area?: boolean }[]
  onChange: (rows: T[]) => void
  addLabel: string
  max: number
}) {
  const empty = Object.fromEntries(fields.map((f) => [f.key, ''])) as T
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'start', flexWrap: 'wrap' }} data-testid="block-row">
          {fields.map((f) =>
            f.area ? (
              <textarea
                key={f.key}
                className={styles.input}
                aria-label={`${f.label} ${i + 1}`}
                placeholder={f.label}
                rows={2}
                style={{ flex: '2 1 12rem' }}
                value={r[f.key]}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))}
              />
            ) : (
              <input
                key={f.key}
                className={styles.input}
                aria-label={`${f.label} ${i + 1}`}
                placeholder={f.label}
                style={{ flex: '1 1 8rem' }}
                value={r[f.key]}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))}
              />
            ),
          )}
          <button
            type="button"
            className={m.iconBtn}
            aria-label={`Строка ${i + 1} выше`}
            disabled={i === 0}
            onClick={() => onChange(moveItem(rows, i, i - 1))}
          >
            ↑
          </button>
          <button type="button" className={m.iconBtn} aria-label={`Удалить строку ${i + 1}`} onClick={() => onChange(removeAt(rows, i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.btn} disabled={rows.length >= max} onClick={() => onChange([...rows, empty])}>
        {addLabel}
      </button>
    </div>
  )
}

function Thumb({ image, onRemove, label }: { image: BlockImage; onRemove?: () => void; label: string }) {
  return (
    <span style={{ display: 'inline-grid', gap: 4, justifyItems: 'center' }}>
      <img src={image.src} alt={label} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 8 }} />
      {onRemove ? (
        <button type="button" className={m.iconBtn} aria-label={`Убрать: ${label}`} onClick={onRemove}>
          ✕
        </button>
      ) : null}
    </span>
  )
}

export const BLOCK_EDITORS: Record<ExtraType, { empty: () => Record<string, unknown>; Editor: (p: Props) => ReactNode }> = {
  specs_table: {
    empty: () => ({ title: 'Характеристики', rows: [{ label: '', value: '' }] }),
    Editor: (p) => (
      <>
        <TitleField {...p} />
        <Rows
          rows={arr<{ label: string; value: string }>(p.block.content.rows)}
          fields={[
            { key: 'label', label: 'Параметр' },
            { key: 'value', label: 'Значение' },
          ]}
          onChange={(rows) => p.onChange({ ...p.block.content, rows })}
          addLabel="+ Строка"
          max={60}
        />
      </>
    ),
  },
  benefits: {
    empty: () => ({ title: 'Преимущества', items: [{ title: '', text: '' }] }),
    Editor: (p) => (
      <>
        <TitleField {...p} />
        <Rows
          rows={arr<{ title: string; text: string }>(p.block.content.items)}
          fields={[
            { key: 'title', label: 'Преимущество' },
            { key: 'text', label: 'Пояснение', area: true },
          ]}
          onChange={(items) => p.onChange({ ...p.block.content, items })}
          addLabel="+ Пункт"
          max={30}
        />
      </>
    ),
  },
  info: {
    empty: () => ({ title: '', text: '', tone: 'info' }),
    Editor: (p) => (
      <>
        <TitleField {...p} label="Заголовок (необязательно)" />
        <Field label="Вид">
          <select
            className={styles.input}
            value={txt(p.block.content.tone) || 'info'}
            onChange={(e) => p.onChange({ ...p.block.content, tone: e.target.value as InfoTone })}
          >
            <option value="info">Информация</option>
            <option value="note">Заметка</option>
            <option value="warning">Важно / предупреждение</option>
          </select>
        </Field>
        <Field label="Текст">
          <textarea
            className={styles.input}
            rows={4}
            maxLength={2000}
            value={txt(p.block.content.text)}
            onChange={(e) => p.onChange({ ...p.block.content, text: e.target.value })}
          />
        </Field>
      </>
    ),
  },
  image: {
    empty: () => ({ image: null, caption: '' }),
    Editor: (p) => {
      const img = p.block.content.image as BlockImage | null
      return (
        <>
          {img ? (
            <Thumb image={img} label="Фото блока" onRemove={() => p.onChange({ ...p.block.content, image: null })} />
          ) : (
            <span className={m.hintText}>Фото не выбрано — блок на сайте не показывается.</span>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => p.ctx.pickImages(false, ([x]) => x && p.onChange({ ...p.block.content, image: x }))}
            >
              {img ? 'Заменить из медиатеки' : 'Выбрать из медиатеки'}
            </button>
          </div>
          {p.ctx.uploadZone('image', p.block.id)}
          <Field label="Подпись (необязательно)">
            <input
              className={styles.input}
              value={txt(p.block.content.caption)}
              maxLength={300}
              onChange={(e) => p.onChange({ ...p.block.content, caption: e.target.value })}
            />
          </Field>
        </>
      )
    },
  },
  gallery: {
    empty: () => ({ title: '', items: [] }),
    Editor: (p) => {
      const items = arr<BlockImage>(p.block.content.items)
      return (
        <>
          <TitleField {...p} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-testid="gallery-block-items">
            {items.map((x, i) => (
              <span key={`${x.mediaId}-${i}`} style={{ display: 'inline-grid', gap: 2 }}>
                <Thumb image={x} label={`Фото ${i + 1}`} onRemove={() => p.onChange({ ...p.block.content, items: removeAt(items, i) })} />
                <span style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className={m.iconBtn}
                    aria-label={`Фото ${i + 1} левее`}
                    disabled={i === 0}
                    onClick={() => p.onChange({ ...p.block.content, items: moveItem(items, i, i - 1) })}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className={m.iconBtn}
                    aria-label={`Фото ${i + 1} правее`}
                    disabled={i === items.length - 1}
                    onClick={() => p.onChange({ ...p.block.content, items: moveItem(items, i, i + 1) })}
                  >
                    →
                  </button>
                </span>
              </span>
            ))}
          </div>
          <button
            type="button"
            className={styles.btn}
            disabled={items.length >= 30}
            onClick={() => p.ctx.pickImages(true, (list) => p.onChange({ ...p.block.content, items: [...items, ...list].slice(0, 30) }))}
          >
            Добавить из медиатеки
          </button>
          {p.ctx.uploadZone('gallery', p.block.id)}
        </>
      )
    },
  },
}

export const BLOCK_TYPE_OPTIONS = (Object.keys(BLOCK_EDITORS) as ExtraType[]).map((t) => ({ value: t, label: EXTRA_LABEL[t] }))
