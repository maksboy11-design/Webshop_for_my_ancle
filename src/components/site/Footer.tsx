import { ROUTES } from '../../config/routes'
import { Logo } from '../Header/Logo'
import styles from './site.module.css'

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.shell} ${styles.footerGrid}`}>
        <div>
          <Logo place="footer" />
          <p className={styles.note}>Приборы для здоровья и БАДы</p>
        </div>
        <div>
          <p className={styles.h3}>Каталог</p>
          <a href="#catalog?category=supplements">БАДы</a>
          <br />
          <a href="#catalog?category=devices">Приборы</a>
          <br />
          <a href="#catalog?category=care">Уход</a>
          <br />
          <a href="#catalog?category=home">Для дома</a>
        </div>
        <div>
          <p className={styles.h3}>Компания</p>
          <a href={ROUTES.about}>О бренде</a>
          <br />
          <a href={ROUTES.videos}>Видео</a>
          <br />
          <a href={ROUTES.webinars}>Вебинары</a>
        </div>
        <div>
          <p className={styles.h3}>Связь</p>
          <a href="#contacts">Telegram</a>
          <br />
          <a href="#contacts">MAX</a>
          <br />
          <a href="#privacy">Политика конфиденциальности</a>
        </div>
      </div>
      <p className={`${styles.shell} ${styles.legal}`}>© SILKWAY. Реквизиты продавца — уточняются.</p>
    </footer>
  )
}
