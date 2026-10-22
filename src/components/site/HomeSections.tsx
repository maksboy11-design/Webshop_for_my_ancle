import { COPY, DOCUMENTS, FAQ, TRUST } from '../../content/copy'
import { POPULAR_IDS, PRODUCTS, productBySlug } from '../../data/products'
import { productHref } from '../../config/hashRoute'
import { ProductCard } from './ProductCard'
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
            <article key={item.title} className={styles.trustCard}>
              <div className={styles.dot} aria-hidden="true" />
              <h2 className={styles.h3}>{item.title}</h2>
              <p className={styles.note}>{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-categories">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-categories">
            Категории
          </h2>
          <div className={styles.catGrid} style={{ marginTop: '1.5rem' }}>
            <a className={styles.catCard} href="#catalog?category=supplements">
              <img src={supplements.image.src} width={supplements.image.width} height={supplements.image.height} alt="" />
              <div>
                <h3 className={styles.h3}>БАДы</h3>
                <p className={styles.lead}>Комплексы и напитки из каталога</p>
                <span className={styles.btn + ' ' + styles.primary}>Смотреть БАДы</span>
              </div>
            </a>
            <a className={styles.catCard} href="#catalog?category=devices">
              <img src="/products/device.png" width={601} height={873} alt="" />
              <div>
                <h3 className={styles.h3}>Приборы для здоровья</h3>
                <p className={styles.lead}>Устройства для дома и ухода</p>
                <span className={styles.btn + ' ' + styles.primary}>Смотреть приборы</span>
              </div>
            </a>
          </div>
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
          <div className={styles.grid} style={{ marginTop: '1.5rem' }}>
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
              <article key={doc.id} className={styles.doc}>
                <h3 className={styles.h3}>{doc.title}</h3>
                <p className={styles.note}>{COPY.filePending}</p>
                <Button disabled aria-disabled="true">
                  Открыть PDF
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-videos">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-videos">
            Видео покупателей
          </h2>
          <p className={styles.lead}>Публикуются только реальные видео с согласия авторов.</p>
          <div className={styles.three} style={{ marginTop: '1.5rem' }}>
            {['home-v1', 'home-v2', 'home-v3'].map((id) => (
              <article key={id} className={styles.video}>
                <div className={styles.poster} aria-hidden="true">
                  <span className={styles.play}>▶</span>
                </div>
                <div className={styles.videoBody}>
                  <h3 className={styles.h3}>Видео скоро появится</h3>
                  <p className={styles.note}>Товар и длительность будут указаны вместе с роликом.</p>
                </div>
              </article>
            ))}
          </div>
          <div className={styles.center}>
            <Button href="#videos" variant="secondary">
              Все видео
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="home-webinars">
        <div className={styles.shell}>
          <h2 className={styles.h2} id="home-webinars">
            Вебинары
          </h2>
          <div className={styles.trust} style={{ marginTop: '1.5rem' }}>
            <article className={styles.panel}>
              <p className={styles.note}>Дата уточняется</p>
              <h3 className={styles.h3}>Тема вебинара будет объявлена</h3>
              <Button href="#webinars" variant="primary">
                Узнать о вебинаре
              </Button>
            </article>
            <article className={styles.panel}>
              <p className={styles.note}>Запись</p>
              <h3 className={styles.h3}>Тема вебинара будет объявлена</h3>
              <Button href="#webinars" variant="secondary">
                Смотреть записи
              </Button>
            </article>
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
