import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BlockImage, PublicExtraBlock, VideoItem } from '../../cms/richBlocks'
import { isAllowedEmbed } from '../../cms/richBlocks'
import { installVideoFocus } from './videoFocus'
import site from './site.module.css'
import styles from './ProductExtras.module.css'

function Img({ image, sizes }: { image: BlockImage; sizes: string }) {
  return (
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.srcSet ? sizes : undefined}
      width={image.width}
      height={image.height}
      alt={image.alt ?? ''}
      loading="lazy"
      decoding="async"
      className={styles.img}
    />
  )
}

function Paras({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className={site.descText}>
            {p.split('\n').map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {l}
              </span>
            ))}
          </p>
        ))}
    </>
  )
}

function ExtraBlock({ block }: { block: PublicExtraBlock }) {
  switch (block.type) {
    case 'specs_table':
      return (
        <div className={site.descSection} data-testid="extra-specs">
          {block.title && <h3 className={site.descMajor}>{block.title}</h3>}
          <dl className={styles.specs}>
            {block.rows.map((r, i) => (
              <div key={i} className={styles.specRow}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    case 'benefits':
      return (
        <div className={site.descSection} data-testid="extra-benefits">
          {block.title && <h3 className={site.descMajor}>{block.title}</h3>}
          <ul className={styles.benefits}>
            {block.items.map((b, i) => (
              <li key={i}>
                {b.title && <strong className={styles.benefitTitle}>{b.title}</strong>}
                {b.text && <span className={site.descText}>{b.text}</span>}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'info':
      return (
        <div className={`${site.descSection} ${styles.info} ${styles[`tone_${block.tone}`] ?? ''}`} role="note" data-testid="extra-info">
          {block.title && <h3 className={site.descMinor}>{block.title}</h3>}
          <Paras text={block.text} />
        </div>
      )
    case 'image':
      return block.image ? (
        <figure className={styles.figure} data-testid="extra-image">
          <Img image={block.image} sizes="(min-width: 1024px) 64rem, 100vw" />
          {block.caption && <figcaption className={styles.caption}>{block.caption}</figcaption>}
        </figure>
      ) : null
    case 'gallery':
      return (
        <div className={styles.galleryBox} data-testid="extra-gallery">
          {block.title && <h3 className={site.descMajor}>{block.title}</h3>}
          <div className={styles.gallery}>
            {block.items.map((img, i) => (
              <Img key={i} image={img} sizes="(min-width: 1024px) 20rem, 50vw" />
            ))}
          </div>
        </div>
      )
  }
}

/** Дополнительные блоки товара после описания (таблица, преимущества, инфо, фото, галерея). */
export function ProductExtraBlocks({ blocks }: { blocks: readonly PublicExtraBlock[] }) {
  if (!blocks.length) return null
  return (
    <div className={`${site.descBody} ${styles.extras}`} data-testid="product-extras">
      {blocks.map((b) => (
        <ExtraBlock key={b.id} block={b} />
      ))}
    </div>
  )
}

/**
 * Карточка видео: до клика — только обложка (lazy), плеер монтируется по нажатию.
 * Без обложки у своего файла — первый кадр (FirstFrame). Свой файл — <video preload="none">: браузер читает поток диапазонами, целиком в память не грузится.
 */
/** Пропорции рамки плеера: CSS aspect-ratio или 'auto' (по обложке/файлу, до загрузки — 16:9). */
export type PlayerAspect = string | 'auto'

export function VideoCard({ video, aspect, testId = 'video-card' }: { video: VideoItem; aspect?: PlayerAspect; testId?: string }) {
  const [playing, setPlaying] = useState(false)
  const [natural, setNatural] = useState<string | null>(null)
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => installVideoFocus(), [])
  const frameStyle: CSSProperties | undefined =
    aspect === undefined ? undefined : { aspectRatio: aspect === 'auto' ? (natural ?? '16 / 9') : aspect }
  const onSize = (w: number, h: number) => {
    if (aspect === 'auto' && w > 0 && h > 0) setNatural(`${w} / ${h}`)
  }
  const label = video.title || 'Видео о товаре'
  const embed = video.provider !== 'upload' && isAllowedEmbed(video.src)
  if (video.provider !== 'upload' && !embed) return null
  return (
    <figure className={styles.video} data-testid={testId}>
      <div className={styles.frame} style={frameStyle}>
        {playing ? (
          embed ? (
            <iframe
              src={`${video.src}${video.src.includes('?') ? '&' : '?'}autoplay=1`}
              title={label}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className={styles.player}
              data-testid="video-iframe"
            />
          ) : (
            <video
              ref={ref}
              src={video.src}
              onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              poster={video.poster?.src}
              controls
              autoPlay
              playsInline
              preload="none"
              className={styles.player}
              data-testid="video-file"
            />
          )
        ) : (
          <button
            type="button"
            className={styles.poster}
            onClick={() => setPlaying(true)}
            aria-label={`Смотреть: ${label}`}
            data-testid="video-play"
          >
            {video.poster ? (
              <img
                src={video.poster.src}
                alt=""
                loading="lazy"
                decoding="async"
                className={styles.posterImg}
                onLoad={(e) => onSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              />
            ) : null}
            {!video.poster && video.provider === 'upload' ? <FirstFrame src={video.src} onSize={onSize} /> : null}
            <span className={styles.playIcon} aria-hidden="true" />
          </button>
        )}
      </div>
      {(video.title || video.description) && (
        <figcaption className={styles.videoText}>
          {video.title && <strong className={styles.benefitTitle}>{video.title}</strong>}
          {video.description && <span className={site.descText}>{video.description}</span>}
        </figcaption>
      )}
    </figure>
  )
}

/** Секция «Видео о товаре». Пустой список — секции нет (переключатель выключен или нет корректных видео). */
export function ProductVideos({ videos }: { videos: readonly VideoItem[] }) {
  if (!videos.length) return null
  return (
    <section className={site.desc} aria-labelledby="product-videos" data-testid="product-videos">
      <h2 className={site.h2} id="product-videos">
        Видео о товаре
      </h2>
      <div className={styles.videos}>
        {videos.map((v) => (
          <VideoCard key={v.key} video={v} />
        ))}
      </div>
    </section>
  )
}

/** Медиа-фрагмент #t: Safari/WebKit без него не рисует кадр до воспроизведения. */
const firstFrameSrc = (src: string) => (src.includes('#') ? src : `${src}#t=0.001`)

/**
 * Обложки нет — показываем первый кадр самого файла (вместо пустой тёмной рамки).
 * Lazy: до подхода к экрану preload="none" и src не ставим; затем только metadata (+ первый кадр), без автозапуска.
 */
function FirstFrame({ src, onSize }: { src: string; onSize: (w: number, h: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return (
    <video
      ref={ref}
      src={near ? firstFrameSrc(src) : undefined}
      preload={near ? 'metadata' : 'none'}
      muted
      playsInline
      disablePictureInPicture
      tabIndex={-1}
      aria-hidden="true"
      className={styles.posterImg}
      style={{ pointerEvents: 'none' }}
      data-testid="video-first-frame"
      onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
    />
  )
}
