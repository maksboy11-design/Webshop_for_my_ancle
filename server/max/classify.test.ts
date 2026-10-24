import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readAttachments } from './attachments'
import { classifyMessage } from './classify'
import { readChatIds } from './config'
import { groupCanReadMessages } from './groupAccess'

const image = { type: 'image' as const, token: 'img', photoId: '5', width: null, height: null, duration: null, size: null }
const video = { type: 'video' as const, token: 'vid', photoId: null, width: 10, height: 10, duration: 2, size: null }

describe('маркер Отзыв', () => {
  it('распознаёт отдельное первое слово без учёта регистра', () => {
    assert.equal(classifyMessage('Отзыв: Всё понравилось', []).kind, 'review')
    assert.equal(classifyMessage('Отзыв: Всё понравилось', []).publicText, 'Всё понравилось')
    assert.equal(classifyMessage('ОТЗЫВ: Всё понравилось', []).publicText, 'Всё понравилось')
    assert.equal(classifyMessage('оТЗЫВ Всё понравилось', []).publicText, 'Всё понравилось')
    assert.equal(classifyMessage(' Отзыв= Всё понравилось', []).publicText, 'Всё понравилось')
    assert.equal(classifyMessage('Отзыв — Всё понравилось', []).publicText, 'Всё понравилось')
    assert.equal(classifyMessage('ОТЗЫВ=Продукт понравился', []).publicText, 'Продукт понравился')
  })

  it('не принимает часть другого слова и маркер не в начале', () => {
    assert.equal(classifyMessage('Отзывчивый сервис', []).review, false)
    assert.equal(classifyMessage('Отзывчивый сервис', []).kind, 'text')
    assert.equal(classifyMessage('Наш отзыв о товаре', []).review, false)
    assert.equal(classifyMessage('Наш отзыв о товаре', []).kind, 'text')
  })

  it('отклоняет пустой маркер и оставляет медиа-отзыв', () => {
    assert.equal(classifyMessage('Отзыв', []).kind, 'empty')
    assert.equal(classifyMessage(null, []).kind, 'empty')
    assert.equal(classifyMessage('   ', []).kind, 'empty')
    const photo = classifyMessage('Отзыв', [image])
    assert.equal(photo.kind, 'review')
    assert.equal(photo.publicText, null)
    assert.equal(photo.review, true)
    const clip = classifyMessage('ОТЗЫВ:', [video])
    assert.equal(clip.kind, 'review')
    assert.equal(clip.publicText, null)
  })

  it('различает фото, видео и смешанный контент', () => {
    assert.equal(classifyMessage(null, [image]).kind, 'image')
    assert.equal(classifyMessage(null, [video]).kind, 'video')
    assert.equal(classifyMessage('Смотрите', [image]).kind, 'mixed')
    assert.equal(classifyMessage('Смотрите', [video]).kind, 'mixed')
    assert.equal(classifyMessage(null, [image, video]).kind, 'mixed')
    assert.equal(classifyMessage('Только текст', []).kind, 'text')
  })

  it('не сохраняет временный url и отсекает слишком большой файл', () => {
    const stored = readAttachments([
      { type: 'image', payload: { photo_id: 5, token: 'img-token-test', url: 'http://127.0.0.1/a.jpg' } },
      { type: 'video', payload: { token: 'vid-token-test', url: 'http://169.254.169.254/latest', width: 320, height: 240, duration: 3 } },
      { type: 'file', payload: { token: 'file-token', url: 'http://127.0.0.1/file.bin' } },
      { type: 'image', payload: { photo_id: 6, token: 'big', url: 'https://example.test/big', size: 21 * 1024 * 1024 } },
    ])
    assert.equal(stored[0]?.type, 'image')
    assert.equal(stored[0]?.token, 'img-token-test')
    assert.equal(JSON.stringify(stored).includes('127.0.0.1'), false)
    assert.equal(JSON.stringify(stored).includes('169.254.169.254'), false)
    assert.equal(JSON.stringify(stored).includes('file-token'), false)
    assert.equal(stored[2]?.type, 'unsupported')
    assert.equal(stored[3]?.type, 'unsupported')
  })

  it('требует явный список групп и право читать сообщения', () => {
    assert.equal(readChatIds(undefined).ok, false)
    assert.equal(readChatIds('').ok, false)
    assert.equal(readChatIds('0').ok, false)
    assert.equal(readChatIds('99, abc').ok, false)
    const parsed = readChatIds('99, 100')
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual([...parsed.ids], ['99', '100'])
    assert.equal(groupCanReadMessages(['write']), false)
    assert.equal(groupCanReadMessages(null), false)
    assert.equal(groupCanReadMessages(['read_all_messages']), true)
  })
})
