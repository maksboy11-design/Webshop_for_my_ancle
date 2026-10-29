import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

interface Script {
  buildCommands(flags: Set<string>): { name: string; description: string }[]
  setCommands(input: {
    token: string | undefined
    commands: unknown[]
    request: (r: { method: string; url: string; headers: Record<string, string>; body: string }) => Promise<{ status: number }>
  }): Promise<number>
}

async function load(): Promise<Script> {
  const target = pathToFileURL(resolve('scripts', 'max-set-commands.mjs')).href
  return (await import(target)) as Script
}

describe('scripts/max-set-commands.mjs', () => {
  it('по умолчанию не добавляет команды модератора, с флагом добавляет, --clear очищает', async () => {
    const { buildCommands } = await load()
    const base = buildCommands(new Set()).map((c) => c.name)
    assert.deepEqual(base, ['start', 'review', 'cancel', 'whoami', 'help'])
    const moderation = buildCommands(new Set(['--with-moderation'])).map((c) => c.name)
    assert.equal(moderation.includes('reviews_pending'), true)
    assert.equal(moderation.includes('content_pending'), true)
    assert.equal(moderation.includes('reviews_published'), true)
    assert.equal(moderation.includes('webinars_pending'), true)
    assert.equal(moderation.includes('webinars_published'), true)
    assert.deepEqual(buildCommands(new Set(['--clear'])), [])
    assert.equal(moderation.length <= 32, true)
  })

  it('отправляет PATCH /me/commands с токеном только в заголовке и требует токен', async () => {
    const { buildCommands, setCommands } = await load()
    const calls: { method: string; url: string; headers: Record<string, string>; body: string }[] = []
    const status = await setCommands({
      token: 'TEST-TOKEN-VALUE',
      commands: buildCommands(new Set()),
      request: async (r) => {
        calls.push(r)
        return { status: 200 }
      },
    })
    assert.equal(status, 200)
    assert.equal(calls[0]?.method, 'PATCH')
    assert.equal(calls[0]?.url, 'https://platform-api2.max.ru/me/commands')
    assert.equal(calls[0]?.headers.Authorization, 'TEST-TOKEN-VALUE')
    assert.equal(calls[0]?.body.includes('TEST-TOKEN-VALUE'), false)
    await assert.rejects(() => setCommands({ token: undefined, commands: [], request: async () => ({ status: 200 }) }), /MAX_BOT_TOKEN/)
  })
})