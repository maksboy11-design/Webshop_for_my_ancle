/**
 * Редактор страницы: холст с блоками в виде сайта, «+» между блоками, общее контекстное меню
 * (ПКМ на компьютере, ⋮ на телефоне), перестановка (перетаскивание + ↑/↓), ширина/выравнивание,
 * страничная история (Ctrl/Cmd+Z, Shift+Z — вне текста TipTap, у него своя история),
 * автосохранение черновика + копия в localStorage, версии, предпросмотр, публикация.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/fonts-playfair.css'
import '../../styles/tokens.css'
import DescriptionEditor from '../DescriptionEditor'
import { AdminHttpError, adminErrorText, adminSessionExp, onAdminSessionChange } from '../adminHttp'
import styles from '../App.module.css'
import m from '../media/Media.module.css'
import p from './Pages.module.css'
import r from '../../components/pages/page.module.css'
import { PageBlockView, PageRenderer, type PageLinks } from '../../components/pages/PageRenderer'
import {
  ALIGNS,
  ASPECTS,
  VIDEO_ASPECTS,
  PAGE_BLOCK_LABEL,
  PAGE_BLOCK_TYPES,
  PAGE_BLOCKS_MAX,
  RADII,
  VARIANTS,
  WIDTHS,
  isValidSlug,
  pageHref,
  slugify,
  type ButtonBlock,
  type PageBlock,
  type PageBlockType,
} from '../../cms/pageDoc'
import { MediaPicker } from '../media/ProductMedia'
import {
  DEVICE_IMAGE_ACCEPT,
  DEVICE_VIDEO_ACCEPT,
  devicePickerOpen,
  DropZone,
  IMAGE_ACCEPT,
  useDevicePicker,
  useDevicePickerOpen,
  useMediaUploads,
} from '../media/MediaUploads'
import { VIDEO_ACCEPT, captureFrame, probeVideos } from './videoProbe'
import { mediaToBlockImage } from '../blocks/blockEditors'
import {
  clampMenu,
  commit,
  dropAt,
  duplicateBlock,
  initHistory,
  insertBlock,
  isDoubleTap,
  localKey,
  rescueKey,
  initDataSecondsLeft,
  isAuthLost,
  saveLabel,
  moveBlock,
  newPageBlock,
  redo,
  removeBlock,
  undo,
  updateBlock,
  type History,
  type Snapshot,
} from './editorOps'
import { registerUnsavedGuard } from '../../chunkReload'
import { pagesApi, type LinkInfo, type PageRef, type PageSummary, type PageVersion, type PageView } from './pagesApi'

const WIDTH_LABEL = {
  narrow: 'Узкая',
  normal: 'Обычная',
  wide: 'Широкая',
} as const
const ALIGN_LABEL = {
  left: 'Слева',
  center: 'По центру',
  right: 'Справа',
} as const
const VARIANT_LABEL = {
  primary: 'Основная',
  secondary: 'Вторичная',
  soft: 'Мягкая',
} as const
const RADIUS_LABEL = {
  none: 'Без скругления',
  md: 'Среднее',
  lg: 'Большое',
} as const
const REASON_LABEL: Record<string, string> = {
  save: 'Сохранение',
  publish: 'Публикация',
  restore: 'Восстановление',
  import: 'Перенос',
}
/** Секунды до конца админ-сессии (или initData, если сессия ещё не выдана). */
const sessionSecondsLeft = (initData: string) => {
  const exp = adminSessionExp()
  return exp ? exp - Math.floor(Date.now() / 1000) : initDataSecondsLeft(initData)
}
const AUTOSAVE_MS = 2000
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
const snapOf = (v: PageView): Snapshot => ({
  title: v.title,
  slug: v.slug,
  doc: v.doc,
})
/** Видимое содержимое снимка (тексты и порядок блоков) без пробелов по краям и порядка ключей JSON. */
function docSignature(s: Snapshot): string {
  const out: string[] = [s.title, s.slug, s.doc.lead ?? '']
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.type === 'string') out.push(`<${o.type}>`)
      if (typeof o.text === 'string') out.push(o.text)
      if (o.content) walk(o.content)
      if (o.doc) walk(o.doc)
    }
  }
  walk(s.doc.blocks)
  return out.join('').replace(/\s+/g, '')
}
const json = (s: Snapshot) => JSON.stringify(s)

/* ------------------------------ контекстное меню ------------------------------ */

type MenuItem =
  | {
      label: string
      onSelect: () => void
      disabled?: boolean
      danger?: boolean
    }
  | 'sep'

function ContextMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const pos = clampMenu(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)
    el.style.left = `${pos.left}px`
    el.style.top = `${pos.top}px`
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return createPortal(
    <div
      className={p.menuBackdrop}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div ref={ref} className={p.menu} role="menu" aria-label={label} data-testid="page-menu" style={{ left: x, top: y }}>
        {items.map((it, i) =>
          it === 'sep' ? (
            <hr key={i} className={p.menuSep} />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`${p.menuItem} ${it.danger ? p.danger : ''}`}
              disabled={it.disabled}
              onClick={() => {
                onClose()
                it.onSelect()
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------ предпросмотр ------------------------------ */

const VIEWPORTS = [
  { id: 'desktop', label: 'Компьютер', w: 1280 },
  { id: 'tablet', label: 'Планшет', w: 768 },
  { id: 'mobile', label: 'Телефон', w: 390 },
] as const

/** iframe с копией стилей сайта — медиазапросы срабатывают по ширине кадра, как на настоящем устройстве. */
function PreviewFrame({ width, children }: { width: number; children: ReactNode }) {
  const [body, setBody] = useState<HTMLElement | null>(null)
  return (
    <iframe
      title="Предпросмотр"
      className={p.frame}
      style={{ width }}
      data-testid="preview-frame"
      srcDoc="<!doctype html><html><head></head><body></body></html>"
      onLoad={(e) => {
        const d = e.currentTarget.contentDocument
        if (!d) return
        document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => d.head.appendChild(n.cloneNode(true)))
        d.documentElement.className = document.documentElement.className
        setBody(d.body)
      }}
    >
      {body ? createPortal(children, body) : null}
    </iframe>
  )
}

function Preview({ snap, links, onClose }: { snap: Snapshot; links: PageLinks; onClose: () => void }) {
  const [vp, setVp] = useState<(typeof VIEWPORTS)[number]['id']>('desktop')
  const w = VIEWPORTS.find((v) => v.id === vp)!.w
  return (
    <div className={m.modal} role="dialog" aria-modal="true" aria-label="Предпросмотр" data-testid="page-preview">
      <div className={p.previewBox}>
        <div className={styles.actionsRow}>
          {VIEWPORTS.map((v) => (
            <button key={v.id} type="button" className={styles.btn} aria-pressed={vp === v.id} onClick={() => setVp(v.id)}>
              {v.label}
            </button>
          ))}
          <span className={m.hintText}>Черновик — посетители его не видят</span>
          <button type="button" className={styles.btn} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className={p.frameWrap} data-viewport={vp}>
          <PreviewFrame width={w}>
            <PageRenderer title={snap.title} doc={snap.doc} links={links} testId="preview-page" />
          </PreviewFrame>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ выбор страницы для кнопки ------------------------------ */

function TargetPicker({
  initData,
  selfId,
  onPick,
  onClose,
}: {
  initData: string
  selfId: string
  onPick: (page: { id: string; slug: string; title: string; status: 'draft' | 'published' }) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<PageSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => {
      pagesApi(initData)
        .list({ q, status: 'all', trash: false, offset: 0, limit: 20 }, ac.signal)
        .then((r) => setItems(r.items.filter((x) => x.id !== selfId)))
        .catch((e) => !ac.signal.aborted && setError(adminErrorText(e)))
    }, 200)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [initData, q, selfId])
  const create = async () => {
    try {
      const r = await pagesApi(initData).create(newTitle.trim() || 'Новая страница')
      onPick(r.page)
    } catch (e) {
      setError(adminErrorText(e))
    }
  }
  return (
    <div className={m.modal} role="dialog" aria-modal="true" aria-label="Куда ведёт кнопка" data-testid="target-picker">
      <div className={m.modalBox}>
        <strong>Куда ведёт кнопка</strong>
        <input
          className={styles.input}
          type="search"
          placeholder="Найти страницу"
          aria-label="Найти страницу"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
        <ul className={p.pickList}>
          {items?.map((x) => (
            <li key={x.id}>
              <button type="button" className={p.pickItem} onClick={() => onPick(x)}>
                <strong>{x.title}</strong>
                <span className={m.hintText}>
                  /{x.slug} · {x.status === 'published' ? 'опубликована' : 'черновик'}
                </span>
              </button>
            </li>
          ))}
          {items && !items.length ? <li className={m.hintText}>Ничего не найдено.</li> : null}
        </ul>
        <div className={p.createRow}>
          <input
            className={styles.input}
            placeholder="Название новой страницы"
            aria-label="Название новой страницы"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button type="button" className={styles.btn} onClick={create}>
            Создать черновик и связать
          </button>
        </div>
        <div className={styles.actionsRow}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ версии ------------------------------ */

function Versions({
  initData,
  pageId,
  onRestore,
  onClose,
}: {
  initData: string
  pageId: string
  onRestore: (rev: number) => void
  onClose: () => void
}) {
  const [list, setList] = useState<PageVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    pagesApi(initData)
      .versions(pageId)
      .then((x) => setList(x.versions))
      .catch((e) => setError(adminErrorText(e)))
  }, [initData, pageId])
  return (
    <section className={p.panel} data-testid="page-versions" aria-label="Версии">
      <div className={p.panelHead}>
        <strong>Версии</strong>
        <button type="button" className={m.iconBtn} aria-label="Закрыть версии" onClick={onClose}>
          ✕
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!list && !error ? <p className={m.hintText}>Загрузка…</p> : null}
      {list && !list.length ? <p className={m.hintText}>Версий пока нет. Они появляются при сохранении и публикации.</p> : null}
      <ul className={p.pickList}>
        {list?.map((v) => (
          <li key={v.rev} className={p.versionRow} data-testid="page-version">
            <span>
              №{v.rev} · {REASON_LABEL[v.reason] ?? v.reason}
              {v.restoredFromRev ? ` из №${v.restoredFromRev}` : ''} · {fmt(v.createdAt)}
            </span>
            <button type="button" className={styles.btn} onClick={() => onRestore(v.rev)}>
              Восстановить
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------ настройки блока ------------------------------ */

function Seg<T extends string>({
  label,
  value,
  options,
  names,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  names: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div className={p.seg} role="group" aria-label={label}>
      <span className={styles.filterLabel}>{label}</span>
      {options.map((o) => (
        <button key={o} type="button" className={styles.btn} aria-pressed={value === o} onClick={() => onChange(o)}>
          {names[o]}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------ редактор ------------------------------ */

type Menu = { x: number; y: number; kind: 'block'; id: string } | { x: number; y: number; kind: 'add'; at: number }

export default function PageEditor({
  initData,
  pageId,
  onClose,
  onOpen,
  setDirty,
}: {
  initData: string
  pageId: string
  onClose: () => void
  onOpen: (id: string) => void
  setDirty: (d: boolean) => void
}) {
  const api = pagesApi(initData)
  const [view, setView] = useState<PageView | null>(null)
  const [links, setLinks] = useState<Record<string, LinkInfo>>({})
  const [refs, setRefs] = useState<PageRef[]>([])
  const [hist, setHist] = useState<History | null>(null)
  const [saved, setSaved] = useState('')
  const [rev, setRev] = useState(0)
  const [resetTok, setResetTok] = useState(0)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [backlinks, setBacklinks] = useState<{ id: string; title: string; slug: string }[]>([])
  const [conflict, setConflict] = useState<PageView | null>(null)
  const [authLost, setAuthLost] = useState(false)
  const [expiresIn, setExpiresIn] = useState<number | null>(() => sessionSecondsLeft(initData))
  const [backup, setBackup] = useState<Snapshot | null>(null)
  const [slugTouched, setSlugTouched] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [editingText, setEditingText] = useState<string | null>(null)
  const [picker, setPicker] = useState<{
    kind: 'image' | 'target' | 'video' | 'poster'
    id: string
  } | null>(null)
  const [preview, setPreview] = useState(false)
  const [versions, setVersions] = useState(false)
  const [drag, setDrag] = useState<{
    from: number
    before: number | null
  } | null>(null)
  const lastTap = useRef<{
    t: number
    x: number
    y: number
    id: string
  } | null>(null)
  const { onDone, enqueue } = useMediaUploads()
  const device = useDevicePicker()
  const picking = useDevicePickerOpen()

  const load = useCallback((v: PageView, l: Record<string, LinkInfo>, rf: PageRef[]) => {
    setView(v)
    setLinks(l)
    setRefs(rf)
    setRev(v.rev)
    setSaved(json(snapOf(v)))
    setHist(initHistory(snapOf(v)))
    setResetTok((n) => n + 1)
    setSlugTouched(v.status === 'published' || v.slug !== slugify(v.title))
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    pagesApi(initData)
      .get(pageId, ac.signal)
      .then((x) => {
        load(x.page, x.links, x.referencedBy)
        try {
          const server = json(snapOf(x.page))
          const read = (k: string) => {
            const raw = localStorage.getItem(k)
            return raw ? (JSON.parse(raw) as { snap?: Snapshot; at?: number }) : null
          }
          const rescued = read(rescueKey(pageId))
          const local = read(localKey(pageId))
          // Несохранённая локальная копия переносится в «спасённую» до явного решения пользователя,
          // чтобы следующая правка (перезапись localKey) её не стёрла.
          if (local?.snap && json(local.snap) !== server) {
            localStorage.setItem(rescueKey(pageId), JSON.stringify(local))
            setBackup(local.snap)
          } else if (rescued?.snap && json(rescued.snap) !== server) setBackup(rescued.snap)
          else localStorage.removeItem(rescueKey(pageId))
        } catch {
          /* нет доступа к localStorage */
        }
      })
      .catch((e) => !ac.signal.aborted && setError(adminErrorText(e)))
    return () => ac.abort()
  }, [initData, pageId, load])

  const snap = hist?.present ?? null
  const dirty = !!snap && json(snap) !== saved
  useEffect(() => setDirty(dirty), [dirty, setDirty])
  useEffect(() => () => setDirty(false), [setDirty])

  // Локальная копия несохранённого черновика (переживает закрытие вкладки, обрыв сети и истёкшую сессию).
  useLayoutEffect(() => {
    if (!snap) return
    try {
      if (dirty) localStorage.setItem(localKey(pageId), JSON.stringify({ snap, at: Date.now() }))
      else localStorage.removeItem(localKey(pageId))
    } catch {
      /* квота/приватный режим */
    }
  }, [snap, dirty, pageId])

  // Пока есть несохранённые правки, авто-перезагрузка после деплоя (chunkReload) запрещена.
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  useEffect(() => registerUnsavedGuard(() => dirtyRef.current), [])

  // Сессия MAX: предупреждаем заранее, что сохранение скоро перестанет работать.
  useEffect(() => {
    const t = setInterval(() => setExpiresIn(sessionSecondsLeft(initData)), 30_000)
    const off = onAdminSessionChange(() => setExpiresIn(sessionSecondsLeft(initData)))
    return () => {
      clearInterval(t)
      off()
    }
  }, [initData])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const apply = useCallback((fn: (s: Snapshot) => Snapshot, key = '') => {
    setHist((h) => (h ? commit(h, fn(h.present), key, Date.now()) : h))
  }, [])
  const applyDoc = useCallback(
    (fn: (d: Snapshot['doc']) => Snapshot['doc'], key = '') => apply((s) => ({ ...s, doc: fn(s.doc) }), key),
    [apply],
  )
  const patch = useCallback((id: string, pt: Partial<PageBlock>, key = '') => applyDoc((d) => updateBlock(d, id, pt), key), [applyDoc])

  const doUndo = useCallback(() => {
    setHist((h) => (h ? undo(h) : h))
    setResetTok((n) => n + 1)
  }, [])
  const doRedo = useCallback(() => {
    setHist((h) => (h ? redo(h) : h))
    setResetTok((n) => n + 1)
  }, [])

  // Ctrl/Cmd+Z, Shift+Z, Ctrl+Y — страничная история; внутри полей и TipTap работает их собственная.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [doUndo, doRedo])

  // Загруженные в блок изображения.
  useEffect(
    () =>
      onDone((item) => {
        const t = item.target
        if (t.type !== 'page' || t.pageId !== pageId || !item.media) return
        const md = item.media
        // Блок-получатель ищем в актуальном документе: фото → изображение, видео/обложка → видео-блок.
        const changeFor = (blk: PageBlock | undefined): Partial<PageBlock> | null => {
          if (blk?.type === 'video') {
            // В видео-блок попадает только готовый файл: незавершённая загрузка не публикуется.
            if (md.status && md.status !== 'ready') return null
            if (t.slot === 'poster') return md.kind === 'image' ? { posterMediaId: md.id, posterUrl: md.thumb ?? md.url } : null
            return md.kind === 'video' ? { mediaId: md.id, url: md.url, mime: md.mime } : null
          }
          if (blk?.type === 'image' && md.kind === 'image' && !t.slot)
            return {
              image: {
                mediaId: md.id,
                src: md.thumb ?? md.url,
                width: 1,
                height: 1,
                alt: '',
              },
            }
          return null
        }
        setHist((h) => {
          if (!h) return h
          const ch = changeFor(h.present.doc.blocks.find((x) => x.id === t.replace))
          return ch
            ? commit(
                h,
                {
                  ...h.present,
                  doc: updateBlock(h.present.doc, t.replace, ch),
                },
                '',
                Date.now(),
              )
            : h
        })
      }),
    [onDone, pageId],
  )

  const save = useCallback(
    async (version: boolean, overrideRev?: number, keepalive = false) => {
      if (!snap) return null
      setStatus('saving')
      setError(null)
      try {
        const res = await api.save(pageId, { ...snap, rev: overrideRev ?? rev, version }, keepalive)
        setRev(res.page.rev)
        setView(res.page)
        const sent = snap
        if (docSignature(snapOf(res.page)) !== docSignature(sent)) {
          // Сервер нормализовал документ иначе, чем видно в редакторе: показываем сохранённое, а не «молча» теряем.
          const server = snapOf(res.page)
          try {
            localStorage.setItem(rescueKey(pageId), JSON.stringify({ snap: sent, at: Date.now() }))
          } catch {
            /* ignore */
          }
          setSaved(json(server))
          setHist((h) => (h && h.present === sent ? initHistory(server) : h))
          setResetTok((n) => n + 1)
          setNotice('Внимание: сервер сохранил страницу не в том виде, что в редакторе. Показана сохранённая версия — проверьте текст.')
        } else setSaved(json(snap))
        setStatus('saved')
        setConflict(null)
        return res.page
      } catch (e) {
        setStatus('error')
        if (e instanceof AdminHttpError && e.code === 'conflict' && e.body.page) {
          setConflict(e.body.page as PageView)
          setError('Страница изменена в другом окне или на другом устройстве.')
        } else if (e instanceof AdminHttpError && isAuthLost(e.code)) setAuthLost(true)
        else setError(adminErrorText(e))
        return null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- api пересоздаётся каждый рендер, зависит только от initData
    [snap, rev, pageId, initData],
  )

  // Автосохранение: черновик через паузу после правки (без версии; версия — по кнопке и при публикации).
  // После ошибки — реже; после потери сессии — не повторяем (сервер всё равно ответит 401).
  useEffect(() => {
    // Пока открыт выбор файла, не сохраняем: смена состояния/bridge закрывает нативный выбор в MAX.
    if (!dirty || conflict || authLost || status === 'saving' || picking) return
    const t = setTimeout(() => void save(false), status === 'error' ? AUTOSAVE_MS * 5 : AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [dirty, conflict, authLost, status, save, picking])

  // Уход со страницы (сворачивание MAX, перезагрузка, закрытие): немедленно отправляем черновик keepalive-запросом.
  const flushRef = useRef<() => void>(() => {})
  useEffect(() => {
    flushRef.current = () => {
      if (!snap || !dirty || conflict || authLost) return
      try {
        localStorage.setItem(localKey(pageId), JSON.stringify({ snap, at: Date.now() }))
      } catch {
        /* ignore */
      }
      // Уход в фон ради выбора файла — не уход со страницы: копия в localStorage уже есть, сеть не трогаем.
      if (status !== 'saving' && !devicePickerOpen()) void save(false, undefined, true)
    }
  })
  useEffect(() => {
    const onHide = () => flushRef.current()
    const onVis = () => document.visibilityState === 'hidden' && flushRef.current()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const publish = async () => {
    if (!snap) return
    if (dirty && !(await save(true))) return
    try {
      const res = await api.publish(pageId)
      setView(res.page)
      setRev(res.page.rev)
      const back = res.pendingBacklinks ?? []
      setBacklinks(back)
      setNotice(
        (res.warnings.length
          ? `Опубликовано. Внимание: ${res.warnings.length} кнопк(и) ведут на неопубликованные или удалённые страницы — на сайте они неактивны.`
          : 'Опубликовано.') +
          (back.length
            ? ` Кнопки на эту страницу есть только в черновиках: ${back.map((x) => `«${x.title}»`).join(', ')} — опубликуйте их, чтобы кнопки появились на сайте.`
            : ''),
      )
    } catch (e) {
      setError(adminErrorText(e))
    }
  }
  const unpublish = async () => {
    const extra = refs.length ? `\nНа неё ведут кнопки страниц: ${refs.map((x) => `«${x.title}»`).join(', ')}.` : ''
    if (!window.confirm(`Снять страницу с публикации?${extra}`)) return
    try {
      const res = await api.unpublish(pageId)
      setView(res.page)
      setRev(res.page.rev)
      setNotice('Страница снята с публикации.')
    } catch (e) {
      setError(adminErrorText(e))
    }
  }
  const restoreVersion = async (v: number) => {
    if (dirty && !window.confirm('Несохранённые правки будут заменены выбранной версией. Продолжить?')) return
    try {
      const res = await api.restoreVersion(pageId, v)
      const full = await api.get(pageId)
      load(full.page, full.links, full.referencedBy)
      setVersions(false)
      setNotice(
        `Восстановлена версия №${v} (сохранена как новая версия). ${res.page.status === 'published' ? 'Опубликуйте, чтобы изменения появились на сайте.' : ''}`,
      )
    } catch (e) {
      setError(adminErrorText(e))
    }
  }

  if (!view || !hist || !snap) {
    return error ? (
      <div>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <button type="button" className={styles.btn} onClick={onClose}>
          ← К списку
        </button>
      </div>
    ) : (
      <p className={m.hintText}>Загрузка страницы…</p>
    )
  }

  const blocks = snap.doc.blocks
  const full = blocks.length >= PAGE_BLOCKS_MAX
  const linkFor = (id: string) => links[id]
  const add = (at: number, type: PageBlockType) => {
    const b = newPageBlock(type)
    applyDoc((d) => insertBlock(d, at, b))
    setSelected(b.id)
    if (type === 'image' || type === 'video') fromDevice(type, b.id)
  }
  const addItems = (at: number): MenuItem[] =>
    PAGE_BLOCK_TYPES.map((t) => ({
      label: PAGE_BLOCK_LABEL[t],
      disabled: full,
      onSelect: () => add(at, t),
    }))
  const blockItems = (id: string): MenuItem[] => {
    const i = blocks.findIndex((b) => b.id === id)
    const b = blocks[i]
    if (!b) return []
    const items: MenuItem[] = []
    if (b.type === 'button') {
      items.push({
        label: 'Изменить текст',
        onSelect: () => setEditingText(b.id),
      })
      items.push({
        label: 'Куда ведёт…',
        onSelect: () => setPicker({ kind: 'target', id: b.id }),
      })
    }
    if (b.type === 'image')
      items.push({
        label: b.image ? 'Заменить фото с устройства' : 'Добавить фото с устройства',
        onSelect: () => fromDevice('image', b.id),
      })
    if (b.type === 'image') items.push({ label: 'Фото из медиатеки', onSelect: () => setPicker({ kind: 'image', id: b.id }) })
    if (b.type === 'video') {
      items.push({
        label: b.mediaId ? 'Заменить видео с устройства' : 'Добавить видео с устройства',
        onSelect: () => fromDevice('video', b.id),
      })
      items.push({ label: 'Видео из медиатеки', onSelect: () => setPicker({ kind: 'video', id: b.id }) })
      items.push({
        label: 'Обложка из медиатеки',
        disabled: !b.mediaId,
        onSelect: () => setPicker({ kind: 'poster', id: b.id }),
      })
    }
    if (b.type === 'text' || b.type === 'heading') items.push({ label: 'Редактировать', onSelect: () => setSelected(b.id) })
    items.push('sep')
    for (const w of WIDTHS)
      items.push({
        label: `Ширина: ${WIDTH_LABEL[w].toLowerCase()}${b.width === w ? ' ✓' : ''}`,
        onSelect: () => patch(b.id, { width: w }),
      })
    if (b.type === 'image' || b.type === 'video' || b.type === 'button')
      for (const a of ALIGNS)
        items.push({
          label: `Выравнивание: ${ALIGN_LABEL[a].toLowerCase()}${b.align === a ? ' ✓' : ''}`,
          onSelect: () => patch(b.id, { align: a }),
        })
    items.push('sep')
    items.push({
      label: 'Выше',
      disabled: i === 0,
      onSelect: () => applyDoc((d) => moveBlock(d, i, i - 1)),
    })
    items.push({
      label: 'Ниже',
      disabled: i === blocks.length - 1,
      onSelect: () => applyDoc((d) => moveBlock(d, i, i + 1)),
    })
    items.push({
      label: 'Вставить элемент выше',
      disabled: full,
      onSelect: () => setMenu({ kind: 'add', at: i, x: 80, y: 120 }),
    })
    items.push({
      label: 'Дублировать',
      disabled: full,
      onSelect: () => applyDoc((d) => duplicateBlock(d, i)),
    })
    items.push({
      label: 'Удалить',
      danger: true,
      onSelect: () => {
        applyDoc((d) => removeBlock(d, i))
        setSelected(null)
      },
    })
    return items
  }

  const inserter = (at: number) => (
    <div className={p.inserter} data-drop={drag?.before === at ? 'true' : undefined}>
      <button
        type="button"
        className={p.plus}
        aria-label={`Добавить элемент на позицию ${at + 1}`}
        data-testid="page-insert"
        disabled={full}
        onClick={(e) => {
          const rc = e.currentTarget.getBoundingClientRect()
          setMenu({ kind: 'add', at, x: rc.left, y: rc.bottom + 4 })
        }}
      >
        +
      </button>
    </div>
  )

  const checkVideos = async (files: File[]) => {
    const res = await probeVideos(files)
    setError(res.errors.length ? res.errors.join(' ') : null)
    return res.ok
  }

  /** Фото/видео/обложка — сразу нативный выбор файла (медиатека — отдельной кнопкой). */
  function fromDevice(kind: 'image' | 'video' | 'poster', id: string) {
    const t = {
      type: 'page' as const,
      pageId,
      pageName: snap!.title,
      replace: id,
      ...(kind === 'poster' ? { slot: 'poster' as const } : {}),
    }
    device.open(kind === 'video' ? DEVICE_VIDEO_ACCEPT : DEVICE_IMAGE_ACCEPT, false, (files) => {
      const one = files.slice(0, 1)
      if (kind !== 'video') return enqueue(one, t)
      void checkVideos(one).then((ok) => ok.length && enqueue(ok, t))
    })
  }

  const commitText = (b: ButtonBlock, text: string) => {
    setEditingText(null)
    const t = text.trim()
    if (t && t !== b.text) patch(b.id, { text: t.slice(0, 80) })
  }

  const renderBlock = (b: PageBlock, i: number) => {
    const sel = selected === b.id
    const wa = `${r[`w-${b.width}`]} ${b.type === 'image' || b.type === 'video' || b.type === 'button' ? r[`a-${b.align}`] : ''}`
    let body: ReactNode
    if (b.type === 'text' && sel) {
      body = (
        <div className={`${r.text} ${b.card ? p.cardEdit : ''}`}>
          <DescriptionEditor value={b.doc} resetToken={resetTok} onChange={(doc) => patch(b.id, { doc }, `text:${b.id}`)} />
        </div>
      )
    } else if (b.type === 'heading' && sel) {
      body = (
        <input
          className={`${styles.input} ${p.headingInput}`}
          aria-label="Текст заголовка"
          value={b.text}
          maxLength={160}
          onChange={(e) => patch(b.id, { text: e.target.value }, `heading:${b.id}`)}
        />
      )
    } else if (b.type === 'button' && editingText === b.id) {
      body = (
        <input
          className={styles.input}
          aria-label="Текст кнопки"
          defaultValue={b.text}
          maxLength={80}
          autoFocus
          onBlur={(e) => commitText(b, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText(b, e.currentTarget.value)
            if (e.key === 'Escape') setEditingText(null)
          }}
        />
      )
    } else body = <PageBlockView block={b} links={links} editing />

    return (
      <div
        key={b.id}
        className={`${p.block} ${wa} ${sel ? p.selected : ''}`}
        data-testid="page-block"
        data-type={b.type}
        data-width={b.width}
        data-align={b.align}
        data-selected={sel ? 'true' : undefined}
        onClickCapture={(e) => {
          // Ссылки внутри холста не переходят.
          if ((e.target as HTMLElement).closest('a')) e.preventDefault()
        }}
        onClick={() => setSelected(b.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(b.id)
          setMenu({ kind: 'block', id: b.id, x: e.clientX, y: e.clientY })
        }}
        onDoubleClick={() => b.type === 'button' && setEditingText(b.id)}
        onPointerUp={(e) => {
          if (e.pointerType !== 'touch' || b.type !== 'button') return
          const cur = { t: e.timeStamp, x: e.clientX, y: e.clientY }
          const prev = lastTap.current?.id === b.id ? lastTap.current : null
          if (isDoubleTap(prev, cur)) {
            lastTap.current = null
            setEditingText(b.id)
          } else lastTap.current = { ...cur, id: b.id }
        }}
        onDragOver={(e) => {
          if (!drag) return
          e.preventDefault()
          const rc = e.currentTarget.getBoundingClientRect()
          const before = e.clientY < rc.top + rc.height / 2 ? i : i + 1
          if (drag.before !== before) setDrag({ ...drag, before })
        }}
        onDrop={(e) => {
          if (!drag) return
          e.preventDefault()
          if (drag.before !== null) applyDoc((d) => dropAt(d, drag.from, drag.before!))
          setDrag(null)
        }}
      >
        <div className={p.blockBar} data-visible={sel ? 'true' : undefined}>
          <span className={p.blockType}>{PAGE_BLOCK_LABEL[b.type]}</span>
          <span
            className={m.dragHandle}
            draggable
            title="Перетащите"
            aria-hidden="true"
            onDragStart={(e) => {
              setDrag({ from: i, before: null })
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', b.id)
            }}
            onDragEnd={() => setDrag(null)}
          >
            ⋮⋮
          </span>
          <button
            type="button"
            className={m.iconBtn}
            aria-label={`${PAGE_BLOCK_LABEL[b.type]} ${i + 1}: выше`}
            disabled={i === 0}
            onClick={() => applyDoc((d) => moveBlock(d, i, i - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            className={m.iconBtn}
            aria-label={`${PAGE_BLOCK_LABEL[b.type]} ${i + 1}: ниже`}
            disabled={i === blocks.length - 1}
            onClick={() => applyDoc((d) => moveBlock(d, i, i + 1))}
          >
            ↓
          </button>
          <button
            type="button"
            className={m.iconBtn}
            aria-label={`${PAGE_BLOCK_LABEL[b.type]} ${i + 1}: действия`}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation()
              const rc = e.currentTarget.getBoundingClientRect()
              setSelected(b.id)
              setMenu({
                kind: 'block',
                id: b.id,
                x: rc.right - 200,
                y: rc.bottom + 4,
              })
            }}
          >
            ⋮
          </button>
        </div>
        {body}
        {sel ? inspector(b) : null}
      </div>
    )
  }

  const inspector = (b: PageBlock) => {
    return (
      <div className={p.inspector} data-testid="block-settings" onClick={(e) => e.stopPropagation()}>
        <Seg label="Ширина" value={b.width} options={WIDTHS} names={WIDTH_LABEL} onChange={(w) => patch(b.id, { width: w })} />
        {b.type === 'image' || b.type === 'video' || b.type === 'button' ? (
          <Seg label="Выравнивание" value={b.align} options={ALIGNS} names={ALIGN_LABEL} onChange={(a) => patch(b.id, { align: a })} />
        ) : null}
        {b.type === 'text' ? (
          <>
            <label className={p.check}>
              <input type="checkbox" checked={b.card} onChange={(e) => patch(b.id, { card: e.target.checked })} />
              Карточка
            </label>
            {b.card ? (
              <input
                className={styles.input}
                aria-label="Метка карточки"
                placeholder="Метка (например, 01)"
                maxLength={20}
                value={b.label}
                onChange={(e) => patch(b.id, { label: e.target.value }, `label:${b.id}`)}
              />
            ) : null}
          </>
        ) : null}
        {b.type === 'heading' ? (
          <>
            <input
              className={styles.input}
              aria-label="Якорь"
              placeholder="Якорь для оглавления (латиница)"
              maxLength={60}
              value={b.anchor}
              onChange={(e) =>
                patch(
                  b.id,
                  {
                    anchor: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  },
                  `anchor:${b.id}`,
                )
              }
            />
            <input
              className={styles.input}
              aria-label="Название в оглавлении"
              placeholder="Название в оглавлении"
              maxLength={60}
              value={b.navLabel}
              onChange={(e) => patch(b.id, { navLabel: e.target.value }, `nav:${b.id}`)}
            />
          </>
        ) : null}
        {b.type === 'image' ? (
          <>
            <div className={styles.actionsRow}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => fromDevice('image', b.id)}>
                {b.image ? 'Заменить фото' : 'Добавить фото'}
              </button>
              <button type="button" className={styles.btn} onClick={() => setPicker({ kind: 'image', id: b.id })}>
                Из медиатеки
              </button>
            </div>
            <DropZone
              target={{
                type: 'page',
                pageId,
                pageName: snap!.title,
                replace: b.id,
              }}
              accept={IMAGE_ACCEPT}
              label="Или перетащите фото сюда"
              testId={`page-drop-${b.id}`}
            />
            {b.image ? (
              <input
                className={styles.input}
                aria-label="Описание изображения (alt)"
                placeholder="Описание изображения (alt)"
                maxLength={200}
                value={b.image.alt ?? ''}
                onChange={(e) => patch(b.id, { image: { ...b.image!, alt: e.target.value } }, `alt:${b.id}`)}
              />
            ) : null}
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Пропорции</span>
              <select
                className={styles.input}
                value={b.aspect}
                onChange={(e) => patch(b.id, { aspect: e.target.value as typeof b.aspect })}
              >
                {ASPECTS.map((a) => (
                  <option key={a} value={a}>
                    {a === 'auto' ? 'Как у файла' : a}
                  </option>
                ))}
              </select>
            </label>
            <Seg label="Скругление" value={b.radius} options={RADII} names={RADIUS_LABEL} onChange={(v) => patch(b.id, { radius: v })} />
          </>
        ) : null}
        {b.type === 'video' ? (
          <>
            <div className={styles.actionsRow}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => fromDevice('video', b.id)}>
                {b.mediaId ? 'Заменить видео' : 'Добавить видео'}
              </button>
              <button type="button" className={styles.btn} onClick={() => setPicker({ kind: 'video', id: b.id })}>
                Из медиатеки
              </button>
            </div>
            <DropZone
              target={{
                type: 'page',
                pageId,
                pageName: snap!.title,
                replace: b.id,
              }}
              accept={VIDEO_ACCEPT}
              multiple={false}
              prepare={checkVideos}
              label="Или перетащите видео сюда (MP4 или WebM)"
              testId={`page-video-drop-${b.id}`}
            />
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Пропорции</span>
              <select
                className={styles.input}
                aria-label="Пропорции видео"
                value={b.aspect}
                onChange={(e) => patch(b.id, { aspect: e.target.value as typeof b.aspect })}
              >
                {VIDEO_ASPECTS.map((a) => (
                  <option key={a} value={a}>
                    {a === 'auto' ? 'Как у файла' : a}
                  </option>
                ))}
              </select>
            </label>
            {b.mediaId ? (
              <div className={p.posterTools} data-testid="video-poster-tools">
                <span className={styles.filterLabel}>Обложка {b.posterMediaId ? '✓' : '(не выбрана)'}</span>
                <div className={styles.actionsRow}>
                  <button type="button" className={styles.btn} onClick={() => fromDevice('poster', b.id)}>
                    С устройства
                  </button>
                  <button type="button" className={styles.btn} onClick={() => setPicker({ kind: 'poster', id: b.id })}>
                    Из медиатеки
                  </button>
                  {b.posterMediaId ? (
                    <button type="button" className={styles.btn} onClick={() => patch(b.id, { posterMediaId: null, posterUrl: '' })}>
                      Убрать обложку
                    </button>
                  ) : null}
                </div>
                <DropZone
                  target={{
                    type: 'page',
                    pageId,
                    pageName: snap!.title,
                    replace: b.id,
                    slot: 'poster',
                  }}
                  accept={IMAGE_ACCEPT}
                  multiple={false}
                  label="Загрузить обложку"
                  testId={`page-poster-drop-${b.id}`}
                />
                <FrameGrab
                  src={b.url}
                  onFrame={(file) =>
                    enqueue([file], {
                      type: 'page',
                      pageId,
                      pageName: snap!.title,
                      replace: b.id,
                      slot: 'poster',
                    })
                  }
                />
              </div>
            ) : null}
          </>
        ) : null}
        {b.type === 'button' ? (
          <>
            <Seg label="Вид" value={b.variant} options={VARIANTS} names={VARIANT_LABEL} onChange={(v) => patch(b.id, { variant: v })} />
            <div className={styles.actionsRow}>
              <button type="button" className={styles.btn} onClick={() => setEditingText(b.id)}>
                Изменить текст
              </button>
              <button type="button" className={styles.btn} onClick={() => setPicker({ kind: 'target', id: b.id })}>
                Куда ведёт…
              </button>
            </div>
            {buttonTargetInfo(b)}
          </>
        ) : null}
      </div>
    )
  }

  const buttonTargetInfo = (b: ButtonBlock) => {
    if (b.target.kind === 'none') return <p className={styles.error}>Кнопка пока никуда не ведёт — выберите страницу.</p>
    if (b.target.kind === 'external') return <p className={m.hintText}>Внешняя ссылка (перенесена со старой страницы): {b.target.url}</p>
    const l = linkFor(b.target.pageId)
    if (!l) return <p className={styles.error}>Страница не найдена.</p>
    return (
      <p className={l.deleted || l.status !== 'published' ? styles.error : m.hintText} data-testid="button-target">
        Ведёт на «{l.title}» ({pageHref(l.slug)})
        {l.deleted
          ? ' — страница в корзине'
          : l.status !== 'published'
            ? ' — страница не опубликована, на сайте кнопка будет неактивна'
            : ''}{' '}
        <button type="button" className={m.linkBtn} onClick={() => onOpen(b.target.kind === 'page' ? b.target.pageId : '')}>
          Открыть
        </button>
      </p>
    )
  }

  const unpublishedLinks = blocks.filter(
    (b) =>
      b.type === 'button' &&
      b.target.kind === 'page' &&
      (!links[b.target.pageId] || links[b.target.pageId]!.status !== 'published' || links[b.target.pageId]!.deleted),
  ).length
  const slugOk = isValidSlug(snap.slug)

  return (
    <div className={p.editor} data-testid="page-editor">
      {device.input}
      <div className={p.topBar}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            if (dirty) void save(false)
            onClose()
          }}
        >
          ← К списку
        </button>
        <span className={m.hintText} data-testid="page-save-status" role="status">
          {saveLabel({
            saving: status === 'saving',
            dirty,
            error: status === 'error',
          })}
          {status !== 'saving' && !dirty && status !== 'error' && view.status === 'published'
            ? view.changed
              ? ' · черновик отличается от сайта'
              : ' · опубликована'
            : ''}
        </span>
        <div className={p.topActions}>
          <button
            type="button"
            className={m.iconBtn}
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
            disabled={!hist.past.length}
            onClick={doUndo}
          >
            ↶
          </button>
          <button
            type="button"
            className={m.iconBtn}
            aria-label="Повторить"
            title="Повторить (Ctrl+Shift+Z)"
            disabled={!hist.future.length}
            onClick={doRedo}
          >
            ↷
          </button>
          <button type="button" className={styles.btn} onClick={() => setVersions((v) => !v)} aria-expanded={versions}>
            Версии
          </button>
          <button type="button" className={styles.btn} onClick={() => setPreview(true)}>
            Предпросмотр
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={status === 'saving' || !slugOk || !snap.title.trim()}
            onClick={() => void save(true)}
          >
            Сохранить
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={status === 'saving' || !slugOk || !snap.title.trim()}
            onClick={() => void publish()}
          >
            Опубликовать
          </button>
          {view.status === 'published' ? (
            <button type="button" className={styles.btn} onClick={() => void unpublish()}>
              Снять с публикации
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
          {conflict ? (
            <div className={styles.actionsRow}>
              <button type="button" className={styles.btn} onClick={() => load(conflict, links, refs)}>
                Загрузить версию с сервера
              </button>
              <button type="button" className={styles.btn} onClick={() => void save(true, conflict.rev)}>
                Оставить мою и сохранить
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {view?.status === 'published' && view.changed && !dirty ? (
        <p className={styles.error} role="status" data-testid="page-unpublished-changes">
          Изменения черновика ещё не на сайте — нажмите «Опубликовать».
        </p>
      ) : null}
      {backlinks.length ? (
        <p className={styles.notice} data-testid="page-backlinks">
          {backlinks.map((x) => (
            <button key={x.id} type="button" className={m.linkBtn} onClick={() => onOpen(x.id)}>
              Открыть «{x.title}»
            </button>
          ))}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status" data-testid="page-notice">
          {notice}
        </p>
      ) : null}
      {authLost ? (
        <p className={styles.error} data-testid="page-auth-lost" role="alert">
          Сессия MAX истекла — правки больше не отправляются на сервер. Они сохранены на этом устройстве. Закройте админку и откройте её
          снова из меню бота, затем нажмите «Восстановить».
        </p>
      ) : expiresIn !== null && expiresIn < 600 ? (
        <p className={styles.error} data-testid="page-auth-expiring" role="alert">
          {expiresIn > 0
            ? `Сессия MAX истекает через ${Math.max(1, Math.ceil(expiresIn / 60))} мин. Скоро сохранение перестанет работать — переоткройте админку из меню бота.`
            : 'Сессия MAX, вероятно, истекла. Переоткройте админку из меню бота, чтобы правки сохранялись.'}
        </p>
      ) : null}
      {backup ? (
        <div className={styles.notice} data-testid="page-backup">
          На этом устройстве есть несохранённые правки этой страницы.
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                apply(() => backup)
                setResetTok((n) => n + 1)
                setBackup(null)
                try {
                  localStorage.removeItem(rescueKey(pageId))
                } catch {
                  /* ignore */
                }
              }}
            >
              Восстановить
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setBackup(null)
                try {
                  localStorage.removeItem(rescueKey(pageId))
                  localStorage.removeItem(localKey(pageId))
                } catch {
                  /* ignore */
                }
              }}
            >
              Отбросить
            </button>
          </div>
        </div>
      ) : null}
      {unpublishedLinks ? (
        <p className={styles.error}>Кнопок на неопубликованные или удалённые страницы: {unpublishedLinks}. На сайте они будут неактивны.</p>
      ) : null}

      <div className={p.meta}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Название</span>
          <input
            className={styles.input}
            aria-label="Название страницы"
            value={snap.title}
            maxLength={160}
            onChange={(e) => {
              const title = e.target.value
              apply(
                (s) => ({
                  ...s,
                  title,
                  slug: slugTouched ? s.slug : slugify(title) || s.slug,
                }),
                'title',
              )
            }}
          />
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Адрес: silkway…/{snap.slug === 'science' ? '#science' : '#page/'}</span>
          <input
            className={styles.input}
            aria-label="Адрес страницы"
            value={snap.slug}
            maxLength={80}
            aria-invalid={!slugOk}
            onChange={(e) => {
              setSlugTouched(true)
              const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
              apply((s) => ({ ...s, slug }), 'slug')
            }}
          />
          {!slugOk ? <span className={styles.error}>Латиница в нижнем регистре, цифры и дефис.</span> : null}
          {view.status === 'published' && snap.slug !== view.slug ? (
            <span className={m.hintText}>Старый адрес перестанет работать после сохранения.</span>
          ) : null}
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Вступление</span>
          <textarea
            className={styles.input}
            aria-label="Вступление"
            rows={2}
            maxLength={600}
            value={snap.doc.lead}
            onChange={(e) => applyDoc((d) => ({ ...d, lead: e.target.value }), 'lead')}
          />
        </label>
        <label className={p.check}>
          <input type="checkbox" checked={snap.doc.toc} onChange={(e) => applyDoc((d) => ({ ...d, toc: e.target.checked }))} />
          Оглавление из заголовков с якорем
        </label>
      </div>

      {versions ? (
        <Versions initData={initData} pageId={pageId} onRestore={(v) => void restoreVersion(v)} onClose={() => setVersions(false)} />
      ) : null}

      <div
        className={p.canvas}
        data-testid="page-canvas"
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        onDragOver={(e) => drag && e.preventDefault()}
      >
        {blocks.length === 0 ? (
          <div className={p.empty} data-testid="page-empty">
            <p>Страница пока пуста. Добавьте первый элемент</p>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={(e) => {
                const rc = e.currentTarget.getBoundingClientRect()
                setMenu({ kind: 'add', at: 0, x: rc.left, y: rc.bottom + 4 })
              }}
            >
              + Добавить элемент
            </button>
          </div>
        ) : (
          <>
            {inserter(0)}
            {blocks.map((b, i) => (
              <div key={b.id} className={p.slot}>
                {renderBlock(b, i)}
                {inserter(i + 1)}
              </div>
            ))}
          </>
        )}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.kind === 'add' ? 'Добавить элемент' : 'Действия с элементом'}
          items={menu.kind === 'add' ? addItems(menu.at) : blockItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {picker?.kind === 'image' ? (
        <MediaPicker
          initData={initData}
          kind="image"
          exclude={new Set()}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            const x = list[0]
            if (x) patch(picker.id, { image: { ...mediaToBlockImage(x), alt: '' } })
            setPicker(null)
          }}
        />
      ) : null}
      {picker?.kind === 'video' || picker?.kind === 'poster' ? (
        <MediaPicker
          initData={initData}
          kind={picker.kind === 'video' ? 'video' : 'image'}
          exclude={new Set()}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            const x = list[0]
            if (x && x.status === 'ready') {
              if (picker.kind === 'poster')
                patch(picker.id, {
                  posterMediaId: x.id,
                  posterUrl: x.thumb ?? x.url,
                })
              else if (x.mime === 'video/mp4' || x.mime === 'video/webm') patch(picker.id, { mediaId: x.id, url: x.url, mime: x.mime })
              else setError('Для блока «Видео» нужен MP4 (H.264) или WebM.')
            } else if (x) setError('Файл ещё не готов — дождитесь окончания загрузки.')
            setPicker(null)
          }}
        />
      ) : null}
      {picker?.kind === 'target' ? (
        <TargetPicker
          initData={initData}
          selfId={pageId}
          onClose={() => setPicker(null)}
          onPick={(pg) => {
            setLinks((l) => ({
              ...l,
              [pg.id]: {
                slug: pg.slug,
                title: pg.title,
                status: pg.status,
                deleted: false,
              },
            }))
            patch(picker.id, { target: { kind: 'page', pageId: pg.id } })
            setPicker(null)
          }}
        />
      ) : null}
      {preview ? <Preview snap={snap} links={links} onClose={() => setPreview(false)} /> : null}
    </div>
  )
}

/** Снять обложку кадром из видео: плеер грузится только здесь, в открытом блоке, и только по кнопке. */
function FrameGrab({ src, onFrame }: { src: string; onFrame: (f: File) => void }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const ref = useRef<HTMLVideoElement>(null)
  if (!open)
    return (
      <button type="button" className={styles.btn} onClick={() => setOpen(true)} data-testid="frame-grab-open">
        Снять кадр из видео…
      </button>
    )
  return (
    <div className={p.frameGrab} data-testid="frame-grab">
      <video ref={ref} src={src} controls muted playsInline preload="metadata" crossOrigin="anonymous" className={p.frameVideo} />
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.btn}
          onClick={async () => {
            const v = ref.current
            const blob = v ? await captureFrame(v) : null
            if (!blob) return setMsg('Кадр снять не удалось — загрузите обложку файлом или выберите из медиатеки.')
            setMsg(null)
            onFrame(new File([blob], 'poster.jpg', { type: 'image/jpeg' }))
            setOpen(false)
          }}
        >
          Использовать текущий кадр
        </button>
        <button type="button" className={styles.btn} onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
      {msg ? <p className={styles.error}>{msg}</p> : null}
    </div>
  )
}
