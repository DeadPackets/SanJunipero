// A spent ledger is a budget event, not a fault: the minds are held and the town keeps serving.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { startDevWorld } from './devWorld.js'
import { castOrScripted, usdEnv } from './serve.js'

class Held extends Error {}

const dir = mkdtempSync(join(tmpdir(), 'sj-serve-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ★ `SJ_SPEND_CAP_USD=` with nothing after it read as $0, and every `cap > 0` guard — the boot
// check, the per-caller backstop, the runtime stop — is off at zero.
describe('★ a spend knob with nothing after the = is unset, never a cap of zero', () => {
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('leaves the built-in ceiling standing, and says the value was ignored', () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      vi.stubEnv('SJ_SPEND_CAP_USD', '  ')
      expect(usdEnv('SJ_SPEND_CAP_USD')).toBeUndefined()
      vi.stubEnv('SJ_SPEND_DAILY_USD', '')
      expect(usdEnv('SJ_SPEND_DAILY_USD')).toBeUndefined()
      expect(said.mock.calls.map((c) => String(c[0])).join('\n')).toContain('SJ_SPEND_DAILY_USD')
    } finally {
      said.mockRestore()
    }
  })

  it('still takes a cap an operator meant, zero included', () => {
    vi.stubEnv('SJ_SPEND_CAP_USD', '0')
    expect(usdEnv('SJ_SPEND_CAP_USD')).toBe(0)
    vi.stubEnv('SJ_SPEND_CAP_USD', '12.5')
    expect(usdEnv('SJ_SPEND_CAP_USD')).toBe(12.5)
  })
})

// ★ `void world?.stop().then(() => process.exit(1))` short-circuits the WHOLE chain when the
// world is still booting, so the stop it promised was a no-op. Nothing exits on a spend stop now.
describe('★ a spend stop leaves the process standing', () => {
  it('has no exit to short-circuit past', () => {
    const src = readFileSync(new URL('./serve.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('process.exit(1)')
    expect(src).not.toContain('world?.stop()')
  })
})

// A rehearsal signals twice when the first teardown outlasts its grace, and both ran the whole
// close on the same handles — two `process.exit(0)` calls racing one WAL flush.
describe('★ the town closes once, however many signals arrive', () => {
  it('guards the teardown behind a flag', () => {
    const src = readFileSync(new URL('./serve.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/if \(stopping\) return/)
  })
})

describe('★ a ledger refusal holds the minds, never the viewer', () => {
  it('hands back no cast when the ledger refuses the boot', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const built = (): Promise<never> => Promise.reject(new Held('spent its daily budget'))
      await expect(castOrScripted(built, Held)).resolves.toBeNull()
      expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toContain('daily budget')
    } finally {
      err.mockRestore()
    }
  })

  it('still refuses a boot that failed for anything else', async () => {
    const built = (): Promise<never> => Promise.reject(new Error('the viewer was never built'))
    await expect(castOrScripted(built, Held)).rejects.toThrow('the viewer was never built')
  })

  it('★ binds the gateway on a boot the ledger refused, scripted', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dw = await startDevWorld({
      realMsPerTick: 10_000_000,
      port: 0,
      dbPath: join(dir, 'held.db'),
      cast: () => castOrScripted(() => Promise.reject(new Held('spent')), Held),
    })
    try {
      expect(dw.gateway.port).toBeGreaterThan(0)
      expect(dw.live).toBe(false)
    } finally {
      await dw.stop()
      err.mockRestore()
    }
  })
})
