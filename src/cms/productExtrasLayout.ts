import type { PublicExtraBlock } from './richBlocks'

export type PublicExtraButton = Extract<PublicExtraBlock, { type: 'button' }>

export function isExtraButton(b: PublicExtraBlock): b is PublicExtraButton {
  return b.type === 'button'
}

/** Кнопки под ценой; остальные extras — ниже описания. */
export function partitionExtraBlocks(blocks: readonly PublicExtraBlock[]): {
  buttons: PublicExtraButton[]
  rest: PublicExtraBlock[]
} {
  const buttons: PublicExtraButton[] = []
  const rest: PublicExtraBlock[] = []
  for (const b of blocks) {
    if (isExtraButton(b)) buttons.push(b)
    else rest.push(b)
  }
  return { buttons, rest }
}
