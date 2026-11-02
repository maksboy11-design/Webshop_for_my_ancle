/**
 * Оркестрация E2EE-буфера: ключи устройства, vault, копирование/вставка.
 * Открытый JSON и Vault Key никогда не уходят на сервер.
 */
import {
  decryptPayload,
  encryptPayload,
  exportRawKey,
  generateRecoveryKey,
  generateVaultKey,
  importVaultKey,
  openVaultFromDevice,
  sealVaultForDevice,
  unwrapVaultWithRecovery,
  wrapVaultWithRecovery,
  b64,
} from './crypto'
import { clipboardApi, userIdFromInitData } from './clipboardApi'
import {
  clearLocalDevice,
  createLocalKeyPair,
  getPrivateKey,
  getVaultKey,
  loadLocalDevice,
  saveLocalDevice,
  setVaultRaw,
  type LocalDeviceMaterial,
} from './deviceKeys'
import type { ClipboardEntryRow, ClipboardPayload } from './types'

export type ClipboardStatus =
  | { state: 'loading' }
  | { state: 'need_setup' }
  | { state: 'pending_approval'; deviceId: string }
  | { state: 'need_recovery' }
  | { state: 'ready'; deviceId: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; reason: string }

const deviceName = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Mobile|Android|iPhone/i.test(ua)) return 'Телефон'
  if (/iPad|Tablet/i.test(ua)) return 'Планшет'
  return 'Компьютер'
}

export class SecureClipboardService {
  private api: ReturnType<typeof clipboardApi>
  private userId: string
  private local: LocalDeviceMaterial | null = null
  private vault: CryptoKey | null = null
  private _status: ClipboardStatus = { state: 'loading' }
  private listeners = new Set<(s: ClipboardStatus) => void>()
  /** Локальная очередь при офлайне: уже зашифрованные тела. */
  private outbox: Record<string, unknown>[] = []

  constructor(initData: string) {
    this.api = clipboardApi(initData)
    const uid = userIdFromInitData(initData)
    if (!uid) throw new Error('clipboard_no_user')
    this.userId = uid
  }

  getStatus() {
    return this._status
  }
  onStatus(fn: (s: ClipboardStatus) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private setStatus(s: ClipboardStatus) {
    this._status = s
    for (const fn of this.listeners) fn(s)
  }

  async init(): Promise<ClipboardStatus> {
    this.setStatus({ state: 'loading' })
    try {
      this.local = await loadLocalDevice()
      let vaultMeta: Awaited<ReturnType<typeof this.api.getVault>>['vault'] | null = null
      try {
        vaultMeta = (await this.api.getVault()).vault
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'not_found') vaultMeta = null
        else if (code === 'clipboard_unavailable') {
          this.setStatus({ state: 'unavailable', reason: 'clipboard_unavailable' })
          return this._status
        } else throw e
      }

      if (!vaultMeta) {
        this.setStatus({ state: 'need_setup' })
        return this._status
      }

      if (this.local?.vaultRawB64) {
        this.vault = await getVaultKey(this.local)
        if (this.vault) {
          this.setStatus({ state: 'ready', deviceId: this.local.deviceId })
          void this.flushOutbox()
          void this.pullPendingApprovals()
          return this._status
        }
      }

      if (this.local) {
        try {
          const { device } = await this.api.getDevice(this.local.deviceId)
          if (device.status === 'revoked') {
            await clearLocalDevice()
            this.local = null
            this.setStatus({ state: 'need_recovery' })
            return this._status
          }
          if (device.status === 'pending') {
            this.setStatus({ state: 'pending_approval', deviceId: this.local.deviceId })
            return this._status
          }
          if (device.status === 'trusted' && device.wrappedVaultKey && device.wrapIv && device.wrapEphPub) {
            const priv = await getPrivateKey(this.local)
            const raw = await openVaultFromDevice(priv, device.wrapEphPub, device.wrapIv, device.wrappedVaultKey)
            this.local = await setVaultRaw(this.local, await importVaultKey(raw))
            this.vault = await getVaultKey(this.local)
            this.setStatus({ state: 'ready', deviceId: this.local.deviceId })
            void this.flushOutbox()
            return this._status
          }
        } catch {
          /* устройство ещё не на сервере */
        }
      }

      // Новое устройство при существующем vault — регистрируем как pending.
      const keys = await createLocalKeyPair()
      const id = crypto.randomUUID()
      this.local = { deviceId: id, publicJwk: keys.publicJwk, privateJwk: keys.privateJwk, vaultRawB64: null }
      await saveLocalDevice(this.local)
      await this.api.registerDevice({ id, publicKey: keys.publicJwk, deviceName: deviceName() })
      this.setStatus({ state: 'pending_approval', deviceId: id })
      return this._status
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'error'
      this.setStatus({ state: 'error', reason: code })
      return this._status
    }
  }

