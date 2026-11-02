import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aadBytes,
  b64,
  decryptPayload,
  encryptPayload,
  exportPublicKeyJwk,
  exportRawKey,
  generateDeviceKeyPair,
  generateRecoveryKey,
  generateVaultKey,
  openVaultFromDevice,
  sealVaultForDevice,
  unwrapVaultWithRecovery,
  wrapVaultWithRecovery,
} from '../src/admin-reviews/secure-clipboard/crypto'
import {
  canPasteTo,
  extractButtonFields,
  payloadFromPageBlock,
  remintPageBlock,
  remintProductBlock,
} from '../src/admin-reviews/secure-clipboard/serialize'
import type { ButtonBlock } from '../src/cms/pageDoc'
import { EXTRA_TYPES } from '../src/cms/richBlocks'
import type { ClipboardPayload } from '../src/admin-reviews/secure-clipboard/types'

describe('clipboard crypto E2EE', () => {
  it('AES-GCM roundtrip + AAD привязка', async () => {
    const vault = await generateVaultKey()
    const payload: ClipboardPayload = {
      v: 1,
      scope: 'page',
      kind: 'button',
      label: 'Кнопка',
      copiedAt: new Date().toISOString(),
      block: { type: 'button', text: 'Купить' },
    }
    const entryId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const userId = '7'
    const sealed = await encryptPayload(vault, userId, entryId, payload)
    assert.ok(sealed.ciphertext.length > 8)
    assert.ok(!sealed.ciphertext.includes('Купить'))
    const open = await decryptPayload(vault, userId, { id: entryId, ...sealed })
    assert.deepEqual(open, payload)
    await assert.rejects(() => decryptPayload(vault, '8', { id: entryId, ...sealed }))
  })

  it('recovery wrap/unwrap vault', async () => {
    const vault = await generateVaultKey()
    const raw = await exportRawKey(vault)
    const recovery = await generateRecoveryKey()
    const wrapped = await wrapVaultWithRecovery(recovery, raw)
    const opened = await unwrapVaultWithRecovery(recovery, wrapped.iv, wrapped.envelope)
    assert.equal(b64(raw), b64(opened))
  })

  it('ECDH device seal/open', async () => {
    const vault = await generateVaultKey()
    const raw = await exportRawKey(vault)
    const pair = await generateDeviceKeyPair()
    const pub = await exportPublicKeyJwk(pair.publicKey)
    const sealed = await sealVaultForDevice(pub, raw)
    const opened = await openVaultFromDevice(pair.privateKey, sealed.ephPub, sealed.iv, sealed.wrapped)
    assert.equal(b64(raw), b64(opened))
  })

  it('aadBytes стабилен', () => {
    const a = aadBytes('1', 'x', 1)
    const b = aadBytes('1', 'x', 1)
    assert.deepEqual([...a], [...b])
  })
})

describe('clipboard serialize / remint', () => {
  it('page button → product button и обратно', () => {
    const pageBtn: ButtonBlock = {
      id: 'b1',
      type: 'button',
      width: 'normal',
      align: 'center',
      text: 'Подробнее',
      variant: 'primary',
      target: { kind: 'page', pageId: '11111111-1111-4111-8111-111111111111' },
    }
    const payload = payloadFromPageBlock(pageBtn, { pageId: 'p', pageTitle: 'Стр' })
    assert.equal(canPasteTo('product', payload), true)
    const prod = remintProductBlock(payload.block)
    assert.ok(prod)
    assert.equal(prod!.type, 'button')
    assert.equal((prod!.content as { text: string }).text, 'Подробнее')
    assert.notEqual(prod!.id, pageBtn.id)

    const back = remintPageBlock(prod)
    assert.ok(back && back.type === 'button')
    if (back.type === 'button') assert.equal(back.text, 'Подробнее')
    assert.notEqual(back.id, prod!.id)
  })

  it('extractButtonFields из content', () => {
    const f = extractButtonFields({
      type: 'button',
      content: { text: 'OK', variant: 'soft', align: 'right', target: { kind: 'none' } },
    })
    assert.equal(f?.text, 'OK')
    assert.equal(f?.variant, 'soft')
  })

  it('button в EXTRA_TYPES', () => {
    assert.ok((EXTRA_TYPES as readonly string[]).includes('button'))
  })
})
