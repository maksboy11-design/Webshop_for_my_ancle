import type { Webinar } from '../../../cms/types'
import { youtubeEmbedUrl, youtubeWatchUrl } from '../../../cms/publishedWebinars'
import card from '../../../ui/card.module.css'
import styles from './webinar.module.css'

function formatDate(value: string | null): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : null
}

/** Запись вебинара: YouTube через youtube-nocookie без автозапуска или разрешённый файл. */
export function WebinarCard({ webinar }: { webinar: Webinar }) {
  const meta = [formatDate(webinar.date), webinar.speaker ? `Спикер: ${webinar.speaker}` : null].filter(Boolean).join(' · ')
  return (
    <article className={card.card} data-testid="webinar-card">
      <div className={styles.player}>
        {webinar.sourceType === 'youtube' && webinar.youtubeVideoId ? (
          <iframe
            src={youtubeEmbedUrl(webinar.youtubeVideoId, webinar.startSeconds)}
            title={`Вебинар: ${webinar.title}`}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : webinar.recordingSrc ? (
          <video controls preload="metadata" src={webinar.recordingSrc} aria-label={`Вебинар: ${webinar.title}`} />
        ) : null}
      </div>
      <div className={card.body}>
        <h3 className={card.title}>{webinar.title}</h3>
        {meta && <p className={card.description}>{meta}</p>}
        {webinar.sourceType === 'youtube' && webinar.youtubeVideoId && (
          <a className={styles.watch} href={youtubeWatchUrl(webinar.youtubeVideoId, webinar.startSeconds)} target="_blank" rel="noopener noreferrer">
            Смотреть на YouTube
          </a>
        )}
      </div>
    </article>
  )
}
