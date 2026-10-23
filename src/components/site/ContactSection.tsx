import { COPY } from '../../content/copy'
import styles from './site.module.css'

/** Единая подпись в конце страниц. Без формы и мессенджеров. */
export function ContactSection() {
  return (
    <section className={styles.invite}>
      <p className={styles.inviteText}>{COPY.invite}</p>
    </section>
  )
}
