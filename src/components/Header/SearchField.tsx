import { useId, useRef } from 'react'
import type { FormEvent } from 'react'
import { ROUTES } from '../../config/routes'
import { SearchIcon } from '../icons'
import styles from './SearchField.module.css'

/**
 * Поиск продукции в «водной» стилистике. Настоящая форма: поле + одна кнопка-иконка отправки.
 * Каталога пока нет, поэтому отправка ведёт на якорь-заглушку каталога с параметром запроса (ROUTES.search).
 */
interface SearchFieldProps {
  /**
   * default — обычная «водная» строка (шапка на планшетах/телефонах).
   * overlay — прозрачное поле поверх вшитой в фон поисковой строки: в покое ничего не рисует,
   * при фокусе/вводе получает собственную заливку (иначе набранный текст налез бы на вшитый).
   * Кнопка отправки в overlay-варианте — отдельная зона над вшитой иконкой (атрибут form).
   */
  variant?: 'default' | 'overlay'
  formId?: string
}

export function SearchField({ variant = 'default', formId }: SearchFieldProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = inputRef.current?.value.trim() ?? ''
    if (!query) {
      inputRef.current?.focus()
      return
    }
    window.location.hash = ROUTES.search(query)
  }

  return (
    <form
      id={formId}
      className={`${styles.search} ${variant === 'overlay' ? styles.overlay : ''}`}
      role="search"
      onSubmit={handleSubmit}
    >
      <label className="visually-hidden" htmlFor={inputId}>
        Поиск продукции
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={styles.input}
        type="search"
        name="q"
        placeholder="Поиск продукции"
        autoComplete="off"
        enterKeyHint="search"
      />
      {variant === 'default' && (
        <button className={styles.submit} type="submit" aria-label="Найти">
          <SearchIcon size="1.375rem" />
        </button>
      )}
    </form>
  )
}
