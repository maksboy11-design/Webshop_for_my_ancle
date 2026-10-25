const ALLOWED = new Set(['status', 'updateType', 'duplicate', 'configured', 'kind', 'allowed', 'attachments', 'errorClass', 'chatType', 'chatSign'])

export interface LogFields {
  status?: number
  updateType?: string
  duplicate?: boolean
  configured?: boolean
  /** Результат классификации группового сообщения (review/text/image/...). Без текста. */
  kind?: string
  allowed?: boolean
  /** ??? ???? ?? ??????? (dialog/chat/channel) ??? unknown. ??? id ???? ?? ??????????. */
  chatType?: string
  /** ???? id ????: negative (??????) / positive (?????? ??????) / none. ?????? ???????????. */
  chatSign?: string
  attachments?: number
  /** Только имя класса ошибки и код СУБД, без сообщения. */
  errorClass?: string
}

export interface Log {
  info(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

function allow(fields: LogFields | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!fields) return out
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

export function createLogger(): Log {
  return {
    info(event, fields) {
      console.info(JSON.stringify({ scope: 'max-reviews', level: 'info', event, ...allow(fields) }))
    },
    error(event, fields) {
      console.error(JSON.stringify({ scope: 'max-reviews', level: 'error', event, ...allow(fields) }))
    },
  }
}
