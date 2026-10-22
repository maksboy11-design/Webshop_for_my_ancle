import type { CSSProperties } from 'react'
import { BREAKPOINTS } from '../../config/breakpoints'
import { CARD_RECT, HERO_IMAGE, cardStyle } from '../../config/heroLayout'
import { SCENE_ASSETS } from '../../config/sceneAssets'
import { ROUTES } from '../../config/routes'
import { FEATURED_PRODUCT } from '../../data/featuredProduct'
import { HERO_COPY } from '../../data/hero'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useProductCard } from '../../hooks/useProductCard'
import { ArrowRightIcon } from '../icons'
import { ProductCard } from '../Scene/ProductCard'
import { ProductImage } from '../Scene/ProductImage'
import { BottlePlaceholder, DevicePlaceholder, GlassPlaceholder } from '../Scene/placeholders'
import { Benefits } from './Benefits'
import styles from './Hero.module.css'

/**
 * Первый экран. Фон — неизменённый природный кадр. Прибор, флаконы, стакан и капсулы —
 * отдельные слои. Шапка, заголовок, CTA и преимущества — живой HTML (не вшиты в картинку).
 */
function HeroMobile() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-layout="mobile">
      <div className={styles.mobile} data-testid="stage">
        <img
          className={styles.mobileBg}
          src={HERO_IMAGE.src}
          width={HERO_IMAGE.width}
          height={HERO_IMAGE.height}
          alt=""
          data-testid="hero-bg"
          decoding="async"
          fetchPriority="high"
        />
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
        <img
          className={styles.bg}
          src={HERO_IMAGE.src}
          width={HERO_IMAGE.width}
          height={HERO_IMAGE.height}
          alt=""
          data-testid="hero-bg"
          decoding="async"
          fetchPriority="high"
        />

        {SCENE_ASSETS.bottles.map((bottle) => (
          <div
            key={bottle.id}
            className={`${styles.layer} ${styles[bottle.id]}`}
            data-visible={bottle.visible}
            data-testid={`bottle-${bottle.id}`}
            aria-hidden="true"
          >
            <ProductImage
              slot={bottle}
              className={`${styles.fill} ${styles.cast}`}
              placeholder={<BottlePlaceholder tone={bottle.tone} />}
            />
          </div>
        ))}

        <button
          ref={bindTrigger}
          type="button"
          className={`${styles.hotspot} ${styles.device}`}
          data-hotspot="device"
          data-testid="device"
          data-visible={SCENE_ASSETS.device.visible}
          aria-expanded={open}
          aria-controls={cardId}
          aria-label="Прибор для обогащения воды водородом: показать карточку товара"
          onClick={activate}
          {...hoverHandlers}
        >
          <span className={styles.deviceShadow}>
            <span className={styles.deviceGlow} data-testid="device-glow">
              <ProductImage
                slot={SCENE_ASSETS.device}
                className={styles.fill}
                placeholder={<DevicePlaceholder />}
              />
            </span>
          </span>
        </button>

        <div
          className={`${styles.layer} ${styles.front} ${styles.glass}`}
          data-visible={SCENE_ASSETS.glass.visible}
          data-testid="glass"
          aria-hidden="true"
        >
          <ProductImage
            slot={SCENE_ASSETS.glass}
            className={`${styles.fill} ${styles.cast}`}
            placeholder={<GlassPlaceholder />}
          />
        </div>

        <div
          className={`${styles.layer} ${styles.front} ${styles.capsules}`}
          data-visible={SCENE_ASSETS.capsules.visible}
          data-testid="capsules"
          aria-hidden="true"
        >
          <ProductImage
            slot={SCENE_ASSETS.capsules}
            className={`${styles.fill} ${styles.cast}`}
            placeholder={null}
          />
        </div>
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
