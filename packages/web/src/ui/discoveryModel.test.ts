import { describe, expect, it } from 'vitest'
import type { AssetRecord, DiscoveryRecord } from '@sj/shared'
import { leavesOf, recordSummary } from './discoveryModel.js'
import { GAMIFICATION_BAN } from './townStats.js'

export const D = (over: Partial<DiscoveryRecord> = {}): DiscoveryRecord => ({
  seq: 1,
  tick: 17_280,
  recipeId: 'recipe:waterskin',
  name: 'stitch a waterskin',
  kind: 'craft',
  byId: 'a1',
  by: 'Maret',
  intent: 'i want to carry water in a stitched hide',
  makes: ['waterskin'],
  ...over,
})
export const A = (kind: string, id = `asset_${kind}`): AssetRecord => ({
  id,
  seq: 1,
  class: 'item',
  desc: kind,
  kind,
  meta: null,
  footprint: { w: 1, h: 1 },
  widthPx: 64,
  heightPx: 64,
  status: 'ready',
  score: 8,
  attempts: 1,
  costUsd: 0,
  createdAt: '2026-01-01',
})

describe('the leaves of the record', () => {
  it('keeps the archive’s order and gives each leaf its moment and its heading', () => {
    const [leaf] = leavesOf([D()], [])
    // tick 17,280 is day 12 at midnight — the literal is what tickToMoment really returns,
    // and it is the same stamp ChroniclePanel prints, so the two surfaces do not drift.
    expect(leaf!.when).toBe('Day 12, 00:00')
    expect(leaf!.headline).toBe('Maret worked out stitch a waterskin')
  })

  it('keeps the archive’s order across several', () => {
    const rows = [D(), D({ seq: 2, tick: 20_000, name: 'dance', kind: 'word', makes: [] })]
    expect(leavesOf(rows, []).map((l) => l.record.seq)).toEqual([1, 2])
  })

  it('finds the art for the first thing a discovery makes', () => {
    expect(leavesOf([D()], [A('waterskin')])[0]!.assetId).toBe('asset_waterskin')
  })

  it('READS WITHOUT ART — a discovery is never blocked on the forge', () => {
    expect(leavesOf([D()], [])[0]!.assetId).toBeNull()
    expect(leavesOf([D({ kind: 'word', makes: [] })], [])[0]!.assetId).toBeNull()
    expect(leavesOf([D()], [A('cord')])[0]!.assetId).toBeNull()
  })

  it('prefers a ready asset over a placeholder for the same kind', () => {
    const ph = { ...A('waterskin', 'asset_ph'), status: 'placeholder' } as AssetRecord
    expect(leavesOf([D()], [ph, A('waterskin', 'asset_ready')])[0]!.assetId).toBe('asset_ready')
    // and takes the placeholder when that is all there is
    expect(leavesOf([D()], [ph])[0]!.assetId).toBe('asset_ph')
  })

  it('summarises the whole run in one line, and never as a score', () => {
    const line = recordSummary(leavesOf([D(), D({ seq: 2, byId: 'a2', by: 'Sena' })], []), 59_040)
    expect(line).toBe('In 41 days, two people worked out 2 things.')
    expect(line).not.toMatch(/score|point|level|rank/i)
    expect(line).not.toMatch(GAMIFICATION_BAN)
  })

  it('counts the minds, not the discoveries — one person who worked out three things', () => {
    const three = [D(), D({ seq: 2 }), D({ seq: 3 })]
    expect(recordSummary(leavesOf(three, []), 1440)).toBe(
      'In 1 day, one person worked out 3 things.',
    )
  })

  it('says so plainly when the town has worked nothing out yet', () => {
    expect(recordSummary([], 1440)).toBe('The town has not worked anything out yet.')
  })
})
