/* eslint-disable react-refresh/only-export-components -- реестр редакторов блоков: компоненты и описания типов вместе */
/**
 * Реестр редакторов блоков: тип → пустое содержимое + форма. Новые типы (и редактор страниц)
 * добавляются сюда же, без правок списка.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { BlockImage, ExtraType, InfoTone } from '../../cms/richBlocks'
import { pageHref } from '../../cms/pageDoc'
import { pagesApi, type PageSummary } from '../pages/pagesApi'
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
  /** initData админки — для выбора внутренней страницы у кнопки. */
  initData: string
  /** Открыть выбор изображений из медиатеки; multiple — для галереи. */
  pickImages: (multiple: boolean, onPick: (images: BlockImage[]) => void) => void
  /** Зона загрузки нового фото для блока (slot block, replace = `${kind}:${blockId}`). */
  uploadZone: (kind: 'image' | 'gallery', blockId: string) => ReactNode
  /** Нативный выбор фото с устройства (прямо из клика). */
  uploadDevice: (kind: 'image' | 'gallery', blockId: string) => void
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


const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function ButtonExtraEditor({
  block,
  onChange,
  initData,
}: {
  block: EditBlock
  onChange: (content: Record<string, unknown>) => void
  initData: string
}) {
  const c = block.content
  const target = isObj(c.target) ? (c.target as Record<string, unknown>) : { kind: 'none' }
  const [picker, setPicker] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<PageSummary[] | null>(null)
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  useEffect(() => {
    if (!picker) return
    const ac = new AbortController()
    const t = setTimeout(() => {
      pagesApi(initData)
        .list({ q, status: 'all', trash: false, offset: 0, limit: 20 }, ac.signal)
        .then((r) => setItems(r.items))
        .catch(() => !ac.signal.aborted && setItems([]))
    }, 200)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [initData, q, picker])
  useEffect(() => {
    if (target.kind !== 'page' || typeof target.pageId !== 'string') {
      setPageTitle(null)
      return
    }
    let cancelled = false
    pagesApi(initData)
      .list({ q: '', status: 'all', trash: false, offset: 0, limit: 50 })
      .then((r) => {
        if (cancelled) return
        const hit = r.items.find((x) => x.id === target.pageId)
        setPageTitle(hit ? hit.title : 'Страница недоступна')
      })
      .catch(() => !cancelled && setPageTitle(null))
    return () => {
      cancelled = true
    }
  }, [initData, target.kind, typeof target.pageId === 'string' ? target.pageId : ''])

  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch })

  return (
    <>
      <Field label="Текст кнопки">
        <input
          className={styles.input}
          value={txt(c.text)}
          maxLength={80}
          data-testid="product-button-text"
          onChange={(e) => set({ text: e.target.value })}
        />
      </Field>
      <Field label="Вид">
        <select
          className={styles.input}
          value={txt(c.variant) || 'primary'}
          onChange={(e) => set({ variant: e.target.value })}
        >
          <option value="primary">Основная</option>
          <option value="secondary">Вторичная</option>
          <option value="soft">Мягкая</option>
        </select>
      </Field>
      <Field label="Выравнивание">
        <select
          className={styles.input}
          value={txt(c.align) || 'left'}
          onChange={(e) => set({ align: e.target.value })}
        >
          <option value="left">Слева</option>
          <option value="center">По центру</option>
          <option value="right">Справа</option>
        </select>
      </Field>
      <Field label="Действие">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={styles.btn} onClick={() => setPicker(true)} data-testid="product-button-pick-page">
            {target.kind === 'page' ? 'Сменить страницу' : 'На страницу CMS'}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => set({ target: { kind: 'none' }, href: undefined })}
          >
            Без ссылки
          </button>
          {target.kind === 'page' ? (
            <span className={m.hintText}>{pageTitle ?? '…'}</span>
          ) : target.kind === 'external' && typeof target.url === 'string' ? (
            <span className={m.hintText}>{String(target.url).slice(0, 60)}</span>
          ) : (
            <span className={m.hintText}>Ссылка не задана</span>
          )}
        </div>
      </Field>
      <Field label="Внешний URL (https)">
        <input
          className={styles.input}
          value={target.kind === 'external' && typeof target.url === 'string' ? target.url : ''}
          placeholder="https://…"
          maxLength={500}
          onChange={(e) => {
            const url = e.target.value.trim()
            if (!url) return set({ target: { kind: 'none' }, href: undefined })
            set({ target: { kind: 'external', url }, href: url.startsWith('https://') ? url : undefined })
          }}
        />
      </Field>
      {picker ? (
        <div className={m.modal} role="dialog" aria-modal="true" aria-label="Выбор страницы" data-testid="product-button-target-picker">
          <div className={m.modalBox}>
            <strong>Куда ведёт кнопка</strong>
            <input
              className={styles.input}
              type="search"
              placeholder="Найти страницу"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflow: 'auto' }}>
              {items?.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={styles.btn}
                    style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 4 }}
                    onClick={() => {
                      set({
                        target: { kind: 'page', pageId: x.id },
                        href: pageHref(x.slug),
                      })
                      setPageTitle(x.title)
                      setPicker(false)
                    }}
                  >
                    <strong>{x.title}</strong>
                    <span className={m.hintText}>
                      {' '}
                      /{x.slug}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className={styles.btn} onClick={() => setPicker(false)}>
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </>
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
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => p.ctx.uploadDevice('image', p.block.id)}>
              {img ? 'Заменить фото' : 'Добавить фото'}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => p.ctx.pickImages(false, ([x]) => x && p.onChange({ ...p.block.content, image: x }))}
            >
              Из медиатеки
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
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={items.length >= 30}
            onClick={() => p.ctx.uploadDevice('gallery', p.block.id)}
          >
            Добавить фото
          </button>
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
  button: {
    empty: () => ({
      text: 'Подробнее',
      variant: 'primary',
      align: 'left',
      target: { kind: 'none' },
    }),
    Editor: (p) => <ButtonExtraEditor block={p.block} onChange={p.onChange} initData={p.ctx.initData} />,
  },
}

export const BLOCK_TYPE_OPTIONS = (Object.keys(BLOCK_EDITORS) as ExtraType[]).map((t) => ({ value: t, label: EXTRA_LABEL[t] }))
