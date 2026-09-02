import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStaticSite } from './staticSite.js'

describe('the built client, served from the world’s own origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-static-'))
  const locked = join(dir, 'locked.txt')
  let server: Server
  let base: string

  beforeAll(async () => {
    writeFileSync(join(dir, 'index.html'), '<html lang="en"><body>the town</body></html>')
    writeFileSync(locked, 'a file that stats and will not open')
    chmodSync(locked, 0o000)
    const site = makeStaticSite(dir)
    server = createServer((req, res) => {
      if (!site(req, res, new URL(req.url ?? '/', 'http://localhost').pathname)) res.end('miss')
    })
    await new Promise<void>((r) => {
      server.listen(0, '127.0.0.1', r)
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((r) => server.close(r))
    chmodSync(locked, 0o600)
    rmSync(dir, { recursive: true, force: true })
  })

  /** Pre-fix the unopenable read leaves an unhandled 'error' — the run fails on that. */
  it('★ a file it cannot open drops that one response, not the process', async () => {
    await fetch(`${base}/locked.txt`)
      .then((r) => r.text())
      .catch(() => null)
    expect(await (await fetch(`${base}/`)).text()).toContain('the town')
  })
})
