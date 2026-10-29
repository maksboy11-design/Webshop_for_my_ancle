import { useEffect, useId, useRef } from 'react'
import { catalogHref, type RouteState } from '../config/hashRoute'
import { BRAND_LABELS, CATEGORY_LABELS, COPY, FORM_LABELS } from '../content/copy'
import { type Product } from '../data/products'
import { useProducts } from '../cms/liveProducts'
import { ProductCard } from '../components/site/ProductCard'
import { Chip } from '../components/site/ui'
import { Card } from '../ui/Card'
import { Sheet } from '../ui/motion'
import styles from '../components/site/site.module.css'

const CATEGORIES = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]
const PAGE_SIZE = 8

function match(product: Product, params: URLSearchParams) {
  const category = params.get('category')
  const brand = params.get('brand')
  const form = params.get('form')
  const q = (params.get('q') ?? '').trim().toLowerCase()
  if (category && category !== 'all' && product.category !== category) return false
  if (brand && product.brandId !== brand) return false
  if (form && product.form !== form) return false
  if (q && !`${product.name} ${BRAND_LABELS[product.brandId]}`.toLowerCase().includes(q)) return false
  return true
}

function FilterFields({ params }: { params: URLSearchParams }) {
  const category = params.get('category') ?? 'all'
  const brand = params.get('brand') ?? ''
  const form = params.get('form') ?? ''
  return (
    <>
      <fieldset className={styles.filterGroup}>
        <legend>Категория</legend>
        {CATEGORIES.filter((key) => key !== 'all').map((key) => (
          <label key={key} className={styles.check}>
            <input
              type="checkbox"
              checked={category === key}
              onChange={() => {
                window.location.hash = catalogHref({ category: category === key ? null : key }, params)
              }}
            />
            <span>{CATEGORY_LABELS[key]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.filterGroup}>
        <legend>Бренд</legend>
        {Object.entries(BRAND_LABELS).map(([id, label]) => (
          <label key={id} className={styles.check}>
            <input
              type="checkbox"
              checked={brand === id}
              onChange={() => {
                window.location.hash = catalogHref({ brand: brand === id ? null : id }, params)
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.filterGroup}>
        <legend>Форма</legend>
        {Object.entries(FORM_LABELS).map(([id, label]) => (
          <label key={id} className={styles.check}>
            <input
              type="checkbox"
              checked={form === id}
              onChange={() => {
                window.location.hash = catalogHref({ form: form === id ? null : id }, params)
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </>
  )
}

export function CatalogPage({ route }: { route: RouteState }) {
  const params = route.params
  const sort = params.get('sort') === 'name' ? 'name' : 'default'
  const shown = Number(params.get('more') ?? PAGE_SIZE)
  const products = useProducts()
  const filtered = products.filter((item) => match(item, params))
  const items = [...filtered].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ru') : 0))
  const visible = items.slice(0, shown)
  const sheetRef = useRef<HTMLDivElement>(null)
  const filtersOpen = params.get('filters') === 'open'
  const titleId = useId()

  useEffect(() => {
    if (!filtersOpen) return
    const root = sheetRef.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const nodes = () => [...root.querySelectorAll<HTMLElement>('button, a, input, select')]
    nodes()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.location.hash = catalogHref({ filters: null }, params)
        return
      }
      if (event.key !== 'Tab') return
      const list = nodes()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [filtersOpen, params])

  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <p className={styles.crumbs}>Главная / Каталог</p>
        <h1 className={styles.h1} id={titleId}>
          Каталог
        </h1>
        <p className={styles.lead}>Приборы для здоровья, БАДы и средства ухода</p>
      </header>
      <div className={`${styles.chipRow} ${styles.catalogChips}`}>
        {CATEGORIES.map((key) => (
          <Chip
            key={key}
            pressed={(params.get('category') ?? 'all') === key}
            href={catalogHref({ category: key === 'all' ? null : key }, params)}
          >
            {CATEGORY_LABELS[key]}
          </Chip>
        ))}
      </div>
      <div className={styles.toolbar}>
        <button
          className={`${styles.btn} ${styles.secondary} ${styles.mobileOnly}`}
          type="button"
          onClick={() => {
            window.location.hash = catalogHref({ filters: 'open' }, params)
          }}
        >
          Фильтры
        </button>
        <label className={styles.field} style={{ maxWidth: '16rem' }}>
          Сортировка
          <select
            className={styles.select}
            value={sort}
            aria-label="Сортировка"
            onChange={(event) => {
              window.location.hash = catalogHref(
                { sort: event.target.value === 'name' ? 'name' : null },
                params,
              )
            }}
          >
            <option value="default">По умолчанию</option>
            <option value="name">По названию</option>
          </select>
        </label>
      </div>
      <div className={styles.catalog}>
        <aside className={styles.filters} aria-label="Фильтры">
          <FilterFields params={params} />
          <a className={`${styles.btn} ${styles.secondary}`} href="#catalog">
            {COPY.resetFilters}
          </a>
        </aside>
        <div>
          {visible.length === 0 ? (
            <Card
              variant="fact"
              title={COPY.emptyCatalog}
              footer={
                <a className={`${styles.btn} ${styles.primary}`} href="#catalog">
                  {COPY.resetFilters}
                </a>
              }
            />
          ) : (
            <div className={`${styles.grid} ${styles.gridCards}`}>
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
          {visible.length < items.length && (
            <div className={styles.center}>
              <button
                className={`${styles.btn} ${styles.secondary}`}
                type="button"
                onClick={() => {
                  window.location.hash = catalogHref({ more: String(shown + PAGE_SIZE) }, params)
                }}
              >
                Показать ещё
              </button>
            </div>
          )}
        </div>
      </div>
      {filtersOpen && (
        <Sheet
          open
          titleId={titleId}
          onClose={() => {
            window.location.hash = catalogHref({ filters: null }, params)
          }}
        >
          <div ref={sheetRef}>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              type="button"
              onClick={() => {
                window.location.hash = catalogHref({ filters: null }, params)
              }}
            >
              Закрыть
            </button>
            <FilterFields params={params} />
          </div>
        </Sheet>
      )}
    </div>
  )
}
