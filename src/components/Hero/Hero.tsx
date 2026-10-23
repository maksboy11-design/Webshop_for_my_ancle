import type { CSSProperties } from 'react'
import { BREAKPOINTS } from '../../config/breakpoints'
import { CARD_RECT, GENERATOR_BODY, HERO_BACKGROUNDS, boxStyle, cardStyle } from '../../config/heroLayout'
import { ROUTES } from '../../config/routes'
import { FEATURED_PRODUCT } from '../../data/featuredProduct'
import { HERO_COPY } from '../../data/hero'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useProductCard } from '../../hooks/useProductCard'
import { ArrowRightIcon } from '../icons'
import { ProductCard } from '../Scene/ProductCard'
import { Benefits } from './Benefits'
import styles from './Hero.module.css'

/**
 * Первый экран. Фон — утверждённые кадры с генератором и ванной.
 * Ниже lg — вертикальный кадр, плашка и одна ссылка. От lg — тот же десктопный кадр
 * целиком и прозрачная зона поверх нарисованного генератора. Отдельный PNG генератора
 * не накладывается: у него другой ракурс.
 */
function HeroBackground({ variant }: { variant: 'desktop' | 'mobile' }) {
  return (
    <picture className={styles.frame}>
      <source media={`(min-width: ${BREAKPOINTS.lg})`} srcSet={HERO_BACKGROUNDS.desktop.src} />
      <img
        className={variant === 'desktop' ? styles.bg : styles.mobileBg}
        src={HERO_BACKGROUNDS.mobile.src}
        width={HERO_BACKGROUNDS.mobile.width}
        height={HERO_BACKGROUNDS.mobile.height}
        alt=""
        data-testid="hero-bg"
        decoding="async"
        fetchPriority="high"
      />
    </picture>
  )
}

function HeroMobile() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-layout="mobile">
      <div className={styles.mobile} data-testid="stage">
        <HeroBackground variant="mobile" />
        <div className={styles.plaque} data-testid="copy">
          <p className={styles.mobileEyebrow}>{HERO_COPY.eyebrow}</p>
          <h1 id="hero-title" className={styles.mobileTitle}>
            {HERO_COPY.title}
          </h1>
          <p className={styles.mobileLead} data-testid="lead">
            {HERO_COPY.description}
          </p>
          <a className={`${styles.cta} ${styles.mobileCta}`} href={ROUTES.catalog}>
            <span>{HERO_COPY.ctaMobile}</span>
            <ArrowRightIcon className={styles.ctaArrow} size="1.375rem" />
          </a>
        </div>
      </div>
      <Benefits className={styles.benefits} />
    </section>
  )
}

export function Hero() {
  const desktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg})`)
  const { mode, open, cardId, activate, toggle, bindTrigger, bindCard, hoverHandlers } =
    useProductCard()

  if (!desktop) return <HeroMobile />

  const cardVars = {
    '--card-left': cardStyle(CARD_RECT).left,
    '--card-top': cardStyle(CARD_RECT).top,
    '--card-width': cardStyle(CARD_RECT).width,
  } as CSSProperties

  return (
    <section
      className={styles.hero}
      aria-labelledby="hero-title"
      data-card-mode={mode}
      data-card-open={open}
      data-layout="desktop"
      style={cardVars}
    >
      <div className={styles.stage} data-testid="stage">
        <HeroBackground variant="desktop" />

        <button
          ref={bindTrigger}
          type="button"
          className={`${styles.hotspot} ${styles.device}`}
          style={boxStyle(GENERATOR_BODY)}
          data-hotspot="device"
          data-testid="device"
          aria-expanded={open}
          aria-controls={cardId}
          aria-label="Прибор для обогащения воды водородом: показать карточку товара"
          onClick={activate}
          {...hoverHandlers}
        />
      </div>

      {/* Сразу после сцены: Tab с прибора попадает на кнопку карточки, а не на CTA. */}
      <div className={styles.cardSlot} data-testid="card-slot">
        <ProductCard
          product={FEATURED_PRODUCT}
          id={cardId}
          cardRef={bindCard}
          {...hoverHandlers}
        />
      </div>

      <div className={styles.copy} data-testid="copy">
        <p className={styles.eyebrow}>{HERO_COPY.eyebrow}</p>
        <h1 id="hero-title" className={styles.title}>
          {HERO_COPY.title}
        </h1>
        <p className={styles.lead} data-testid="lead">
          {HERO_COPY.description}
        </p>
        <a className={styles.cta} href={ROUTES.about}>
          <span>{HERO_COPY.ctaLabel}</span>
          <ArrowRightIcon className={styles.ctaArrow} size="1.375rem" />
        </a>
      </div>

      <Benefits className={styles.benefits} />

      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={cardId}
        onClick={toggle}
      >
        {open ? 'Скрыть карточку товара' : 'Показать карточку товара'}
      </button>

    </section>
  )
}
