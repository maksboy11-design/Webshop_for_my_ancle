/** Типы защищённого буфера. Открытые поля только на устройстве после расшифровки. */

export const CLIPBOARD_FORMAT = 1
export const CLIPBOARD_ENTRIES_MAX = 50
export const CLIPBOARD_TTL_DAYS = 30
export const CLIPBOARD_CIPHER_MAX = 180_000

export type ClipboardScope = 'page' | 'product'

/** Полезная нагрузка одной записи (шифруется целиком). */
export interface ClipboardPayload {
  v: typeof CLIPBOARD_FORMAT
  scope: ClipboardScope
  /** Тип для превью/поиска после расшифровки. */
  kind: string
  label: string
  source?: { pageId?: string; pageTitle?: string; productId?: string; productName?: string }
  copiedAt: string
  /** Полный блок страницы или дополнительный блок товара. */
  block: unknown
}

export interface EncryptedBlob {
  ciphertext: string
  encryptedDek: string
  iv: string
  dekIv: string
  formatVersion: number
  byteSize: number
}

export interface ClipboardEntryRow {
  id: string
  ciphertext: string
  encryptedDek: string
  iv: string
  dekIv: string
  formatVersion: number
  pinned: boolean
  byteSize: number
  createdAt: string
  updatedAt: string
}

export interface ClipboardDeviceRow {
  id: string
  publicKey: string
  wrappedVaultKey: string | null
  wrapIv: string | null
  wrapEphPub: string | null
  deviceName: string
  status: 'pending' | 'trusted' | 'revoked'
  createdAt: string
  lastSeenAt: string
}

export interface VaultMeta {
  vaultVersion: number
  keyEnvelopeVersion: number
  recoveryEnabled: boolean
  createdAt: string
}
