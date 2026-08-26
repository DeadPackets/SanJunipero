import { describe, it, expect, vi } from 'vitest'
import {
  MAX_DEEP, RIVER_GROUND, DRY_GROUND, freePlots, place, plotsOf, streetTiles,
  townErrors, type Ground, type PlacedStructure,
} from './townGrammar.js'
import { plotKey, takenPlots, claimPlot, claimAll } from './townClaim.js'

// An agent claims a free plot and stands a building on it — never a coordinate, so it cannot
// choose a bad one. What the grammar proves is therefore true of every town builds can reach.

const NEED = { along: 2, deep: 2 }

describe('what makes a plot claimable', () => {
  it('names a plot by its block and slot, and nothing else', () => {
    const p = plotsOf(1, -2)[2]!
    expect(plotKey(p)).toBe('1,-2/e0')
  })

  it('reads what is taken off the buildings that stand there, never off a register', () => {
    const built = [place(plotsOf(0, -1)[0]!, 'house', 2, 2, 'amara')]
    expect([...takenPlots(built)]).toEqual(['0,-1/s0'])
  })
})

describe('when a ring plats', () => {
  // Ring 1 is what a town starts as. A ring plats when the platted area has no free plot left
  // for the building being raised — never before, so the town densifies before it sprawls.
  it('starts at ring 1 and stays there while a plot is free', () => {
    expect(claimPlot({ taken: new Set(), ground: RIVER_GROUND, need: NEED })!.rings).toBe(1)
    const some = new Set(freePlots(1, RIVER_GROUND).slice(0, 19).map(plotKey))
    expect(claimPlot({ taken: some, ground: RIVER_GROUND, need: NEED })!.rings).toBe(1)
  })

  it('plats the next ring the moment the last plot inside is taken', () => {
    const full = new Set(freePlots(1, RIVER_GROUND).map(plotKey))
    expect(claimPlot({ taken: full, ground: RIVER_GROUND, need: NEED })!.rings).toBe(2)
    const full2 = new Set(freePlots(2, RIVER_GROUND).map(plotKey))
    expect(claimPlot({ taken: full2, ground: RIVER_GROUND, need: NEED })!.rings).toBe(3)
  })

  // Growth is monotone: platting a ring never withdraws a plot that was already offered, so a
  // claim made at ring 1 is still valid at ring 5. That is what lets a town keep its history.
  it('never withdraws a plot it has already offered', () => {
    for (let r = 1; r < 5; r++) {
      const before = new Set(freePlots(r, RIVER_GROUND).map(plotKey))
      for (const k of freePlots(r + 1, RIVER_GROUND).map(plotKey)) before.delete(k)
      expect([...before], `ring ${r} plots lost at ring ${r + 1}`).toEqual([])
    }
  })

  it('gives up rather than platting forever when nothing can ever be built', () => {
    const drowned: Ground = () => 'water'
    expect(claimPlot({ taken: new Set(), ground: drowned, need: NEED })).toBeNull()
    expect(claimPlot({ taken: new Set(), ground: DRY_GROUND, need: { along: 9, deep: 1 } })).toBeNull()
    expect(claimPlot({ taken: new Set(), ground: DRY_GROUND, need: { along: 1, deep: MAX_DEEP + 1 } })).toBeNull()
  })
})

