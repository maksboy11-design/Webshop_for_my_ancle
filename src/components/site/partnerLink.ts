import { pageHref } from '../../cms/pageDoc'
import { PARTNER_PAGE_SLUG } from '../../config/routes'
import { usePublicPage } from '../pages/publicPage'

/**
 * Пункт меню «Как стать партнёром…»: появляется только когда страница с slug PARTNER_PAGE_SLUG
 * опубликована в разделе «Страницы» мини-приложения (черновик наружу не отдаётся).
 */
export function usePartnerLink(): { label: string; href: string } | null {
  const s = usePublicPage(PARTNER_PAGE_SLUG)
  return s.state === 'ready' ? { label: s.page.title, href: pageHref(s.page.slug) } : null
}
