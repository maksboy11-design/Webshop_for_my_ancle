import { CONTACTS } from '../config/contacts'
import { DOCUMENTS } from '../content/copy'
import { HERO_COPY } from '../data/hero'
import { PRODUCTS, productBySlug } from '../data/products'
import type { CmsClient, PageBlock } from './types'

const pages: Record<string, PageBlock> = {
  hero: {
    id: 'hero',
    eyebrow: HERO_COPY.eyebrow,
    title: HERO_COPY.title,
    description: HERO_COPY.description,
  },
  about: {
    id: 'about',
    title: 'О бренде HALOS',
    description: 'Вода, природа и забота о себе',
  },
}

/** Читает текущие модули проекта. Позже этот же контракт может читать headless CMS. */
export const staticCms = {
  listProducts: () => PRODUCTS,
  getProduct: (slug: string) => productBySlug(slug),
  listReviews: () => [] as const,
  listVideos: () => [] as const,
  listWebinars: () => [] as const,
  listDocuments: () => DOCUMENTS.map((item) => ({ ...item, file: null })),
  getPage: (id: string) => pages[id] ?? null,
  listContacts: () =>
    [
      { id: 'telegram' as const, label: 'Telegram', url: CONTACTS.telegram },
      { id: 'max' as const, label: 'MAX', url: CONTACTS.max },
      { id: 'phone' as const, label: 'Телефон', url: CONTACTS.phone },
      { id: 'address' as const, label: 'Адрес', url: CONTACTS.address },
    ],
}

export const cmsClient: CmsClient = {
  listProducts: async () => staticCms.listProducts(),
  getProduct: async (slug) => staticCms.getProduct(slug),
  listReviews: async () => staticCms.listReviews(),
  listVideos: async () => staticCms.listVideos(),
  listWebinars: async () => staticCms.listWebinars(),
  listDocuments: async () => staticCms.listDocuments(),
  getPage: async (id) => staticCms.getPage(id),
  listContacts: async () => staticCms.listContacts(),
}
