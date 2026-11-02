/** HTTP-клиент защищённого буфера: /api/admin/pages?clipboard=1 (без новой функции). */
import { adminRequest } from '../adminHttp'
import type { ClipboardDeviceRow, ClipboardEntryRow, VaultMeta } from './types'

const U = '/api/admin/pages?clipboard=1'

export const clipboardApi = (initData: string) => ({
  getVault: () => adminRequest<{ vault: VaultMeta & { recoveryEnvelope?: string | null; recoveryIv?: string | null } }>(initData, `${U}&vault=1`),
  upsertVault: (body: {
    recoveryEnabled: boolean
    recoveryEnvelope?: string | null
    recoveryIv?: string | null
  }) => adminRequest<{ vault: VaultMeta }>(initData, `${U}&vault=1`, { method: 'POST', json: body }),

  listDevices: (pending = false) =>
    adminRequest<{ devices: ClipboardDeviceRow[] }>(initData, `${U}&devices=1${pending ? '&pending=1' : ''}`),
  getDevice: (id: string) => adminRequest<{ device: ClipboardDeviceRow }>(initData, `${U}&devices=1&id=${id}`),
  registerDevice: (body: Record<string, unknown>) =>
    adminRequest<{ device: ClipboardDeviceRow }>(initData, `${U}&devices=1`, { method: 'POST', json: body }),
  approveDevice: (id: string, wrap: { wrappedVaultKey: string; wrapIv: string; wrapEphPub: string }) =>
    adminRequest<{ device: ClipboardDeviceRow }>(initData, `${U}&devices=1&approve=${id}`, { method: 'POST', json: wrap }),
  revokeDevice: (id: string) => adminRequest<{ ok: true }>(initData, `${U}&devices=1&id=${id}`, { method: 'DELETE' }),
  touchDevice: (id: string) => adminRequest<{ ok: true }>(initData, `${U}&devices=1&id=${id}`, { method: 'PUT', json: {} }),

  listEntries: (offset = 0, limit = 20) =>
    adminRequest<{ items: ClipboardEntryRow[]; total: number; offset: number; limit: number }>(
      initData,
      `${U}&offset=${offset}&limit=${limit}`,
    ),
  getEntry: (id: string) => adminRequest<{ entry: ClipboardEntryRow }>(initData, `${U}&id=${id}`),
  createEntry: (body: Record<string, unknown>) =>
    adminRequest<{ entry: ClipboardEntryRow }>(initData, U, { method: 'POST', json: body }),
  setPinned: (id: string, pinned: boolean) =>
    adminRequest<{ entry: ClipboardEntryRow }>(initData, `${U}&id=${id}`, { method: 'PUT', json: { pinned } }),
  deleteEntry: (id: string) => adminRequest<{ ok: true }>(initData, `${U}&id=${id}`, { method: 'DELETE' }),
  clear: (unpinnedOnly = false) =>
    adminRequest<{ deleted: number }>(initData, `${U}&clear=1${unpinnedOnly ? '&unpinned=1' : ''}`, { method: 'DELETE' }),
})

/** userId из подписанного initData — только для AAD на устройстве, не для авторизации. */
export function userIdFromInitData(initData: string): string | null {
  try {
    const raw = new URLSearchParams(initData).get('user')
    if (!raw) return null
    const u = JSON.parse(raw) as { id?: unknown }
    if (typeof u.id === 'number' || typeof u.id === 'string') return String(u.id)
  } catch {
    /* ignore */
  }
  return null
}