  /** Первая настройка: Vault Key + recovery + первое доверенное устройство. */
  async setup(): Promise<{ recoveryKeyB64: string }> {
    const vault = await generateVaultKey()
    const vaultRaw = await exportRawKey(vault)
    const recovery = await generateRecoveryKey()
    const wrapped = await wrapVaultWithRecovery(recovery, vaultRaw)
    await this.api.upsertVault({ recoveryEnabled: true, recoveryEnvelope: wrapped.envelope, recoveryIv: wrapped.iv })
    const keys = await createLocalKeyPair()
    const seal = await sealVaultForDevice(keys.publicJwk, vaultRaw)
    const id = crypto.randomUUID()
    this.local = {
      deviceId: id,
      publicJwk: keys.publicJwk,
      privateJwk: keys.privateJwk,
      vaultRawB64: b64(vaultRaw),
    }
    await saveLocalDevice(this.local)
    this.vault = vault
    await this.api.registerDevice({
      id,
      publicKey: keys.publicJwk,
      deviceName: deviceName(),
      trusted: true,
      wrappedVaultKey: seal.wrapped,
      wrapIv: seal.iv,
      wrapEphPub: seal.ephPub,
    })
    this.setStatus({ state: 'ready', deviceId: id })
    return { recoveryKeyB64: b64(recovery) }
  }

  async recover(recoveryKeyB64: string): Promise<void> {
    const { vault } = await this.api.getVault()
    const env = (vault as { recoveryEnvelope?: string | null; recoveryIv?: string | null }).recoveryEnvelope
    const iv = (vault as { recoveryIv?: string | null }).recoveryIv
    if (!env || !iv) throw new Error('recovery_unavailable')
    const { unb64 } = await import('./crypto')
    const raw = await unwrapVaultWithRecovery(unb64(recoveryKeyB64), iv, env)
    const vaultKey = await importVaultKey(raw)
    const keys = await createLocalKeyPair()
    const seal = await sealVaultForDevice(keys.publicJwk, raw)
    const id = crypto.randomUUID()
    this.local = { deviceId: id, publicJwk: keys.publicJwk, privateJwk: keys.privateJwk, vaultRawB64: b64(raw) }
    await saveLocalDevice(this.local)
    this.vault = vaultKey
    await this.api.registerDevice({
      id,
      publicKey: keys.publicJwk,
      deviceName: deviceName(),
      trusted: true,
      wrappedVaultKey: seal.wrapped,
      wrapIv: seal.iv,
      wrapEphPub: seal.ephPub,
    })
    this.setStatus({ state: 'ready', deviceId: id })
  }

  async listPendingDevices() {
    return (await this.api.listDevices(true)).devices
  }

  async approveDevice(deviceId: string) {
    if (!this.vault || !this.local?.vaultRawB64) throw new Error('no_vault')
    const { device } = await this.api.getDevice(deviceId)
    const { unb64 } = await import('./crypto')
    const seal = await sealVaultForDevice(device.publicKey, unb64(this.local.vaultRawB64))
    await this.api.approveDevice(deviceId, { wrappedVaultKey: seal.wrapped, wrapIv: seal.iv, wrapEphPub: seal.ephPub })
  }

  async revokeDevice(deviceId: string) {
    await this.api.revokeDevice(deviceId)
  }

  private async pullPendingApprovals() {
    if (this._status.state !== 'ready') return
    // На готовом устройстве можно подтверждать pending с других.
  }

  async copy(payload: ClipboardPayload): Promise<ClipboardEntryRow> {
    if (!this.vault) throw new Error('no_vault')
    const id = crypto.randomUUID()
    const blob = await encryptPayload(this.vault, this.userId, id, payload)
    const body = { id, ...blob }
    try {
      const { entry } = await this.api.createEntry(body)
      return entry
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (code === 'unavailable' || code === 'clipboard_unavailable' || !navigator.onLine) {
        this.outbox.push(body)
        return {
          id,
          ciphertext: blob.ciphertext,
          encryptedDek: blob.encryptedDek,
          iv: blob.iv,
          dekIv: blob.dekIv,
          formatVersion: blob.formatVersion,
          pinned: false,
          byteSize: blob.byteSize,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
      throw e
    }
  }

  private async flushOutbox() {
    while (this.outbox.length) {
      const body = this.outbox[0]!
      try {
        await this.api.createEntry(body)
        this.outbox.shift()
      } catch {
        break
      }
    }
  }

  async list(offset = 0, limit = 20) {
    return this.api.listEntries(offset, limit)
  }

  async decrypt(entry: ClipboardEntryRow): Promise<ClipboardPayload> {
    if (!this.vault) throw new Error('no_vault')
    return decryptPayload(this.vault, this.userId, entry)
  }

  async pin(id: string, pinned: boolean) {
    return (await this.api.setPinned(id, pinned)).entry
  }

  async remove(id: string) {
    await this.api.deleteEntry(id)
  }

  async clear(unpinnedOnly = false) {
    await this.api.clear(unpinnedOnly)
  }

  hasVault() {
    return !!this.vault
  }
}
