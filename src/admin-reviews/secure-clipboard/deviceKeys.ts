/** Локальные ключи устройства в IndexedDB (не localStorage). */
import {
  b64,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  exportRawKey,
  generateDeviceKeyPair,
  importPrivateKeyJwk,
  importVaultKey,
  unb64,
} from './crypto'

const DB = 'silkway-secure-clipboard'
const STORE = 'device'
const KEY = 'current'

export interface LocalDeviceMaterial {
  deviceId: string
  publicJwk: string
  privateJwk: string
  /** Сырой Vault Key (только на доверенном устройстве после setup/approve/recovery). */
  vaultRawB64: string | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb_open'))
  })
}

async function idbGet(): Promise<LocalDeviceMaterial | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(KEY)
    r.onsuccess = () => resolve((r.result as LocalDeviceMaterial | undefined) ?? null)
    r.onerror = () => reject(r.error ?? new Error('idb_get'))
  })
}

async function idbSet(v: LocalDeviceMaterial): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(v, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_set'))
  })
}

export async function loadLocalDevice(): Promise<LocalDeviceMaterial | null> {
  try {
    return await idbGet()
  } catch {
    return null
  }
}

export async function saveLocalDevice(m: LocalDeviceMaterial): Promise<void> {
  await idbSet(m)
}

export async function clearLocalDevice(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_del'))
  })
}

export async function createLocalKeyPair(): Promise<{ publicJwk: string; privateJwk: string; privateKey: CryptoKey }> {
  const pair = await generateDeviceKeyPair()
  return {
    publicJwk: await exportPublicKeyJwk(pair.publicKey),
    privateJwk: await exportPrivateKeyJwk(pair.privateKey),
    privateKey: pair.privateKey,
  }
}

export async function getPrivateKey(m: LocalDeviceMaterial): Promise<CryptoKey> {
  return importPrivateKeyJwk(m.privateJwk)
}

export async function getVaultKey(m: LocalDeviceMaterial): Promise<CryptoKey | null> {
  if (!m.vaultRawB64) return null
  return importVaultKey(unb64(m.vaultRawB64))
}

export async function setVaultRaw(m: LocalDeviceMaterial, vault: CryptoKey): Promise<LocalDeviceMaterial> {
  const next = { ...m, vaultRawB64: b64(await exportRawKey(vault)) }
  await saveLocalDevice(next)
  return next
}
