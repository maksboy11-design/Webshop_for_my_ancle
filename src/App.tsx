import { Header } from './components/Header/Header'
import { Hero } from './components/Hero/Hero'
import styles from './App.module.css'

export default function App() {
  return (
    <div className={styles.page} id="top">
      <Header />
      <main className={styles.main}>
        <Hero />
      </main>
    </div>
  )
}
