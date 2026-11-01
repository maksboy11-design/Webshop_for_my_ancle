import { adminRequest } from '../adminHttp'
import type { PageDoc } from '../../cms/pageDoc'

export interface PageSummary {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  changed: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}
export interface PageView {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  doc: PageDoc
  rev: number
  hasPublished: boolean
  changed: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}
export type LinkInfo = { slug: string; title: string; status: 'draft' | 'published'; deleted: boolean }
export type PageRef = { id: string; title: string; slug: string; status: string }
export interface PageVersion {
  rev: number
  reason: string
  title: string
  restoredFromRev: number | null
  createdAt: string
}
export type LinkWarning = { blockId: string; pageId: string; problem: 'unpublished' | 'deleted' | 'missing' }

const U = '/api/admin/pages'
export const pagesApi = (initData: string) => ({
  list: (p: { q: string; status: string; trash: boolean; offset: number; limit: number }, signal?: AbortSignal) =>
    adminRequest<{ items: PageSummary[]; total: number }>(
      initData,
      `${U}?list=1&q=${encodeURIComponent(p.q)}&status=${p.status}&offset=${p.offset}&limit=${p.limit}${p.trash ? '&trash=1' : ''}`,
      { signal },
    ),
  get: (id: string, signal?: AbortSignal) =>
    adminRequest<{ page: PageView; links: Record<string, LinkInfo>; referencedBy: PageRef[] }>(initData, `${U}?id=${id}`, { signal }),
  create: (title: string) => adminRequest<{ page: PageView }>(initData, `${U}?create=1`, { method: 'POST', json: { title } }),
  duplicate: (id: string) => adminRequest<{ page: PageView }>(initData, `${U}?duplicate=${id}`, { method: 'POST', json: {} }),
  save: (id: string, body: { title: string; slug: string; doc: PageDoc; rev: number; version: boolean }) =>
    adminRequest<{ page: PageView }>(initData, `${U}?id=${id}`, { method: 'PUT', json: body }),
  publish: (id: string) =>
    adminRequest<{ page: PageView; warnings: LinkWarning[] }>(initData, `${U}?publish=${id}`, { method: 'POST', json: {} }),
  unpublish: (id: string) =>
    adminRequest<{ page: PageView; referencedBy: PageRef[] }>(initData, `${U}?unpublish=${id}`, { method: 'POST', json: {} }),
  trash: (id: string, force: boolean) =>
    adminRequest<{ page: PageView }>(initData, `${U}?id=${id}${force ? '&force=1' : ''}`, { method: 'DELETE' }),
  restore: (id: string) => adminRequest<{ page: PageView }>(initData, `${U}?restore=${id}`, { method: 'POST', json: {} }),
  versions: (id: string) => adminRequest<{ versions: PageVersion[] }>(initData, `${U}?versions=${id}`),
  restoreVersion: (id: string, rev: number) =>
    adminRequest<{ page: PageView }>(initData, `${U}?restoreVersion=${id}&rev=${rev}`, { method: 'POST', json: {} }),
})
