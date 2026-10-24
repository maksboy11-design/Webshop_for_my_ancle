import type { Product } from '../data/products'

export interface Category {
  id: string
  title: string
  description: string
}

export interface Review {
  id: string
  productId: string
  author: string | null
  text: string | null
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
  startsAt: string | null
  speaker: string | null
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
