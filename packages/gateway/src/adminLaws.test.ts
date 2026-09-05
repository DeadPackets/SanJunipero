import type { IncomingMessage, Server } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_AUTH_FAILURES, MAX_BODY_BYTES, createLawsAdmin, readBody } from './adminLaws.js'

const TOKEN = 'a-token'

let server: Server | null = null

const started = async (): Promise<string> => {
  server = createLawsAdmin({ submitLaw: () => undefined, token: TOKEN })
  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      resolve((server!.address() as { port: number }).port)
    })
  })
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  if (server !== null) await new Promise((r) => server?.close(r))
  server = null
})

const law = async (base: string, token: string | null, body = '{"path":"x","value":1}') => {
  const res = await fetch(`${base}/admin/laws`, {
    method: 'POST',
    ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
    body,
  })
  await res.text()
  return res.status
}

/** The public origin proxies `/admin/*` to this channel, so the bearer is the whole lock and a
 *  stranger can guess at line rate. */
describe('★ the operator channel counts its refusals', () => {
  it('shuts the door after a run of wrong bearers, correct one included', async () => {
    const base = await started()
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) expect(await law(base, `guess-${i}`)).toBe(401)
    expect(await law(base, TOKEN)).toBe(429)
    expect(await law(base, 'guess-again')).toBe(429)
  })

  it('and a run that the operator interrupts starts over', async () => {
    const base = await started()
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) expect(await law(base, 'guess')).toBe(401)
    expect(await law(base, TOKEN)).toBe(400) // the token is right; the law path is not
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) expect(await law(base, 'guess')).toBe(401)
    expect(await law(base, TOKEN)).toBe(400)
  })
})

describe('★ the body cap bounds the memory, not just the answer', () => {
  it('refuses the moment the cap is passed, without waiting for the rest', async () => {
    // A stream that never ends: the old cap only refused at `end`, so it held every byte first.
    const req = new Readable({ read: () => undefined }) as unknown as IncomingMessage
    const answer = readBody(req)
    req.push('x'.repeat(MAX_BODY_BYTES + 1))
    expect(await answer).toBeNull()
  })

  it('and still reads a body under it', async () => {
    const req = Readable.from(['{"path":"x"}']) as unknown as IncomingMessage
    expect(await readBody(req)).toBe('{"path":"x"}')
  })
})
