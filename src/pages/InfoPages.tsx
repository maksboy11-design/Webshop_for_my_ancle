import { CONTACTS } from '../config/contacts'
import { COPY } from '../content/copy'
import { PRODUCTS } from '../data/products'
import { Card } from '../ui/Card'
import { Button, Chip } from '../components/site/ui'
import styles from '../components/site/site.module.css'

const VIDEO_FILTERS = ['Все', 'Приборы', 'БАДы', 'Уход'] as const

export function VideosPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <h1 className={styles.h1}>Видео покупателей</h1>
        <p className={styles.lead}>Публикуются только реальные видео с согласия авторов.</p>
        <div className={`${styles.chipRow} ${styles.headingGap}`}>
          {VIDEO_FILTERS.map((label, index) => (
            <Chip key={label} pressed={index === 0}>
              {label}
            </Chip>
          ))}
        </div>
      </header>
      <div className={styles.three} style={{ marginTop: '1.5rem' }}>
        {Array.from({ length: 6 }, (_, index) => (
          <Card
            key={index}
            variant="media"
            title="Место для видео"
            description="Товар и длительность будут указаны вместе с роликом."
          />
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
      <Card
        variant="media"
        headingLevel={2}
        title="Тема будет объявлена"
        description={`Ближайший вебинар · ${COPY.datePending}. Формат: онлайн · ${COPY.speakerPending}`}
        footer={
          <div className={styles.actions}>
            <Button disabled>Напомнить в Telegram</Button>
            <Button variant="secondary" disabled>
              Напомнить в MAX
            </Button>
          </div>
        }
      />
      <h2 className={styles.h2} style={{ marginTop: '2.5rem' }}>
        Записи
      </h2>
      <div className={`${styles.three} ${styles.headingGap}`}>
        {['w1', 'w2', 'w3'].map((id) => (
          <Card key={id} variant="media" title="Запись вебинара" description="Тема и дата будут добавлены." />
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
        <img src="/hero/_archive/hero-nature.jpg" width={1024} height={682} alt="Природа: озеро, горы и камни" />
      </div>
      <div className={styles.bannerCard}>
        <h1 className={styles.h1}>О бренде SILKWAY</h1>
        <p className={styles.lead}>Вода, природа и забота о себе</p>
      </div>
      <p className={styles.lead} style={{ marginTop: '1.5rem' }}>
        {COPY.aboutLead}
      </p>
      <div className={styles.three} style={{ marginTop: '1.5rem' }}>
        <Card variant="fact" headingLevel={2} title="Ассортимент" description="БАДы, приборы, средства ухода и товары для дома." />
        <Card variant="fact" headingLevel={2} title="Бренды" description="Чан Шэн Чжэ, ЭРА БОТАНИКА, JILANZHI, SILKWAY." />
        <Card variant="fact" headingLevel={2} title="Поддержка" description="Консультации в Telegram и MAX." />
      </div>
      <h2 className={styles.h2} style={{ marginTop: '2.5rem' }}>
        Продукция компании
      </h2>
      <div className={`${styles.grid} ${styles.headingGap}`}>
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
        <Card
          variant="contact"
          headingLevel={2}
          title="Telegram"
          description={CONTACTS.telegram ?? 'Ник или ссылка — уточняется'}
          footer={<Button disabled>Открыть Telegram</Button>}
        />
        <Card
          variant="contact"
          headingLevel={2}
          title="MAX"
          description={CONTACTS.max ?? 'Ссылка — уточняется'}
          footer={
            <Button variant="secondary" disabled>
              Открыть MAX
            </Button>
          }
        />
        <Card
          variant="contact"
          headingLevel={2}
          title="Телефон и адрес"
          description="Будут добавлены после подтверждения."
        />
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
