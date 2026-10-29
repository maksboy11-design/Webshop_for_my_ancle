import { useEffect } from 'react'
import { Header } from './components/Header/Header'
import { Hero } from './components/Hero/Hero'
import { ContactSection } from './components/site/ContactSection'
import { Footer } from './components/site/Footer'
import { HomeSections } from './components/site/HomeSections'
import { SiteHeader } from './components/site/SiteHeader'
import { useHashRoute } from './hooks/useHashRoute'
import { AboutPage, ContactsPage, PrivacyPage, VideosPage, WebinarsPage } from './pages/InfoPages'
import { CatalogPage } from './pages/CatalogPage'
import { ProductPage } from './pages/ProductPage'
import styles from './App.module.css'

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
          <HomeSections />
          <ContactSection />
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.main}>
        {route.page === 'catalog' && <CatalogPage route={route} />}
        {route.page === 'product' && <ProductPage slug={route.slug} />}
        {route.page === 'videos' && <VideosPage />}
        {route.page === 'webinars' && <WebinarsPage />}
        {route.page === 'about' && <AboutPage />}
        {route.page === 'contacts' && <ContactsPage />}
        {route.page === 'privacy' && <PrivacyPage />}
        <ContactSection />
      </main>
      <Footer />
    </div>
  )
}
