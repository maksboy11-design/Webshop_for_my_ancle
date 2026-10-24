export const MAX_BODY_BYTES = 256 * 1024

export function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  const headers = new Headers(extra)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers })
}

export async function readLimitedJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }
> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, status: 415 }
  }
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { ok: false, status: 413 }
  }
  if (!request.body) return { ok: false, status: 400 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400 }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { ok: false, status: 400 }
  }
}
