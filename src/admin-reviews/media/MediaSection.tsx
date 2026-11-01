/** Раздел «Медиатека»: все файлы, поиск/фильтр/сортировка, карточка файла с местами использования, безопасное удаление. */
import { useEffect, useState } from 'react'
import { formatBytes } from '../../cms/mediaTypes'
import { adminErrorText, productsApi } from '../adminHttp'
import styles from '../App.module.css'
import type { SectionProps } from '../sections'
import m from './Media.module.css'
import { KIND_LABEL, MediaPager, MediaTile, MediaToolbar, useMediaList } from './MediaBrowser'
import { mediaApi, type MediaItem, type MediaUsage } from './mediaApi'
import { DropZone, useMediaUploads } from './MediaUploads'

const ROLE_LABEL: Record<string, string> = {
  main: 'главное фото',
  gallery: 'галерея',
  video: 'видео',
  document: 'документ',
  block: 'описание',
  content_draft: 'блоки описания (черновик)',
  content_published: 'блоки описания (на сайте)',
  page_draft: 'страница (черновик)',
  page_published: 'страница (на сайте)',
}
/** Ссылки из блоков/страниц: их нельзя отвязать отсюда — только убрать в редакторе. */
const isContentRef = (u: MediaUsage) => u.role.startsWith('content_') || u.role.startsWith('page_')

