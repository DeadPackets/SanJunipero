import { describe, expect, it, vi } from 'vitest'
import { buildingMaterialPrompt } from '@sj/forge'
import type { AssetRecord } from '@sj/shared'
import {
  artNeededFor,
  itemCommissionText,
  noDiscoveryArt,
  watchDiscoveryArt,
} from './discoveryArt.js'

const stubCodex = (kinds: string[]) => ({
  listSince: (): AssetRecord[] =>
    kinds.map(
      (k, i) =>
        ({ id: `asset_${k}`, seq: i + 1, kind: k, status: 'ready' }) as unknown as AssetRecord,
    ),
  onAssetReady: (): void => {},
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
  it('names the building when commissioning its wall surface', () => {
    expect(buildingMaterialPrompt('meeting_hall', 'wood')).toContain('meeting hall')
    expect(buildingMaterialPrompt('meeting_hall', 'wood')).not.toContain('meeting_hall')
  })
})

describe('the watcher', () => {
  it('commissions one item per undrawn kind, as class "item" on a 1×1 footprint', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'asset_1', status: 'ready' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
    expect(commission.mock.calls[0]![1]).toEqual({ w: 1, h: 1 })
    expect(commission.mock.calls[0]![2]).toBe('item')
  })

  // The owner asked whether a building a person raises gets forge art. It did not: a codified
  // kind lands as a config row, `makes` is empty for it, and the screen drew a coloured block.
  it('★ commissions wall and roof materials on the discovered footprint', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'asset_1', status: 'ready' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({
      name: 'raise an alehouse',
      makes: [],
      raises: [{ kind: 'alehouse', w: 4, h: 3 }],
    })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(2)
    expect(commission.mock.calls[0]![1]).toEqual({ w: 4, h: 3 })
    expect(commission.mock.calls[0]![2]).toBe('building')
    expect(commission.mock.calls[0]![3]).toBe('material:alehouse:wood')
    expect(commission.mock.calls[1]![3]).toBe('material:alehouse:roof')
    expect(String(commission.mock.calls[0]![0])).toContain('alehouse')
  })

  it('does not draw the same roof twice, and leaves one the codex already has alone', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a', status: 'ready' })
    const w = watchDiscoveryArt({
      forge: { commission },
      codex: stubCodex(['material:alehouse:wood', 'material:alehouse:roof']),
    })
    w.onDiscovery({ name: 'one', makes: [], raises: [{ kind: 'alehouse', w: 4, h: 3 }] })
    w.onDiscovery({ name: 'two', makes: [], raises: [{ kind: 'school', w: 2, h: 2 }] })
    w.onDiscovery({ name: 'three', makes: [], raises: [{ kind: 'school', w: 2, h: 2 }] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(2)
    expect(commission.mock.calls[0]![3]).toBe('material:school:wood')
    expect(commission.mock.calls[1]![3]).toBe('material:school:roof')
  })

  it('does NOT commission art the codex already has', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a', status: 'ready' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex(['waterskin']) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).not.toHaveBeenCalled()
  })

  it('does not commission the same kind twice, even across two discoveries', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a', status: 'ready' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'one', makes: ['waterskin'] })
    w.onDiscovery({ name: 'two', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
  })

  it('learns from art it did not ask for — the codex keeps it current', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a', status: 'ready' })
    let ready: ((r: AssetRecord) => void) | null = null
    const w = watchDiscoveryArt({
      forge: { commission },
      codex: {
        listSince: () => [],
        onAssetReady: (cb) => {
          ready = cb
        },
      },
    })
    expect(ready).not.toBeNull()
    ready!({ id: 'asset_x', kind: 'waterskin', status: 'ready' } as unknown as AssetRecord)
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).not.toHaveBeenCalled()
  })

  it('RETURNS IMMEDIATELY — art never blocks a discovery', () => {
    let resolve = (): void => {}
    const commission = vi.fn(
      () =>
        new Promise<AssetRecord>((r) => {
          resolve = () => {
            r({ id: 'a', status: 'ready' } as unknown as AssetRecord)
          }
        }),
    )
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
      forge: { commission },
      codex: stubCodex([]),
      onError: (k) => seen.push(k),
    })
    expect(() => {
      w.onDiscovery({ name: 'x', makes: ['waterskin'] })
    }).not.toThrow()
    await w.settle()
    expect(seen).toEqual(['waterskin'])
  })

  it('lets a later discovery try again for a kind whose commission failed', async () => {
    const commission = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce({ id: 'a', status: 'ready' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]), onError: () => {} })
    w.onDiscovery({ name: 'one', makes: ['waterskin'] })
    await w.settle()
    w.onDiscovery({ name: 'two', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(2)
  })
})

describe('the watcher that draws nothing', () => {
  it('accepts a discovery, commissions nothing, and settles', async () => {
    const w = noDiscoveryArt()
    expect(() => {
      w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    }).not.toThrow()
    await expect(w.settle()).resolves.toBeUndefined()
  })

  it('answers the same shape the real watcher does, so a caller can swap them', () => {
    const real = watchDiscoveryArt({ forge: { commission: vi.fn() }, codex: stubCodex([]) })
    expect(Object.keys(noDiscoveryArt()).sort()).toEqual(Object.keys(real).sort())
  })
})
