import { CONTACTS } from '../config/contacts'
import { COPY } from '../content/copy'
import { PRODUCTS } from '../data/products'
import { Button, Chip } from '../components/site/ui'
import styles from '../components/site/site.module.css'

const VIDEO_FILTERS = ['Все', 'Приборы', 'БАДы', 'Уход'] as const

export function VideosPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <h1 className={styles.h1}>Видео покупателей</h1>
        <p className={styles.lead}>Публикуются только реальные видео с согласия авторов.</p>
        <div className={styles.chipRow} style={{ marginTop: '1rem' }}>
          {VIDEO_FILTERS.map((label, index) => (
            <Chip key={label} pressed={index === 0}>
              {label}
            </Chip>
          ))}
        </div>
      </header>
      <div className={styles.three} style={{ marginTop: '1.5rem' }}>
        {Array.from({ length: 6 }, (_, index) => (
          <article key={index} className={styles.video}>
            <div className={styles.poster} aria-hidden="true">
              <span className={styles.play}>▶</span>
            </div>
            <div className={styles.videoBody}>
              <h2 className={styles.h3}>Место для видео</h2>
              <p className={styles.note}>Товар и длительность будут указаны вместе с роликом.</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function WebinarsPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <h1 className={styles.h1}>Вебинары</h1>
        <p className={styles.lead}>Даты, темы и спикеры публикуются после подтверждения.</p>
      </header>
      <section className={styles.catCard} style={{ marginTop: '1.5rem' }} aria-labelledby="next-webinar">
        <p className={styles.note}>Ближайший вебинар · {COPY.datePending}</p>
        <h2 className={styles.h2} id="next-webinar">
          Тема будет объявлена
        </h2>
        <p>Формат: онлайн · {COPY.speakerPending}</p>
        <div className={styles.actions}>
          <Button disabled>Напомнить в Telegram</Button>
          <Button variant="secondary" disabled>
            Напомнить в MAX
          </Button>
        </div>
      </section>
      <h2 className={styles.h2} style={{ marginTop: '2.5rem' }}>
        Записи
      </h2>
      <div className={styles.three} style={{ marginTop: '1rem' }}>
        {['w1', 'w2', 'w3'].map((id) => (
          <article key={id} className={styles.video}>
            <div className={styles.poster} aria-hidden="true">
              <span className={styles.play}>▶</span>
            </div>
            <div className={styles.videoBody}>
              <h3 className={styles.h3}>Запись вебинара</h3>
              <p className={styles.note}>Тема и дата будут добавлены.</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function AboutPage() {
  const gallery = PRODUCTS.slice(0, 6)
  return (
    <div className={styles.shell}>
      <div className={styles.banner}>
        <img src="/hero-nature.jpg" width={1024} height={682} alt="Природа: озеро, горы и камни" />
      </div>
      <div className={styles.bannerCard}>
        <h1 className={styles.h1}>О бренде HALOS</h1>
        <p className={styles.lead}>Вода, природа и забота о себе</p>
      </div>
      <p className={styles.lead} style={{ marginTop: '1.5rem' }}>
        {COPY.aboutLead}
      </p>
      <div className={styles.three} style={{ marginTop: '1.5rem' }}>
        <article className={styles.fact}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>Ассортимент</h2>
          <p>БАДы, приборы, средства ухода и товары для дома.</p>
        </article>
        <article className={styles.fact}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>Бренды</h2>
          <p>Чан Шэн Чжэ, ЭРА БОТАНИКА, JILANZHI, SILKWAY.</p>
        </article>
        <article className={styles.fact}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>Поддержка</h2>
          <p>Консультации в Telegram и MAX.</p>
        </article>
      </div>
      <h2 className={styles.h2} style={{ marginTop: '2.5rem' }}>
        Продукция компании
      </h2>
      <div className={styles.grid} style={{ marginTop: '1rem' }}>
        {gallery.map((product) => (
          <a key={product.id} href={`#product/${product.slug}`} className={styles.media}>
            <img src={product.image.src} alt={product.name} width={product.image.width} height={product.image.height} />
          </a>
        ))}
      </div>
    </div>
  )
}

export function ContactsPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <h1 className={styles.h1}>Контакты</h1>
        <p className={styles.lead}>Быстрее всего ответим в мессенджерах.</p>
      </header>
      <div className={styles.three} style={{ marginTop: '1.5rem' }}>
        <article className={styles.panel}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>Telegram</h2>
          <p className={styles.note}>{CONTACTS.telegram ?? 'Ник или ссылка — уточняется'}</p>
          <Button disabled>Открыть Telegram</Button>
        </article>
        <article className={styles.panel}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>MAX</h2>
          <p className={styles.note}>{CONTACTS.max ?? 'Ссылка — уточняется'}</p>
          <Button variant="secondary" disabled>
            Открыть MAX
          </Button>
        </article>
        <article className={styles.panel}>
          <div className={styles.dot} aria-hidden="true" />
          <h2 className={styles.h3}>Телефон и адрес</h2>
          <p className={styles.note}>Будут добавлены после подтверждения.</p>
        </article>
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <div className={`${styles.shell} ${styles.pageHead}`}>
      <h1 className={styles.h1}>Политика конфиденциальности</h1>
      <p className={styles.lead}>{COPY.textPending}</p>
    </div>
  )
}
