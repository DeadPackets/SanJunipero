import { describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import { artNeededFor, itemCommissionText, watchDiscoveryArt } from './discoveryArt.js'

const stubCodex = (kinds: string[]) => ({
  listSince: (): AssetRecord[] =>
    kinds.map((k, i) => ({ id: `asset_${k}`, seq: i + 1, kind: k } as unknown as AssetRecord)),
  onAssetReady: (_cb: (r: AssetRecord) => void): void => {},
})

describe('what a discovery still needs drawing', () => {
  it('asks for the kinds the codex has never seen', () => {
    expect(artNeededFor(['waterskin', 'cord'], new Set(['cord']))).toEqual(['waterskin'])
  })
  it('asks for nothing when everything is drawn', () => {
    expect(artNeededFor(['cord'], new Set(['cord']))).toEqual([])
  })
  it('asks for nothing for a coined word, which makes nothing', () => {
    expect(artNeededFor([], new Set())).toEqual([])
  })
  it('dedupes and sorts, so the same discovery never commissions twice', () => {
    expect(artNeededFor(['b', 'a', 'a'], new Set())).toEqual(['a', 'b'])
  })
})

describe('the commission text', () => {
  it('describes the thing, and names the discovery it came from', () => {
    const text = itemCommissionText('waterskin', 'stitch a waterskin')
    expect(text).toContain('waterskin')
    expect(text).toContain('stitch a waterskin')
    expect(text.length).toBeGreaterThan(20)
  })
  it('turns a slug into words — a kind is a slug in the engine and prose to a model', () => {
    expect(itemCommissionText('water_skin', 'x')).toContain('water skin')
    expect(itemCommissionText('water_skin', 'x')).not.toContain('water_skin')
  })
})

describe('the watcher', () => {
  it('commissions one item per undrawn kind, as class "item" on a 1×1 footprint', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'asset_1' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
    expect(commission.mock.calls[0]![1]).toEqual({ w: 1, h: 1 })
    expect(commission.mock.calls[0]![2]).toBe('item')
  })

  it('does NOT commission art the codex already has', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex(['waterskin']) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).not.toHaveBeenCalled()
  })

  it('does not commission the same kind twice, even across two discoveries', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'one', makes: ['waterskin'] })
    w.onDiscovery({ name: 'two', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
  })

  it('learns from art it did not ask for — the codex keeps it current', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a' })
    let ready: ((r: AssetRecord) => void) | null = null
    const w = watchDiscoveryArt({
      forge: { commission },
      codex: { listSince: () => [], onAssetReady: (cb) => { ready = cb } },
    })
    expect(ready).not.toBeNull()
    ready!({ id: 'asset_x', kind: 'waterskin' } as unknown as AssetRecord)
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).not.toHaveBeenCalled()
  })

  it('RETURNS IMMEDIATELY — art never blocks a discovery', () => {
    let resolve = (): void => {}
    const commission = vi.fn(() => new Promise<AssetRecord>((r) => {
      resolve = () => { r({ id: 'a' } as unknown as AssetRecord) }
    }))
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    const before = Date.now()
    w.onDiscovery({ name: 'slow', makes: ['waterskin'] })
    expect(Date.now() - before).toBeLessThan(50)
    resolve()
  })

  it('survives a forge that throws, and reports it rather than crashing the run', async () => {
    const seen: string[] = []
    const commission = vi.fn().mockRejectedValue(new Error('provider down'))
    const w = watchDiscoveryArt({
      forge: { commission }, codex: stubCodex([]), onError: (k) => seen.push(k),
    })
    expect(() => w.onDiscovery({ name: 'x', makes: ['waterskin'] })).not.toThrow()
    await w.settle()
    expect(seen).toEqual(['waterskin'])
  })

  it('lets a later discovery try again for a kind whose commission failed', async () => {
    const commission = vi.fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce({ id: 'a' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]), onError: () => {} })
    w.onDiscovery({ name: 'one', makes: ['waterskin'] })
    await w.settle()
    w.onDiscovery({ name: 'two', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(2)
  })
})
