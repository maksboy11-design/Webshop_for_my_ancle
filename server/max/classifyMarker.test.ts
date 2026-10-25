import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyMessage } from './classify'

const image = { type: 'image' as const, token: 'img', photoId: '5', width: null, height: null, duration: null, size: null, sourceUrl: null, persistedSrc: null }
const video = { type: 'video' as const, token: 'vid', photoId: null, width: 10, height: 10, duration: 2, size: null, sourceUrl: null, persistedSrc: null }

describe('маркер Отзыв: регистр, эмодзи, разметка', () => {
  const positives: [string, string][] = [
    ['Отзыв: Проверочный отзыв', 'Проверочный отзыв'],
    ['ОТЗЫВ Проверка регистра', 'Проверка регистра'],
    ['оТЗЫВ Смешанный регистр', 'Смешанный регистр'],
    ['🩵Отзыв от партнера: всё отлично', 'от партнера: всё отлично'],
    ['🩵 Отзыв: с пробелом после эмодзи', 'с пробелом после эмодзи'],
    ['⬆️⬆️⬆️ Отзыв: стрелки', 'стрелки'],
    ['👩‍⚕️ Отзыв врача', 'врача'],
    ['\u200BОтзыв: невидимый символ', 'невидимый символ'],
    ['\uFEFFОтзыв: BOM', 'BOM'],
    ['**Отзыв**: жирный', 'жирный'],
    ['__Отзыв__\nкурсив', 'курсив'],
    ['# Отзыв: заголовок', 'заголовок'],
    ['#отзыв хэштег', 'хэштег'],
    ['> Отзыв: цитата', 'цитата'],
    ['[Отзыв] скобки', 'скобки'],
    ['«Отзыв»: кавычки', 'кавычки'],
    ['Отзыв\nс новой строки', 'с новой строки'],
    ['   \n  Отзыв:    лишние   пробелы', 'лишние   пробелы'],
    ['Отзыв: «Цитата внутри» остаётся', '«Цитата внутри» остаётся'],
  ]
  for (const [input, expected] of positives) {
    it(`распознаёт: ${JSON.stringify(input)}`, () => {
      const result = classifyMessage(input, [])
      assert.equal(result.kind, 'review')
      assert.equal(result.review, true)
      assert.equal(result.publicText, expected)
    })
  }

  const negatives = ['Отзывчивый сервис', '🩵Отзывчивый сервис', 'Наш отзыв о товаре', '🩵 Новый отзыв клиента', 'Безотзывный', 'Отзывы клиентов', 'Отзыв_1 текст', 'Привет! Отзыв ниже']
  for (const input of negatives) {
    it(`не принимает: ${JSON.stringify(input)}`, () => {
      const result = classifyMessage(input, [])
      assert.equal(result.review, false)
      assert.equal(result.kind, 'text')
    })
  }

  it('маркер без текста: пусто без медиа, отзыв с одним медиа', () => {
    assert.equal(classifyMessage('🩵Отзыв', []).kind, 'empty')
    assert.equal(classifyMessage('Отзыв:', []).kind, 'empty')
    assert.equal(classifyMessage('🩵Отзыв', [image]).kind, 'review')
    assert.equal(classifyMessage('🩵Отзыв', [image]).publicText, null)
  })

  it('подпись к медиа и несколько вложений: одна запись', () => {
    const caption = classifyMessage('🩵Отзыв: подпись к фото', [image, image, video])
    assert.equal(caption.kind, 'review')
    assert.equal(caption.publicText, 'подпись к фото')
    assert.equal(classifyMessage(null, [image, image]).kind, 'image')
    assert.equal(classifyMessage('Без маркера', [image]).kind, 'mixed')
    assert.equal(classifyMessage(null, []).kind, 'empty')
  })

  it('не теряет эмодзи внутри публичного текста', () => {
    assert.equal(classifyMessage('🩵Отзыв: крем 🩵 лучший', []).publicText, 'крем 🩵 лучший')
  })
})
