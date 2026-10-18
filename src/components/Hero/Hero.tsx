import type { CSSProperties } from 'react'
import { useId } from 'react'
import { ROUTES } from '../../config/routes'
import {
  CARD_RECT,
  HERO_IMAGE,
  HOTSPOTS,
  LAYER_RECTS,
  boxStyle,
  cardStyle,
  hotspotStyle,
} from '../../config/heroLayout'
import { SCENE_ASSETS } from '../../config/sceneAssets'
import { FEATURED_PRODUCT } from '../../data/featuredProduct'
import { HERO_COPY } from '../../data/hero'
import { NAV_ITEMS } from '../../data/navigation'
import { useProductCard } from '../../hooks/useProductCard'
import { ArrowRightIcon } from '../icons'
import { SearchField } from '../Header/SearchField'
import { ProductCard } from '../Scene/ProductCard'
import { ProductImage } from '../Scene/ProductImage'
import { BottlePlaceholder, DevicePlaceholder, GlassPlaceholder } from '../Scene/placeholders'
import { Benefits } from './Benefits'
import styles from './Hero.module.css'

const NAV_RECTS = {
  [ROUTES.home]: HOTSPOTS.nav.home,
  [ROUTES.catalog]: HOTSPOTS.nav.catalog,
  [ROUTES.videos]: HOTSPOTS.nav.videos,
  [ROUTES.webinars]: HOTSPOTS.nav.webinars,
  [ROUTES.about]: HOTSPOTS.nav.about,
} as const

const BOTTLE_RECTS = {
  omega: LAYER_RECTS.omega,
  vitamin: LAYER_RECTS.vitamin,
  magnesium: LAYER_RECTS.magnesium,
} as const


/**
 * Первый экран. Фон — неизменный файл-референс HALOS (<img>, без каких-либо эффектов). Всё
 * интерактивное — отдельные слои поверх него:
 *  - ≥64rem: прозрачные hotspot-зоны над вшитыми шапкой, CTA, прибором; тексты — живой HTML,
 *    скрытый визуально (дублирует вшитые для скринридеров и поиска);
 *  - <64rem: фон показывается целиком, под ним — настоящий HTML (шапка, заголовок, описание, CTA,
 *    преимущества) и карточка товара в потоке.
 */
export function Hero() {
  const { mode, open, cardId, activate, toggle, bindTrigger, bindCard, hoverHandlers } =
    useProductCard()
  const searchFormId = useId()

  const cardVars = {
    '--card-left': cardStyle(CARD_RECT).left,
    '--card-top': cardStyle(CARD_RECT).top,
    '--card-width': cardStyle(CARD_RECT).width,
    '--card-height': cardStyle(CARD_RECT).height,
  } as CSSProperties

  return (
    <section
      className={styles.hero}
      aria-labelledby="hero-title"
      data-card-mode={mode}
      data-card-open={open}
      style={cardVars}
    >
      <div className={styles.stage} data-testid="stage">
        {/* Фон: исходный файл без изменений. Тексты и объекты вшиты, поэтому alt пустой —
            смысл передаёт живой HTML (заголовок, описание, ссылки, карточка). */}
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

        {/* Слои-заглушки флаконов и стакана поверх вшитых объектов (в покое невидимы) */}
        {SCENE_ASSETS.bottles.map((bottle) => (
          <div
            key={bottle.id}
            className={styles.layer}
            style={boxStyle(BOTTLE_RECTS[bottle.id])}
            data-visible={bottle.visible}
            data-testid={`bottle-${bottle.id}`}
            aria-hidden="true"
          >
            <ProductImage
              slot={bottle}
              className={styles.fill}
              placeholder={<BottlePlaceholder tone={bottle.tone} />}
            />
          </div>
        ))}
        <div
          className={styles.layer}
          style={boxStyle(LAYER_RECTS.glass)}
          data-visible={SCENE_ASSETS.glass.visible}
          data-testid="glass"
          aria-hidden="true"
        >
          <ProductImage
            slot={SCENE_ASSETS.glass}
            className={styles.fill}
            placeholder={<GlassPlaceholder />}
          />
        </div>

        {/* Зоны над вшитой в фон шапкой и CTA (≥64rem). В покое прозрачные. */}
        <div className={styles.desktopOnly}>
          <a
            className={styles.hotspot}
            style={hotspotStyle(HOTSPOTS.logo)}
            href={ROUTES.home}
            data-hotspot="logo"
            aria-label="HALOS — на главную"
          />
          <nav className={styles.navLayer} aria-label="Основная навигация">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                className={`${styles.hotspot} ${styles.navLink}`}
                style={hotspotStyle(NAV_RECTS[item.href as keyof typeof NAV_RECTS])}
                href={item.href}
                data-hotspot={`nav-${item.href.slice(1)}`}
                aria-current={item.href === ROUTES.home ? 'page' : undefined}
              >
                <span className="visually-hidden">{item.label}</span>
              </a>
            ))}
          </nav>
          <div
            className={`${styles.hotspot} ${styles.searchBox}`}
            style={hotspotStyle(HOTSPOTS.search)}
            data-hotspot="search"
          >
            <SearchField variant="overlay" formId={searchFormId} />
          </div>
          <button
            type="submit"
            form={searchFormId}
            className={styles.hotspot}
            style={hotspotStyle(HOTSPOTS.searchButton)}
            data-hotspot="search-button"
            aria-label="Найти"
          />
          <a
            className={styles.hotspot}
            style={hotspotStyle(HOTSPOTS.profile)}
            href={ROUTES.account}
            data-hotspot="profile"
            aria-label="Профиль"
          />
          <a
            className={styles.hotspot}
            style={hotspotStyle(HOTSPOTS.cart)}
            href={ROUTES.cart}
            data-hotspot="cart"
            aria-label="Корзина"
          />
          <a
            className={`${styles.hotspot} ${styles.ctaHotspot}`}
            style={hotspotStyle(HOTSPOTS.cta)}
            href={ROUTES.about}
            data-hotspot="cta"
            aria-label={HERO_COPY.ctaLabel}
          />
        </div>

        {/* Прибор: настоящая кнопка-hotspot + заменяемый слой изображения */}
        <button
          ref={bindTrigger}
          type="button"
          className={`${styles.hotspot} ${styles.device}`}
          style={hotspotStyle(HOTSPOTS.device)}
          data-hotspot="device"
          data-testid="device"
          data-visible={SCENE_ASSETS.device.visible}
          aria-expanded={open}
          aria-controls={cardId}
          aria-label="Прибор для обогащения воды водородом: показать карточку товара"
          onClick={activate}
          {...hoverHandlers}
        >
          <ProductImage
            slot={SCENE_ASSETS.device}
            className={styles.fill}
            placeholder={<DevicePlaceholder />}
          />
        </button>
      </div>

      {/* Живой HTML-текст. ≥64rem скрыт визуально (вшит в фон), на узких экранах — основной. */}
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

      {/* Триггер для устройств без hover: карточка раскрывается в потоке под сценой */}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={cardId}
        onClick={toggle}
      >
        {open ? 'Скрыть карточку товара' : 'Показать карточку товара'}
      </button>

      <div className={styles.cardSlot} data-testid="card-slot">
        <ProductCard
          product={FEATURED_PRODUCT}
          id={cardId}
          cardRef={bindCard}
          {...hoverHandlers}
        />
      </div>

      <Benefits className={styles.benefits} />
    </section>
  )
}
