import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStaticSite, resolveInRoot } from './staticSite.js'

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

/** A path that leaves the root as a STRING is already refused. A symlink leaves it as a file. */
describe('resolveInRoot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-root-'))
  const root = join(dir, 'client')

  beforeAll(() => {
    writeFileSync(join(dir, 'secret.txt'), 'not the town’s to serve')
    mkdirSync(root)
    writeFileSync(join(root, 'app.js'), 'the app')
    symlinkSync(dir, join(root, 'out'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a file inside the root', () => {
    expect(resolveInRoot(root, '/app.js')).toBe(join(root, 'app.js'))
    expect(resolveInRoot(root, '/nothing-here.js')).toBe(join(root, 'nothing-here.js'))
  })

  it('folds a walk out of it back inside, and refuses a name with a NUL in it', () => {
    expect(resolveInRoot(root, '/../secret.txt')).toBe(join(root, 'secret.txt'))
    expect(resolveInRoot(root, '/%2e%2e/secret.txt')).toBe(join(root, 'secret.txt'))
    expect(resolveInRoot(root, '/app%00.js')).toBeNull()
  })

  it('★ and refuses a link out of it, which no string test can see', () => {
    expect(resolveInRoot(root, '/out/secret.txt')).toBeNull()
  })
})
