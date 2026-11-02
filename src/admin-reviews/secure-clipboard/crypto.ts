/**
 * E2EE ядро защищённого буфера: AES-256-GCM, ECDH P-256 + HKDF, Web Crypto.
 * Сервер никогда не получает открытый Vault Key / DEK / JSON.
 */
import type { ClipboardPayload, EncryptedBlob } from './types'
import { CLIPBOARD_CIPHER_MAX, CLIPBOARD_FORMAT } from './types'

const te = new TextEncoder()
const td = new TextDecoder()

export const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
/** Node/DOM typings: Uint8Array<ArrayBufferLike> ≠ BufferSource — копируем в свежий ArrayBuffer. */
const asBuf = (u: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(u.byteLength)
  out.set(u)
  return out
}

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'])
}

export async function exportRawKey(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return asBuf(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export async function importVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
    'wrapKey',
    'unwrapKey',
  ])
}

export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
}

export async function exportPublicKeyJwk(pub: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pub))
}

export async function importPublicKeyJwk(jwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', JSON.parse(jwk) as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

export async function exportPrivateKeyJwk(priv: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', priv))
}

export async function importPrivateKeyJwk(jwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', JSON.parse(jwk) as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
}

async function hkdfAesKey(bits: ArrayBuffer, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: asBuf(new Uint8Array(32)), info: asBuf(te.encode(info)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Упаковать Vault Key для устройства (ECDH ephemeral + HKDF + AES-GCM). */
export async function sealVaultForDevice(
  devicePublicJwk: string,
  vaultRaw: Uint8Array,
): Promise<{ ephPub: string; iv: string; wrapped: string }> {
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const peer = await importPublicKeyJwk(devicePublicJwk)
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256)
  const key = await hkdfAesKey(bits, 'silkway-clipboard-vault-wrap-v1')
  const iv = asBuf(random(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, asBuf(vaultRaw))
  return { ephPub: await exportPublicKeyJwk(eph.publicKey), iv: b64(iv), wrapped: b64(new Uint8Array(ct)) }
}

export async function openVaultFromDevice(
  devicePrivate: CryptoKey,
  ephPubJwk: string,
  ivB64: string,
  wrappedB64: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const eph = await importPublicKeyJwk(ephPubJwk)
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, devicePrivate, 256)
  const key = await hkdfAesKey(bits, 'silkway-clipboard-vault-wrap-v1')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(wrappedB64))
  return asBuf(new Uint8Array(pt))
}

export async function generateRecoveryKey(): Promise<Uint8Array<ArrayBuffer>> {
  return asBuf(random(32))
}

export async function wrapVaultWithRecovery(recovery: Uint8Array, vaultRaw: Uint8Array): Promise<{ iv: string; envelope: string }> {
  const key = await crypto.subtle.importKey('raw', asBuf(recovery), { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const iv = asBuf(random(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, asBuf(vaultRaw))
  return { iv: b64(iv), envelope: b64(new Uint8Array(ct)) }
}

export async function unwrapVaultWithRecovery(recovery: Uint8Array, ivB64: string, envelopeB64: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', asBuf(recovery), { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(envelopeB64))
  return asBuf(new Uint8Array(pt))
}

/** AAD: userId | entryId | formatVersion — подмена контекста ломает расшифровку. */
export function aadBytes(userId: string, entryId: string, formatVersion: number): Uint8Array<ArrayBuffer> {
  return asBuf(te.encode(`silkway-cb|${userId}|${entryId}|${formatVersion}`))
}

export async function encryptPayload(
  vault: CryptoKey,
  userId: string,
  entryId: string,
  payload: ClipboardPayload,
): Promise<EncryptedBlob> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = asBuf(random(12))
  const aad = aadBytes(userId, entryId, CLIPBOARD_FORMAT)
  const plaintext = asBuf(te.encode(JSON.stringify(payload)))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, dek, plaintext)
  const dekRaw = await exportRawKey(dek)
  const dekIv = asBuf(random(12))
  const encryptedDek = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv }, vault, asBuf(dekRaw))
  const byteSize = ciphertext.byteLength + encryptedDek.byteLength
  if (byteSize > CLIPBOARD_CIPHER_MAX) throw new Error('clipboard_too_large')
  return {
    ciphertext: b64(new Uint8Array(ciphertext)),
    encryptedDek: b64(new Uint8Array(encryptedDek)),
    iv: b64(iv),
    dekIv: b64(dekIv),
    formatVersion: CLIPBOARD_FORMAT,
    byteSize,
  }
}

export async function decryptPayload(
  vault: CryptoKey,
  userId: string,
  entry: {
    id: string
    ciphertext: string
    encryptedDek: string
    iv: string
    dekIv: string
    formatVersion: number
  },
): Promise<ClipboardPayload> {
  const dekRaw = asBuf(new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(entry.dekIv) },
    vault,
    unb64(entry.encryptedDek),
  )))
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const aad = aadBytes(userId, entry.id, entry.formatVersion)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(entry.iv), additionalData: aad },
    dek,
    unb64(entry.ciphertext),
  )
  const data = JSON.parse(td.decode(pt)) as ClipboardPayload
  if (!data || data.v !== CLIPBOARD_FORMAT || typeof data.kind !== 'string') throw new Error('clipboard_bad_payload')
  return data
}
