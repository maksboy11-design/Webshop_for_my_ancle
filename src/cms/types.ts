import type { Product } from '../data/products'

export interface Category {
  id: string
  title: string
  description: string
}

export interface ReviewMedia {
  type: 'image' | 'video'
  /** Относительный путь с того же сайта. Внешние адреса не принимаются. */
  src: string
  poster: string | null
  alt: string | null
}

export interface Review {
  id: string
  productId: string
  author: string | null
  text: string | null
  /** Нет поля, если у отзыва нет сохранённых файлов. */
  media?: readonly ReviewMedia[]
}

export interface Video {
  id: string
  title: string
  productId: string | null
  duration: string | null
  src: string | null
}

export interface Webinar {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string | null
  speaker: string | null
  /** youtube — встраивание youtube-nocookie; hosted — разрешённый файл в Vercel Blob. */
  sourceType: 'youtube' | 'hosted'
  youtubeVideoId: string | null
  startSeconds: number | null
  recordingSrc: string | null
}

export interface DocumentItem {
  id: string
  title: string
  file: string | null
}

export interface PageBlock {
  id: string
  eyebrow?: string
  title: string
  description?: string
}

export interface ContactChannel {
  id: 'telegram' | 'max' | 'phone' | 'address'
  label: string
  url: string | null
}

export interface CmsClient {
  listProducts(): Promise<readonly Product[]>
  getProduct(slug: string): Promise<Product | null>
  listReviews(query?: { productId?: string }): Promise<readonly Review[]>
  listVideos(): Promise<readonly Video[]>
  listWebinars(): Promise<readonly Webinar[]>
  listDocuments(): Promise<readonly DocumentItem[]>
  getPage(id: string): Promise<PageBlock | null>
  listContacts(): Promise<readonly ContactChannel[]>
}
