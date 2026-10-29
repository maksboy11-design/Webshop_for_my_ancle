import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parsePublishedReviews } from '../../src/cms/publishedReviews'
import { implementedContentKinds } from './contentRegistry'
import { readModeratorIds, secretIsValid } from './config'

const root = join(import.meta.dirname, '..', '..')

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (/\.(ts|tsx|css|js)$/.test(entry.name)) files.push(path)
  }
  return files
}

describe('client boundary', () => {
  it('не упоминает серверные секреты в исходниках сайта', async () => {
    const files = await sourceFiles(join(root, 'src'))
    const forbidden = ['MAX_BOT_TOKEN', 'MAX_WEBHOOK_SECRET', 'DATABASE_URL', 'X-Max-Bot-Api-Secret']
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const marker of forbidden) assert.equal(source.includes(marker), false, file)
    }
  })

  it('публичный разбор отзыва отбрасывает служебные поля', () => {
    const reviews = parsePublishedReviews({
      reviews: [
        {
          id: '1',
          productId: 'flagship',
          author: null,
          text: '<script>alert(1)</script>',
          senderUserId: '7',
          moderatorUserId: '42',
        },
      ],
    })
    assert.deepEqual(reviews, [{ id: '1', productId: 'flagship', author: null, text: '<script>alert(1)</script>' }])
    assert.throws(() => parsePublishedReviews({ reviews: [{ id: 1 }] }))
    const withMedia = parsePublishedReviews({
      reviews: [
        {
          id: '2',
          productId: 'flagship',
          author: null,
          text: 'Текст',
          media: [
            { type: 'image', src: '/products/device.png', alt: 'Прибор' },
            { type: 'video', src: '/clips/a.mp4', poster: '/products/device.png', alt: null },
          ],
        },
      ],
    })
    assert.equal(withMedia[0]?.media?.length, 2)
    assert.throws(() =>
      parsePublishedReviews({
        reviews: [{ id: '3', productId: 'flagship', author: null, text: 'Текст', media: [{ type: 'image', src: 'https://evil.test/a.jpg' }] }],
      }),
    )
  })

  it('пустой или неверный список модераторов запрещает публикацию', () => {
    assert.equal(readModeratorIds(undefined).ok, false)
    assert.equal(readModeratorIds('').ok, false)
    assert.equal(readModeratorIds('1, abc').ok, false)
    assert.equal(readModeratorIds('0').ok, false)
    assert.equal(secretIsValid('short'), true)
    assert.equal(secretIsValid('bad secret'), false)
    assert.deepEqual(implementedContentKinds(), ['review', 'webinar'])
  })
})
