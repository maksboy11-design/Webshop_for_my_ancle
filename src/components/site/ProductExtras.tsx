import { useState } from 'react'
import type { BlockImage, PublicExtraBlock, VideoItem } from '../../cms/richBlocks'
import { isAllowedEmbed } from '../../cms/richBlocks'
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
 * Свой файл — <video preload="none">: браузер читает поток диапазонами, целиком в память не грузится.
 */
export function VideoCard({ video }: { video: VideoItem }) {
  const [playing, setPlaying] = useState(false)
  const label = video.title || 'Видео о товаре'
  const embed = video.provider !== 'upload' && isAllowedEmbed(video.src)
  if (video.provider !== 'upload' && !embed) return null
  return (
    <figure className={styles.video} data-testid="video-card">
      <div className={styles.frame}>
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
              src={video.src}
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
            {video.poster ? <img src={video.poster.src} alt="" loading="lazy" decoding="async" className={styles.posterImg} /> : null}
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
