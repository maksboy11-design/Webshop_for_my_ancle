import { useMemo, type CSSProperties } from 'react'
import { BREAKPOINTS } from '../../config/breakpoints'
import {
  CARD_RECT,
  GENERATOR_BODY,
  HERO_BACKGROUNDS,
  SHELF_HOTSPOTS,
  boxStyle,
  boxStyleIn,
  cardStyle,
  type Rect,
} from '../../config/heroLayout'
import { productHref } from '../../config/hashRoute'
import { ROUTES } from '../../config/routes'
import { FEATURED_PRODUCT, type FeaturedProduct } from '../../data/featuredProduct'
import { HERO_COPY } from '../../data/hero'
import { priceListItem } from '../../data/priceList'
import { type Product } from '../../data/products'
import { useProductById } from '../../cms/liveProducts'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useProductCard } from '../../hooks/useProductCard'
import { ArrowRightIcon } from '../icons'
import { ProductCard } from '../Scene/ProductCard'
import { GlassPanel } from '../../ui/GlassPanel'
import { Reveal } from '../../ui/motion'
import { Benefits } from './Benefits'
import styles from './Hero.module.css'

type CardCtrl = ReturnType<typeof useProductCard>


function catalogCard(product: Product): FeaturedProduct {
  return {
    title: product.name,
    description: product.pack ?? '',
    price: product.price,
    image: {
      src: product.image.src,
      alt: product.name,
      aspectRatio: product.image.width / product.image.height,
      visible: true,
    },
    ctaLabel: 'Перейти в карточку',
  }
}

/**
 * Данные товаров для Hero из живого каталога (имя, фасовка, цена, фото).
 * Редакционный текст Hero и FEATURED_PRODUCT (заголовок/описание) не переопределяются — только цена флагмана.
 */
function useHeroCatalog() {
  const astaxanthin = useProductById('astaxanthin')
  const flagship = useProductById('flagship')
  const astaxanthinCard = useMemo(() => (astaxanthin ? catalogCard(astaxanthin) : null), [astaxanthin])
  const featured = useMemo<FeaturedProduct>(
    () => ({ ...FEATURED_PRODUCT, price: flagship ? flagship.price : FEATURED_PRODUCT.price }),
    [flagship],
  )
  return { ASTAXANTHIN: astaxanthin, ASTAXANTHIN_CARD: astaxanthinCard, featured }
}

/** Портативной бутылки в каталоге нет — только строка прайса MY20, без страницы и фото. */
const BOTTLE_PRICE = priceListItem('MY20')
const BOTTLE_CARD: FeaturedProduct | null = BOTTLE_PRICE
  ? {
      title: BOTTLE_PRICE.name,
      description: '',
      price: { rub: BOTTLE_PRICE.rub, pv: BOTTLE_PRICE.pv },
      image: { src: null, alt: '', aspectRatio: 44 / 124, visible: true },
      ctaLabel: 'Перейти в карточку',
    }
  : null

function ShelfButton({
  id,
  label,
  rect,
  frame,
  card,
}: {
  id: string
  label: string
  rect: Rect
  frame: { width: number; height: number }
  card: CardCtrl
}) {
  return (
    <button
      ref={card.bindTrigger}
      type="button"
      className={styles.hotspot}
      style={boxStyleIn(rect, frame.width, frame.height)}
      data-hotspot={id}
      data-testid={id}
      aria-expanded={card.open}
      aria-controls={card.cardId}
      aria-label={`${label}: показать карточку товара`}
      onClick={card.activate}
      {...card.hoverHandlers}
    />
  )
}

function ShelfCard({
  id,
  card,
  product,
  href,
}: {
  id: string
  card: CardCtrl
  product: FeaturedProduct
  href: string | null
}) {
  return (
    <div className={styles.cardSlot} data-open={card.open} data-testid={`card-${id}`}>
      <ProductCard
        product={product}
        id={card.cardId}
        cardRef={card.bindCard}
        href={href}
        placeholder={product.image.src ? undefined : null}
        {...card.hoverHandlers}
      />
    </div>
  )
}