describe('claiming', () => {
  it('takes the free plot nearest the square, and is pure', () => {
    const spy = vi.spyOn(Math, 'random')
    const first = claimPlot({ taken: new Set(), ground: RIVER_GROUND, need: NEED })
    expect(first).not.toBeNull()
    expect(plotKey(first!.plot)).toBe(plotKey(freePlots(1, RIVER_GROUND)[0]!))
    expect(first!.rings).toBe(1)
    expect(claimPlot({ taken: new Set(), ground: RIVER_GROUND, need: NEED })).toEqual(first)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('never hands the same plot out twice', () => {
    const taken = new Set<string>()
    const seen = new Set<string>()
    for (let n = 0; n < 40; n++) {
      const c = claimPlot({ taken, ground: RIVER_GROUND, need: NEED })!
      expect(c, `claim ${n}`).not.toBeNull()
      const k = plotKey(c.plot)
      expect(seen.has(k), `${k} handed out twice`).toBe(false)
      seen.add(k)
      taken.add(k)
    }
    expect(seen.size).toBe(40)
  })

  it('plats a second ring on the twenty-first claim, because ring 1 holds twenty plots', () => {
    const taken = new Set<string>()
    const rings: number[] = []
    for (let n = 0; n < 21; n++) {
      const c = claimPlot({ taken, ground: RIVER_GROUND, need: NEED })!
      rings.push(c.rings)
      taken.add(plotKey(c.plot))
    }
    expect(rings.slice(0, 20).every((r) => r === 1)).toBe(true)
    expect(rings[20]).toBe(2)
  })
})

// ★ THE DELIVERABLE. Not "this town has no overlaps" — "no town this grammar can reach has
// one". A hundred and twenty claims, each one a real agent build, checked as a whole town.
describe('★ NO SEQUENCE OF AGENT BUILDS CAN BREAK THE SPACING', () => {
  const KINDS: ReadonlyArray<[string, number, number]> = [
    ['house', 2, 2], ['cabin', 2, 2], ['cottage', 3, 2], ['storehouse', 2, 2],
    ['workshop', 1, 1], ['barn', 4, 2], ['shed', 1, 2], ['farmhouse', 4, 1],
  ]

  const grow = (n: number, ground: Ground): { built: PlacedStructure[]; rings: number } => {
    const taken = new Set<string>()
    const built: PlacedStructure[] = []
    let rings = 1
    for (let k = 0; k < n; k++) {
      const [kind, along, deep] = KINDS[k % KINDS.length]!
      const c = claimPlot({ taken, ground, need: { along, deep } })
      if (c === null) break
      taken.add(plotKey(c.plot))
      rings = c.rings
      built.push(place(c.plot, kind, along, deep, null))
    }
    return { built, rings }
  }

  it('grows 120 buildings of eight different masses with not one error', () => {
    const { built, rings } = grow(120, RIVER_GROUND)
    expect(built).toHaveLength(120)
    expect(rings).toBeGreaterThanOrEqual(3)
    expect(townErrors(built, streetTiles(rings, RIVER_GROUND))).toEqual([])
  })

  it('grows the same town in reverse kind order, and that one is clean too', () => {
    const taken = new Set<string>()
    const built: PlacedStructure[] = []
    let rings = 1
    for (let k = 119; k >= 0; k--) {
      const [kind, along, deep] = KINDS[k % KINDS.length]!
      const c = claimPlot({ taken, ground: RIVER_GROUND, need: { along, deep } })!
      taken.add(plotKey(c.plot))
      rings = c.rings
      built.push(place(c.plot, kind, along, deep, null))
    }
    expect(townErrors(built, streetTiles(rings, RIVER_GROUND))).toEqual([])
  })

  it('claimAll is that loop, and it replays identically', () => {
    const wanted = KINDS.map(([kind, along, deep]) => ({ kind, along, deep, owner: null }))
    const a = claimAll({ ground: RIVER_GROUND, wanted })
    expect(a.built.map((s) => s.kind)).toEqual(wanted.map((w) => w.kind))
    expect(claimAll({ ground: RIVER_GROUND, wanted })).toEqual(a)
    expect(townErrors(a.built, streetTiles(a.rings, RIVER_GROUND))).toEqual([])
  })

  it('carries on from a town that is already standing', () => {
    const first = claimAll({ ground: RIVER_GROUND, wanted: [{ kind: 'house', along: 2, deep: 2, owner: 'amara' }] })
    const second = claimAll({
      ground: RIVER_GROUND, standing: first.built,
      wanted: [{ kind: 'cabin', along: 2, deep: 2, owner: null }],
    })
    expect(plotKey(second.built[0]!)).not.toBe(plotKey(first.built[0]!))
    expect(townErrors([...first.built, ...second.built], streetTiles(2, RIVER_GROUND))).toEqual([])
  })
})
