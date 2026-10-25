import { COPY, DOCUMENTS, FAQ, TRUST } from '../../content/copy'
import { POPULAR_IDS, PRODUCTS, productBySlug } from '../../data/products'
import { productHref } from '../../config/hashRoute'
import { Card } from '../../ui/Card'
import { Reveal } from '../../ui/motion'
import { ProductCard } from './ProductCard'
import { ReviewsBlock } from './reviews/ReviewsBlock'
import { Accordion, Button } from './ui'
import styles from './site.module.css'

export function HomeSections() {
  const flagship = productBySlug('flagship-device')!
  const popular = POPULAR_IDS.map((id) => PRODUCTS.find((item) => item.id === id)!).filter(Boolean)
  const supplements = PRODUCTS.find((item) => item.category === 'supplements')!

  return (
    <>
      <section className={styles.section} aria-label="Коротко о магазине">
        <div className={`${styles.shell} ${styles.trust}`}>
          {TRUST.map((item) => (
            <Card key={item.title} variant="trust" title={item.title} description={item.note} />
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-categories">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-categories">
            Категории
          </h2>
          <Reveal>
          <div className={styles.catGrid} style={{ marginTop: '1.5rem' }}>
            <Card
              variant="category"
              title="БАДы"
              description="Комплексы и напитки из каталога"
              href="#catalog?category=supplements"
              image={{ src: supplements.image.src, alt: '', width: supplements.image.width, height: supplements.image.height }}
            />
            <Card
              variant="category"
              title="Приборы для здоровья"
              description="Устройства для дома и ухода"
              href="#catalog?category=devices"
              image={{ src: '/products/device.png', alt: '', width: 601, height: 873 }}
            />
          </div>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-flagship">
        <div className={`${styles.shell} ${styles.flagship}`}>
          <img src={flagship.image.src} width={flagship.image.width} height={flagship.image.height} alt={flagship.name} />
          <div>
            <p className={styles.tag}>Приборы</p>
            <h2 className={styles.h2} id="home-flagship">
              {flagship.name}
            </h2>
            <p className={styles.lead}>{COPY.deviceNote}</p>
            <ul className={styles.checks}>
              <li>Характеристики — по паспорту</li>
              <li>Комплектация — по паспорту</li>
              <li>Документы — по запросу</li>
            </ul>
            <div className={styles.actions}>
              <Button href={productHref(flagship.slug)}>Подробнее о приборе</Button>
              <Button href="#contacts" variant="secondary">
                Получить консультацию
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-popular">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-popular">
            Популярные товары
          </h2>
          <div className={`${styles.grid} ${styles.gridCards}`} style={{ marginTop: '1.5rem' }}>
            {popular.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          <div className={styles.center}>
            <Button href="#catalog" variant="secondary">
              Весь каталог
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-docs">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-docs">
            Качество и документы
          </h2>
          <p className={styles.lead}>Файлы публикуются после проверки.</p>
          <div className={styles.three} style={{ marginTop: '1.5rem' }}>
            {DOCUMENTS.map((doc) => (
              <Card
                key={doc.id}
                variant="document"
                title={doc.title}
                description={COPY.filePending}
                footer={
                  <Button disabled aria-disabled="true">
                    Открыть PDF
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      </section>

            <ReviewsBlock
        heading="Отзывы"
        headingId="home-reviews"
        level="h2"
        lead="Текстовые отзывы, фотографии и видео покупателей — в одном разделе."
        cta={{ href: '#reviews', label: 'Все отзывы' }}
      />

      <section className={styles.section} aria-labelledby="home-webinars">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-webinars">
            Вебинары
          </h2>
          <div className={styles.trust} style={{ marginTop: '1.5rem' }}>
            <Card
              variant="media"
              title="Тема вебинара будет объявлена"
              description="Дата уточняется"
              footer={
                <Button href="#webinars" variant="primary">
                  Узнать о вебинаре
                </Button>
              }
            />
            <Card
              variant="media"
              title="Тема вебинара будет объявлена"
              description="Запись"
              footer={
                <Button href="#webinars" variant="secondary">
                  Смотреть записи
                </Button>
              }
            />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-faq">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-faq">
            Частые вопросы
          </h2>
          <div style={{ marginTop: '1.5rem' }}>
            <Accordion
              initiallyOpen={0}
              items={FAQ.map((item) => ({ id: item.id, title: item.q, body: <p>{item.a}</p> }))}
            />
          </div>
        </div>
      </section>
    </>
  )
}
