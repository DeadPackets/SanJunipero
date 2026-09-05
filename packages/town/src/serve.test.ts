// A spent ledger is a budget event, not a fault: the minds are held and the town keeps serving.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { startDevWorld } from './devWorld.js'
import { castOrScripted } from './serve.js'

class Held extends Error {}

const dir = mkdtempSync(join(tmpdir(), 'sj-serve-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
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