/**
 * Первый экран. Фон — утверждённые кадры с генератором и ванной.
 * Ниже lg — вертикальный кадр, плашка и одна ссылка. От lg — тот же десктопный кадр
 * целиком и прозрачная зона поверх нарисованного генератора. Отдельный PNG генератора
 * не накладывается: у него другой ракурс.
 * Бутылка и астаксантин уже вшиты в фон: поверх только невидимые зоны, как у генератора.
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
  const { ASTAXANTHIN, ASTAXANTHIN_CARD } = useHeroCatalog()
  const bottle = useProductCard()
  const astax = useProductCard()
  const frame = { width: HERO_BACKGROUNDS.mobile.width, height: HERO_BACKGROUNDS.mobile.height }

  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-layout="mobile">
      <div className={styles.mobile} data-testid="stage">
        <HeroBackground variant="mobile" />
        <div className={styles.mobileHits}>
          <div className={styles.mobileHitFrame}>
            {BOTTLE_CARD && (
              <ShelfButton
                id="hydrogen-bottle"
                label={BOTTLE_CARD.title}
                rect={SHELF_HOTSPOTS.hydrogenBottle.mobile}
                frame={frame}
                card={bottle}
              />
            )}
            {ASTAXANTHIN_CARD && (
              <ShelfButton
                id="astaxanthin"
                label={ASTAXANTHIN_CARD.title}
                rect={SHELF_HOTSPOTS.astaxanthin.mobile}
                frame={frame}
                card={astax}
              />
            )}
          </div>
        </div>
        <Reveal className={styles.plaqueWrap}>
          <GlassPanel className={styles.plaque} testId="copy">
            <div>
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
          </GlassPanel>
        </Reveal>
      </div>
      {BOTTLE_CARD && <ShelfCard id="hydrogen-bottle" card={bottle} product={BOTTLE_CARD} href={null} />}
      {ASTAXANTHIN && ASTAXANTHIN_CARD && (
        <ShelfCard
          id="astaxanthin"
          card={astax}
          product={ASTAXANTHIN_CARD}
          href={productHref(ASTAXANTHIN.slug)}
        />
      )}
      <Benefits className={styles.benefits} />
    </section>
  )
}

export function Hero() {
  const { ASTAXANTHIN, ASTAXANTHIN_CARD, featured } = useHeroCatalog()
  const desktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg})`)
  const { mode, open, cardId, activate, toggle, bindTrigger, bindCard, hoverHandlers } =
    useProductCard()
  const bottle = useProductCard()
  const astax = useProductCard()

  if (!desktop) return <HeroMobile />

  const shelfFrame = { width: HERO_BACKGROUNDS.desktop.width, height: HERO_BACKGROUNDS.desktop.height }

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
        {BOTTLE_CARD && (
          <ShelfButton
            id="hydrogen-bottle"
            label={BOTTLE_CARD.title}
            rect={SHELF_HOTSPOTS.hydrogenBottle.desktop}
            frame={shelfFrame}
            card={bottle}
          />
        )}
        {ASTAXANTHIN_CARD && (
          <ShelfButton
            id="astaxanthin"
            label={ASTAXANTHIN_CARD.title}
            rect={SHELF_HOTSPOTS.astaxanthin.desktop}
            frame={shelfFrame}
            card={astax}
          />
        )}
      </div>

      {/* Сразу после сцены: Tab с прибора попадает на кнопку карточки, а не на CTA. */}
      <div className={styles.cardSlot} data-testid="card-slot" data-open={open}>
        <ProductCard
          product={featured}
          id={cardId}
          cardRef={bindCard}
          href={productHref('flagship-device')}
          {...hoverHandlers}
        />
      </div>
      {BOTTLE_CARD && <ShelfCard id="hydrogen-bottle" card={bottle} product={BOTTLE_CARD} href={null} />}
      {ASTAXANTHIN && ASTAXANTHIN_CARD && (
        <ShelfCard
          id="astaxanthin"
          card={astax}
          product={ASTAXANTHIN_CARD}
          href={productHref(ASTAXANTHIN.slug)}
        />
      )}

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
