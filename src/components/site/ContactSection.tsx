import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { CONTACTS } from '../../config/contacts'
import { COPY } from '../../content/copy'
import { submitContact } from '../../services/contactAdapter'
import { Button } from './ui'
import styles from './site.module.css'

export function ContactSection() {
  const base = useId()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [question, setQuestion] = useState('')
  const [consent, setConsent] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')

  const errors = {
    name: name.trim() ? '' : 'Укажите имя',
    contact: contact.trim() ? '' : 'Укажите телефон или ник в Telegram',
    question: question.trim() ? '' : 'Напишите вопрос',
    consent: consent ? '' : 'Нужно согласие на обработку персональных данных',
  }
  const ready = !errors.name && !errors.contact && !errors.question && !errors.consent

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!ready) return
    setSending(true)
    setNotice('')
    const result = await submitContact({ name: name.trim(), contact: contact.trim(), question: question.trim() })
    setSending(false)
    if (!result.ok) setNotice(COPY.formUnavailable)
  }

  const messenger = (label: string, url: string | null) =>
    url ? (
      <Button href={url} variant="primary">
        {label}
      </Button>
    ) : (
      <Button variant="primary" disabled aria-describedby={`${base}-link`}>
        {label}
      </Button>
    )

  return (
    <section className={styles.section} aria-labelledby={`${base}-title`}>
      <div className={`${styles.shell} ${styles.contact}`}>
        <div>
          <h2 className={styles.h2} id={`${base}-title`}>
            Остались вопросы?
          </h2>
          <p className={styles.lead}>Оставьте контакт — консультант ответит удобным способом.</p>
          <div className={styles.actions} style={{ marginTop: '1.25rem' }}>
            {messenger('Написать в Telegram', CONTACTS.telegram)}
            {messenger('Написать в MAX', CONTACTS.max)}
          </div>
          <p className={styles.note} id={`${base}-link`}>
            {COPY.linkPending}
          </p>
        </div>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <label className={styles.field}>
            Имя
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={attempted && !!errors.name}
              aria-describedby={attempted && errors.name ? `${base}-name` : undefined}
              autoComplete="name"
            />
            {attempted && errors.name && (
              <span className={styles.error} id={`${base}-name`}>
                {errors.name}
              </span>
            )}
          </label>
          <label className={styles.field}>
            Телефон или ник в Telegram
            <input
              name="contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              aria-invalid={attempted && !!errors.contact}
              aria-describedby={attempted && errors.contact ? `${base}-contact` : undefined}
              autoComplete="tel"
            />
            {attempted && errors.contact && (
              <span className={styles.error} id={`${base}-contact`}>
                {errors.contact}
              </span>
            )}
          </label>
          <label className={styles.field}>
            Ваш вопрос
            <textarea
              name="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              aria-invalid={attempted && !!errors.question}
              aria-describedby={attempted && errors.question ? `${base}-question` : undefined}
            />
            {attempted && errors.question && (
              <span className={styles.error} id={`${base}-question`}>
                {errors.question}
              </span>
            )}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              aria-invalid={attempted && !!errors.consent}
              aria-describedby={attempted && errors.consent ? `${base}-consent` : undefined}
            />
            <span>
              {COPY.consentLabel}{' '}
              <a href="#privacy">Политика конфиденциальности</a>
            </span>
          </label>
          {attempted && errors.consent && (
            <span className={styles.error} id={`${base}-consent`}>
              {errors.consent}
            </span>
          )}
          <Button variant="primary" block disabled={!ready || sending} type="submit">
            {sending ? 'Отправка…' : 'Отправить'}
          </Button>
          {notice && (
            <p className={styles.status} role="status">
              {notice}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
