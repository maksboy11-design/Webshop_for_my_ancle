import { useEffect } from 'react'
import { ROUTES } from '../config/routes'
import { PageRenderer } from '../components/pages/PageRenderer'
import { usePublicPage } from '../components/pages/publicPage'
import { Button } from '../components/site/ui'
import site from '../components/site/site.module.css'

/** Страница из раздела «Страницы» по адресу #page/<slug>. Показывается только опубликованная версия. */
export function CmsPage({ slug }: { slug: string }) {
  const s = usePublicPage(slug)
  useEffect(() => {
    if (s.state === 'ready') document.title = `${s.page.title} — SILKWAY`
  }, [s])
  if (s.state === 'ready') return <PageRenderer title={s.page.title} doc={s.page.doc} links={s.page.links} />
  return (
    <div className={site.shell} data-testid="cms-page-status">
      <header className={site.pageHead}>
        <h1 className={site.h1}>
          {s.state === 'loading' ? 'Загрузка…' : s.state === 'missing' ? 'Страница не найдена' : 'Страница временно недоступна'}
        </h1>
      </header>
      {s.state !== 'loading' && (
        <Button href={ROUTES.home} variant="secondary">
          ← На главную
        </Button>
      )}
    </div>
  )
}