export default function MediaSection({ initData, active, setBack }: SectionProps) {
  const list = useMediaList(initData)
  const { onDone, setSuggested } = useMediaUploads()
  const [sel, setSel] = useState<{ media: MediaItem; usage: MediaUsage[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const { reload } = list

  useEffect(() => onDone(() => reload()), [onDone, reload])
  useEffect(() => {
    if (active) setSuggested(null)
  }, [active, setSuggested])
  useEffect(() => {
    productsApi
      .list(initData)
      .then((r) => setNames(Object.fromEntries(r.products.map((p) => [p.id, p.name]))))
      .catch(() => undefined)
  }, [initData])
  useEffect(() => {
    if (!active) return
    setBack(sel ? () => setSel(null) : null)
  }, [active, sel, setBack])

  const open = async (item: MediaItem) => {
    setError(null)
    setNotice(null)
    try {
      setSel(await mediaApi.get(initData, item.id))
    } catch (err) {
      setError(adminErrorText(err))
    }
  }

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setNotice(done)
      setSel(null)
      reload()
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  const trash = (s: { media: MediaItem; usage: MediaUsage[] }) => {
    if (s.usage.some(isContentRef)) {
      window.alert('Файл используется в блоках описания или на странице. Сначала уберите его там.')
      return
    }
    const products = [...new Set(s.usage.map((u) => names[u.productId] ?? u.productId))]
    if (products.length) {
      if (
        !window.confirm(
          `Файл используется: ${products.join(', ')}. Отвязать от товаров и переместить в корзину? На сайте вернутся прежние фото.`,
        )
      )
        return
      return void act(() => mediaApi.trash(initData, s.media.id, true), 'Файл отвязан и перемещён в корзину.')
    }
    if (!window.confirm(`Переместить «${s.media.name}» в корзину? Его можно будет восстановить.`)) return
    void act(() => mediaApi.trash(initData, s.media.id), 'Файл перемещён в корзину.')
  }

  const s = sel
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Медиатека</h1>
      </header>
      {!list.st.trash ? <DropZone target={{ type: 'library' }} label="Перетащите сюда фото, видео или PDF" testId="library-drop" /> : null}
      <MediaToolbar list={list} showTrash />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {list.error ? (
        <p className={styles.error} role="alert">
          {list.error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {s ? (
        <section className={m.info} aria-label="Сведения о файле" data-testid="media-info">
          {s.media.kind === 'image' ? (
            <img className={m.infoPreview} src={s.media.variants.medium?.url ?? s.media.url} alt="" />
          ) : s.media.kind === 'video' ? (
            <video className={m.infoPreview} src={s.media.url} controls preload="metadata" />
          ) : null}
          <dl className={m.dl}>
            <dt>Имя</dt>
            <dd>{s.media.name}</dd>
            <dt>Тип</dt>
            <dd>
              {KIND_LABEL[s.media.kind]} · {s.media.mime}
            </dd>
            <dt>Размер</dt>
            <dd>{formatBytes(s.media.size)}</dd>
            {s.media.width ? (
              <>
                <dt>Разрешение</dt>
                <dd>
                  {s.media.width}×{s.media.height}
                </dd>
              </>
            ) : null}
            <dt>Статус</dt>
            <dd>
              {s.media.status === 'ready'
                ? 'готов'
                : s.media.status === 'processing'
                  ? 'обрабатывается'
                  : s.media.status === 'failed'
                    ? `ошибка обработки`
                    : s.media.status}
            </dd>
            <dt>Загружен</dt>
            <dd>{new Date(s.media.createdAt).toLocaleString('ru-RU')}</dd>
            {Object.keys(s.media.variants).length ? (
              <>
                <dt>Варианты</dt>
                <dd>
                  {Object.entries(s.media.variants)
                    .map(([k, v]) => `${k} ${v.width}px`)
                    .join(', ')}
                </dd>
              </>
            ) : null}
            <dt>Ссылка</dt>
            <dd>
              <a href={s.media.url} target="_blank" rel="noreferrer">
                открыть оригинал
              </a>
            </dd>
          </dl>
          <div>
            <strong>Где используется</strong>
            {s.usage.length ? (
              <ul data-testid="media-usage">
                {s.usage.map((u) => (
                  <li key={`${u.productId}-${u.pageId ?? ''}-${u.role}-${u.blockId}`}>
                    {u.pageId ? `«${u.title || u.pageId}»` : (names[u.productId] ?? u.productId)} — {ROLE_LABEL[u.role] ?? u.role}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={m.hintText}>Нигде не используется.</p>
            )}
          </div>
          <div className={styles.actionsRow}>
            {s.media.deletedAt ? (
              <>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={busy}
                  onClick={() => void act(() => mediaApi.restore(initData, s.media.id), 'Файл восстановлен.')}
                >
                  Восстановить
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={busy || s.usage.length > 0}
                  onClick={() => {
                    if (window.confirm(`Удалить «${s.media.name}» навсегда? Файл будет стёрт из хранилища, вернуть его нельзя.`)) {
                      void act(() => mediaApi.purge(initData, s.media.id), 'Файл удалён навсегда.')
                    }
                  }}
                >
                  Удалить навсегда
                </button>
              </>
            ) : (
              <>
                {s.media.kind === 'image' && s.media.status !== 'ready' ? (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={busy}
                    onClick={() => void act(() => mediaApi.process(initData, s.media.id), 'Обработка запущена повторно.')}
                  >
                    Обработать снова
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={busy || s.usage.some(isContentRef)}
                  title={s.usage.some(isContentRef) ? 'Используется в блоках или на странице' : undefined}
                  onClick={() => trash(s)}
                >
                  {s.usage.length ? 'Отвязать и в корзину' : 'В корзину'}
                </button>
              </>
            )}
            <button type="button" className={styles.btn} onClick={() => setSel(null)}>
              Закрыть
            </button>
          </div>
        </section>
      ) : null}
      <p className={m.hintText} role="status">
        {list.loading && !list.data ? 'Загрузка…' : list.data ? `Файлов: ${list.data.total}` : ''}
      </p>
      {list.data && !list.data.items.length ? <p className={m.hintText}>{list.st.trash ? 'Корзина пуста.' : 'Пока нет файлов.'}</p> : null}
      <ul className={m.grid}>
        {list.data?.items.map((item) => (
          <li key={item.id}>
            <MediaTile item={item} pressed={s?.media.id === item.id} onClick={() => void open(item)} />
          </li>
        ))}
      </ul>
      <MediaPager list={list} />
    </div>
  )
}
