/** Форма правки отзыва. Загружается лениво (React.lazy), чтобы не утяжелять первый экран списка. */
import { useState } from 'react'
import { AUTHOR_MAX, REVIEW_TEXT_MAX, type AdminReviewDetail } from './api'
import styles from './App.module.css'
import { toSameOriginMedia } from './mediaUrl'

function charCount(value: string): number {
  return Array.from(value.trim()).length
}

export default function EditForm({
  detail,
  catalog,
  saving,
  onCancel,
  onSave,
}: {
  detail: AdminReviewDetail
  catalog: { id: string; name: string }[] | null
  saving: boolean
  onCancel: () => void
  onSave: (input: { text?: string; author?: string | null; productId?: string; removeMedia?: string[] }) => void
}) {
  const [text, setText] = useState(detail.text)
  const [author, setAuthor] = useState(detail.author ?? '')
  const [productId, setProductId] = useState(detail.productId)
  const [removed, setRemoved] = useState<string[]>([])
  const textLen = charCount(text)
  const authorLen = charCount(author)
  const validation =
    textLen === 0
      ? 'Текст отзыва не может быть пустым.'
      : textLen > REVIEW_TEXT_MAX
        ? `Текст отзыва длиннее ${REVIEW_TEXT_MAX} символов.`
        : authorLen > AUTHOR_MAX
          ? `Имя автора длиннее ${AUTHOR_MAX} символов.`
          : null
  const options = catalog ?? [{ id: detail.productId, name: detail.productName }]
  const hasCurrent = options.some((o) => o.id === detail.productId)

  const removeMedia = (src: string, type: 'image' | 'video') => {
    const label = type === 'image' ? 'фото' : 'видео'
    if (!window.confirm(`Убрать это ${label} из отзыва? Изменение применится после «Сохранить».`)) return
    setRemoved((prev) => [...prev, src])
  }

  const submit = () => {
    if (validation || saving) return
    const input: { text?: string; author?: string | null; productId?: string; removeMedia?: string[] } = {}
    if (text.trim() !== detail.text) input.text = text
    const nextAuthor = author.trim() === '' ? null : author.trim()
    if (nextAuthor !== detail.author) input.author = nextAuthor
    if (productId !== detail.productId) input.productId = productId
    if (removed.length > 0) input.removeMedia = removed
    if (Object.keys(input).length === 0) {
      onCancel()
      return
    }
    onSave(input)
  }

  const visibleMedia = detail.media.filter((m) => !removed.includes(m.src))

  return (
    <section className={`${styles.detail} ${styles.editForm}`}>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Товар</span>
        <select className={styles.input} value={productId} onChange={(e) => setProductId(e.target.value)} disabled={saving}>
          {!hasCurrent ? <option value={detail.productId}>{detail.productName}</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Автор (пусто = не указан)</span>
        <input className={styles.input} value={author} onChange={(e) => setAuthor(e.target.value)} disabled={saving} />
        <span className={styles.counter}>
          {authorLen}/{AUTHOR_MAX}
        </span>
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Текст отзыва</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
        <span className={styles.counter}>
          {textLen}/{REVIEW_TEXT_MAX}
        </span>
      </label>
      <div className={styles.gallery}>
        {visibleMedia.length === 0 ? <div className={styles.noMedia}>Без медиа</div> : null}
        {visibleMedia.map((item, index) => (
          <div key={`${item.src}-${index}`} className={styles.editMedia}>
            {item.type === 'image' ? (
              <img src={toSameOriginMedia(item.src)} alt={item.alt ?? ''} loading="lazy" decoding="async" />
            ) : (
              <video src={toSameOriginMedia(item.src)} poster={toSameOriginMedia(item.poster)} controls playsInline muted preload="none" />
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => removeMedia(item.src, item.type)}
              disabled={saving}
            >
              {item.type === 'image' ? 'Удалить фото' : 'Удалить видео'}
            </button>
          </div>
        ))}
      </div>
      {validation ? <div className={styles.error}>{validation}</div> : null}
      <div className={styles.cardActions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={saving || validation != null}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
          Отмена
        </button>
      </div>
    </section>
  )
}
