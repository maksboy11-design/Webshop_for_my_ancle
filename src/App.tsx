import { lazy, Suspense, useEffect } from 'react'
import { Header } from './components/Header/Header'
import { Hero } from './components/Hero/Hero'
import { ContactSection } from './components/site/ContactSection'
import { Footer } from './components/site/Footer'
import { SiteHeader } from './components/site/SiteHeader'
import { useHashRoute } from './hooks/useHashRoute'
import styles from './App.module.css'

const HomeSections = lazy(() =>
  import('./components/site/HomeSections').then((m) => ({ default: m.HomeSections })),
)
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage })))
const ProductPage = lazy(() => import('./pages/ProductPage').then((m) => ({ default: m.ProductPage })))
const VideosPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.VideosPage })))
const WebinarsPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.WebinarsPage })))
const AboutPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.AboutPage })))
const ContactsPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.ContactsPage })))
const PrivacyPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.PrivacyPage })))

const TITLES: Record<string, string> = {
  home: 'SILKWAY — Ваше здоровье- наш приоритет',
  catalog: 'Каталог — SILKWAY',
  product: 'Товар — SILKWAY',
  videos: 'Отзывы — SILKWAY',
  webinars: 'Вебинары — SILKWAY',
  about: 'О бренде — SILKWAY',
  contacts: 'Контакты — SILKWAY',
  privacy: 'Политика конфиденциальности — SILKWAY',
}

function RouteFallback() {
  return <div className={styles.routeFallback} aria-busy="true" />
}

export default function App() {
  const route = useHashRoute()

  useEffect(() => {
    document.title = TITLES[route.page] ?? TITLES.home
  }, [route.page])

  if (route.page === 'home') {
    return (
      <div className={styles.page} id="top">
        <Header />
        <main className={`${styles.main} ${styles.homeMain}`}>
          <Hero />
          <Suspense fallback={<RouteFallback />}>
            <HomeSections />
          </Suspense>
          <ContactSection />
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={`${styles.main} ${styles.waterMain}`}>
        <Suspense fallback={<RouteFallback />}>
          {route.page === 'catalog' && <CatalogPage route={route} />}
          {route.page === 'product' && <ProductPage slug={route.slug} />}
          {route.page === 'videos' && <VideosPage />}
          {route.page === 'webinars' && <WebinarsPage />}
          {route.page === 'about' && <AboutPage />}
          {route.page === 'contacts' && <ContactsPage />}
          {route.page === 'privacy' && <PrivacyPage />}
        </Suspense>
        <ContactSection />
      </main>
      <Footer />
    </div>
  )
}
