import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { publishedReviewsOpenButton, readMiniAppOpenConfig } from './miniAppOpen'

describe('miniAppOpen', () => {
  it('22: open_app при наличии contact_id', () => {
    const cfg = readMiniAppOpenConfig({
      MAX_BOT_CONTACT_ID: '123456',
      MAX_WEB_APP_ID: 'app-1',
      MAX_MINI_APP_URL: 'https://silkwaysitefortanya.vercel.app/admin-reviews.html',
    })
    const button = publishedReviewsOpenButton(cfg)
    assert.equal(button.type, 'open_app')
    if (button.type === 'open_app') {
      assert.equal(button.contact_id, 123456)
      assert.equal(button.web_app, 'app-1')
      assert.equal(button.text, 'Опубликованные отзывы')
    }
  })

  it('fallback link при URL без contact_id', () => {
    const button = publishedReviewsOpenButton(
      readMiniAppOpenConfig({
        MAX_MINI_APP_URL: 'https://silkwaysitefortanya.vercel.app/admin-reviews.html',
      }),
    )
    assert.equal(button.type, 'link')
  })
})
