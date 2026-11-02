import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isExtraButton, partitionExtraBlocks } from '../src/cms/productExtrasLayout'
import type { PublicExtraBlock } from '../src/cms/richBlocks'

const info: PublicExtraBlock = { id: 'i1', type: 'info', title: 't', text: 'x', tone: 'info' }
const btn: PublicExtraBlock = {
  id: 'b1',
  type: 'button',
  text: 'Купить',
  variant: 'primary',
  align: 'left',
  target: { kind: 'external', url: 'https://example.com' },
  href: 'https://example.com',
}

describe('product extra buttons under price', () => {
  it('partition отделяет кнопки от остальных extras', () => {
    const { buttons, rest } = partitionExtraBlocks([info, btn, info])
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0]!.id, 'b1')
    assert.equal(rest.length, 2)
    assert.equal(isExtraButton(btn), true)
    assert.equal(isExtraButton(info), false)
  })

  it('порядок кнопок сохраняется', () => {
    const b2 = { ...btn, id: 'b2', text: 'Ещё' }
    const { buttons } = partitionExtraBlocks([btn, info, b2])
    assert.deepEqual(buttons.map((b) => b.id), ['b1', 'b2'])
  })
})
