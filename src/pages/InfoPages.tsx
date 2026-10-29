import { COPY } from '../content/copy'
import { useProducts } from '../cms/liveProducts'
import { ReviewsBlock } from '../components/site/reviews/ReviewsBlock'
import { Card } from '../ui/Card'
import { WebinarCard } from '../components/site/webinars/WebinarCard'
import { usePublishedWebinars } from '../components/site/webinars/usePublishedWebinars'
import styles from '../components/site/site.module.css'

export function VideosPage() {
  return (
    <div className={styles.shell}>
      <ReviewsBlock
        heading="Отзывы"
        headingId="page-reviews"
        level="h1"
        lead="Текстовые отзывы, фотографии и видео покупателей — в одном разделе."
        pageHead
      />
    </div>
  )
}

export function WebinarsPage() {
  const { phase, webinars } = usePublishedWebinars()
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
      />
      <h2 className={styles.h2} style={{ marginTop: '2.5rem' }}>
        Записи
      </h2>
      {phase === 'ready' ? (
        <div className={`${styles.three} ${styles.headingGap}`}>
          {webinars.map((webinar) => (
            <WebinarCard key={webinar.id} webinar={webinar} />
          ))}
        </div>
      ) : (
        <p className={`${styles.lead} ${styles.headingGap}`} data-testid="webinars-empty" aria-busy={phase === 'loading' || undefined}>
          {phase === 'loading' ? 'Загружаем записи…' : 'Записей пока нет. Они появятся здесь после публикации.'}
        </p>
      )}
    </div>
  )
}

export function AboutPage() {
  const gallery = useProducts().slice(0, 6)
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
        <Card variant="fact" headingLevel={2} title="Поддержка" description="Консультации перед покупкой." />
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
