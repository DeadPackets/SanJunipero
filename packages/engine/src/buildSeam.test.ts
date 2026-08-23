import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG, MIN_SEP, PITCH, STREET, TOWN_SQUARE, T_GRASS, T_ROAD, WORLD_MARGIN,
  blockGroundOf, centreOf, edgesOwed, type SimEvent,
} from '@sj/shared'
import { fold } from './fold.js'
import { genesisState, type WorldState } from './state.js'
import { makeGenesisWorld, GENESIS_FORD } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { makeFixtureMap } from './scripted.js'
import { buildIsPlotted, buildSiteOf, isPlottedKind } from './verbs.js'
import { claimInWorld, layBlock, standingRects, townGroundBox, townSquareOf } from './town.js'
import { builtBox, owedBox } from './systems/mapGrowth.js'

const CFG = DEFAULT_CONFIG
const T_FOREST = 3
let seq = 0
const ev = (type: string, payload: unknown): SimEvent =>
  ({ seq: ++seq, tick: 0, type, payload } as unknown as SimEvent)

const apply = (s: WorldState, events: ReadonlyArray<{ type: string; payload: unknown }>): WorldState =>
  events.reduce((acc, e) => fold(acc, ev(e.type, e.payload), CFG), s)

function genesisTown(): WorldState {
  const g = makeGenesisWorld(CFG)
  return apply(genesisState(CFG, g.terrain), g.events)
}

/** A body with wood in its hands, standing where it is told. */
function withBuilder(s: WorldState, id: string, at: { x: number; y: number }, wood = 10): WorldState {
  return apply(s, [
    { type: 'agent_spawned', payload: { id, name: id, x: at.x, y: at.y, ageDays: 10000 } },
    { type: 'item_spawned', payload: { id: `wood_${id}`, kind: 'wood', qty: wood, loc: { t: 'agent', id } } },
  ])
}

/** Where a builder has to stand to raise the next thing: the plot's own door tile. */
const doorFor = (s: WorldState) => claimInWorld(s, { along: 2, deep: 2 })!.door

describe('★ how an agent builds: the plot, never the coordinate', () => {
  it('a house in a town takes {kind} and refuses a coordinate, in words', () => {
    const s = withBuilder(genesisTown(), 'a', doorFor(genesisTown()))
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' }).ok).toBe(true)
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house', x: 67, y: 92 })).toEqual({
      ok: false,
      reason: "build needs {kind} — where a house stands is the town's to say, not yours",
    })
  })

  it('★ the site is not a function of the params: every coordinate a mind could name lands on the same plot', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    const s = withBuilder(base, 'a', claim.door)
    let named = 0
    for (let x = 60; x < 75; x++)
      for (let y = 60; y < 75; y++) {
        // Every one of them is refused, and the site the engine WOULD use never moves.
        expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house', x, y }).ok).toBe(false)
        expect(buildSiteOf(s, CFG, 'a', { kind: 'house', x, y }).site).toEqual(claim.site)
        named++
      }
    expect(named).toBe(225)
  })

  it('the building the engine plants is the plot the town claimed, tile for tile', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    const s = withBuilder(base, 'a', claim.door)
    const r = submitIntent(s, CFG, 'a', 'build', { kind: 'house' })
    expect(r.ok).toBe(true)
    const planned = r.ok ? r.events.find((e) => e.type === 'structure_planned')! : null
    expect(planned!.payload).toMatchObject({
      kind: 'house', x: claim.site.x, y: claim.site.y, w: claim.site.w, h: claim.site.h, builderId: 'a',
    })
  })

  it('a builder standing anywhere else is refused with the place to walk to', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    const s = withBuilder(base, 'a', { x: TOWN_SQUARE.x + 7, y: TOWN_SQUARE.y + 7 })
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' })).toEqual({
      ok: false,
      reason: `the town keeps ground for a house — go and stand at (${claim.door.x}, ${claim.door.y})`,
    })
  })

  it('a builder standing ON the ground is pointed at the street, not walled in by its own walls', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    const s = withBuilder(base, 'a', { x: claim.site.x, y: claim.site.y })
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' })).toEqual({
      ok: false,
      reason: `you are standing on the ground itself — go and stand at (${claim.door.x}, ${claim.door.y})`,
    })
  })

  it('a builder with nothing in its hands is refused for the materials, not the ground', () => {
    const base = genesisTown()
    const s = withBuilder(base, 'a', doorFor(base), 0)
    const r = submitIntent(s, CFG, 'a', 'build', { kind: 'house' })
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('not enough wood') })
  })
})

describe('the bridge is the one thing a builder still sites', () => {
  it('a deck over the ford takes {kind, x, y} and stands where it is named', () => {
    const base = genesisTown()
    // The spit at GENESIS_FORD.x is the bank on the town's side; the deck spans the two tiles
    // of water west of it, which is the same span `g11-deepworld.ts` probes.
    const at = { x: GENESIS_FORD.x - 2, y: GENESIS_FORD.y0 }
    const s = apply(withBuilder(base, 'a', { x: at.x - 1, y: at.y }, 0), [
      { type: 'item_spawned', payload: { id: 'wood_a', kind: 'wood', qty: 6, loc: { t: 'agent', id: 'a' } } },
    ])
    expect(isPlottedKind('bridge')).toBe(false)
    expect(buildIsPlotted(s, 'bridge')).toBe(false)
    const r = submitIntent(s, CFG, 'a', 'build', { kind: 'bridge', x: at.x, y: at.y })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const planned = r.ok ? r.events.find((e) => e.type === 'structure_planned')! : null
    expect(planned!.payload).toMatchObject({ kind: 'bridge', x: at.x, y: at.y })
    // And it is still refused without a coordinate, because water is not a plot.
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'bridge' }))
      .toEqual({ ok: false, reason: 'build needs {kind, x, y}' })
  })
})

describe('a world with no town in it builds the way it always did', () => {
  it('the fixture meadow takes a coordinate, and has no plot to offer', () => {
    const s = withBuilder(genesisState(CFG, makeFixtureMap()), 'a', { x: 30, y: 22 })
    expect(townSquareOf(s)).toBeNull()
    expect(buildIsPlotted(s, 'house')).toBe(false)
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house', x: 30, y: 20 }).ok).toBe(true)
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' }))
      .toEqual({ ok: false, reason: 'build needs {kind, x, y}' })
  })
})

describe('a build that stops halfway goes back to the same walls', () => {
  it('resumes on the plot it claimed, and does not spend its wood twice', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    let s = withBuilder(base, 'a', claim.door)
    const first = submitIntent(s, CFG, 'a', 'build', { kind: 'house' })
    expect(first.ok).toBe(true)
    s = apply(s, first.ok ? first.events : [])
    // The wood is gone and a site stands on the plot.
    expect(Object.values(s.items).filter((i) => i.kind === 'wood' && i.loc.t === 'agent')).toHaveLength(0)
    s = apply(s, [{ type: 'action_interrupted', payload: { agentId: 'a', reason: 'rest' } }])
    const again = submitIntent(s, CFG, 'a', 'build', { kind: 'house' })
    expect(again.ok, again.ok ? '' : again.reason).toBe(true)
    // No second structure, and no second bill.
    expect(again.ok ? again.events.filter((e) => e.type === 'structure_planned') : null).toEqual([])
    expect(buildSiteOf(s, CFG, 'a', { kind: 'house' }).site).toEqual(claim.site)
  })
})

describe('★ the town grows only where the lattice lets it', () => {
  /** Raise `n` houses through the real verb, each by its own builder standing at its own plot. */
  function raiseThrough(n: number): WorldState {
    let s = genesisTown()
    for (let i = 0; i < n; i++) {
      const claim = claimInWorld(s, { along: 2, deep: 2 })
      if (claim === null) break
      s = withBuilder(s, `b${i}`, claim.door)
      const r = submitIntent(s, CFG, `b${i}`, 'build', { kind: 'house' })
      expect(r.ok, r.ok ? '' : `build ${i}: ${r.reason}`).toBe(true)
      s = apply(s, r.ok ? r.events : [])
      const planned = Object.values(s.structures).find((x) => x.builtBy === `b${i}`)!
      s = apply(s, [{ type: 'structure_completed', payload: { id: planned.id } }])
    }
    return s
  }

  it('twelve agent builds fill ring 1 and cross into ring 2, with the floor intact', () => {
    const s = raiseThrough(12)
    const rects = standingRects(s)
    expect(rects).toHaveLength(11 + 12)
    // Nothing overlaps, and nothing comes closer than the grammar's floor.
    const seen = new Set<string>()
    for (const r of rects)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          expect(seen.has(`${x},${y}`), `${x},${y}`).toBe(false)
          seen.add(`${x},${y}`)
        }
    let closest = Infinity
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const p = centreOf({ dx: rects[i]!.x, dy: rects[i]!.y, w: rects[i]!.w, h: rects[i]!.h })
        const q = centreOf({ dx: rects[j]!.x, dy: rects[j]!.y, w: rects[j]!.w, h: rects[j]!.h })
        closest = Math.min(closest, Math.hypot(p.sx - q.sx, p.sy - q.sy))
      }
    expect(closest).toBeGreaterThanOrEqual(MIN_SEP)
    // The twelfth is the one that crossed: it stands on a block two rings out.
    expect(claimInWorld(genesisTown(), { along: 2, deep: 2 })!.rings).toBe(1)
    expect(claimInWorld(raiseThrough(11), { along: 2, deep: 2 })!.rings).toBe(2)
  })

  it('replays identically: the same builds in the same order reach the same town', () => {
    const a = standingRects(raiseThrough(12))
    const b = standingRects(raiseThrough(12))
    expect(a).toEqual(b)
  })
})


describe('★ a block is laid out when its first building is raised', () => {
  /** Raise houses through the real verb until the claim crosses into ring `r`. */
  function raiseUntilRing(r: number): { before: WorldState; after: WorldState; block: { i: number; j: number } } {
    let s = genesisTown()
    for (let i = 0; i < 40; i++) {
      const claim = claimInWorld(s, { along: 2, deep: 2 })!
      if (claim.rings >= r) {
        const before = withBuilder(s, 'x', claim.door)
        const res = submitIntent(before, CFG, 'x', 'build', { kind: 'house' })
        expect(res.ok, res.ok ? '' : res.reason).toBe(true)
        return { before, after: apply(before, res.ok ? res.events : []), block: claim.block }
      }
      s = withBuilder(s, `b${i}`, claim.door)
      const res = submitIntent(s, CFG, `b${i}`, 'build', { kind: 'house' })
      expect(res.ok, res.ok ? '' : res.reason).toBe(true)
      s = apply(s, res.ok ? res.events : [])
      const planned = Object.values(s.structures).find((v) => v.builtBy === `b${i}`)!
      s = apply(s, [{ type: 'structure_completed', payload: { id: planned.id } }])
    }
    throw new Error('never reached that ring')
  }

  it('★ the first ring-2 build clears its block and paves its streets, and the door opens on one', () => {
    const { before, after, block } = raiseUntilRing(2)
    const claim = claimInWorld(before, { along: 2, deep: 2 })!
    expect(claim.block).toEqual(block)
    // NON-VACUITY: before the build this was the world's own untouched ground, not a street.
    expect(before.terrain[claim.door.y]![claim.door.x]).not.toBe(T_ROAD)
    const ground = blockGroundOf(TOWN_SQUARE, block)
    expect(ground.paved.filter((t) => before.terrain[t.y]![t.x] !== T_ROAD).length).toBeGreaterThan(100)
    // After: the block is open ground, its ring is paved, and the door opens onto the paving.
    for (const t of ground.cleared) expect(after.terrain[t.y]![t.x], `${t.x},${t.y}`).toBe(T_GRASS)
    for (const t of ground.paved) expect(after.terrain[t.y]![t.x], `${t.x},${t.y}`).toBe(T_ROAD)
    expect(after.terrain[claim.door.y]![claim.door.x]).toBe(T_ROAD)
  })

  it('★ and it really does clear: the eastern blocks stand in the wood', () => {
    // The first ring-2 block is west of the square, where the world is already meadow — so the
    // clearing half of the rule does no work there and an assertion about it would be vacuous.
    // Block (2, 0) is the one that meets the forest, and there the wood comes down.
    const s = genesisTown()
    const lay = layBlock(s, TOWN_SQUARE, { i: 2, j: 0 })
    expect(lay).not.toBe('off the map')
    const changes = lay as Array<{ from: number; reason: string }>
    expect(changes.filter((c) => c.reason === 'cleared' && c.from === T_FOREST).length).toBeGreaterThan(200)
    expect(changes.filter((c) => c.reason === 'paved').length).toBeGreaterThan(100)
  })

  it('lays the ground before it plants the roof, in that order', () => {
    const { before } = raiseUntilRing(2)
    const r = submitIntent(before, CFG, 'x', 'build', { kind: 'house' })
    const types = r.ok ? r.events.map((e) => e.type) : []
    expect(types.filter((t) => t === 'tile_changed').length).toBeGreaterThan(0)
    expect(types.lastIndexOf('tile_changed')).toBeLessThan(types.indexOf('structure_planned'))
  })

  it('costs nothing at ring 1, where genesis already laid every street', () => {
    const s = genesisTown()
    const claim = claimInWorld(s, { along: 2, deep: 2 })!
    expect(claim.rings).toBe(1)
    expect(layBlock(s, TOWN_SQUARE, claim.block)).toEqual([])
  })

  it('★ refuses loudly, in words, when the ground it needs is off the end of the array', () => {
    const full = genesisTown()
    const short: WorldState = { ...full, terrain: full.terrain.slice(0, 95) }
    const claim = claimInWorld(short, { along: 2, deep: 2 })!
    expect(layBlock(short, TOWN_SQUARE, claim.block)).toBe('off the map')
    const s = withBuilder(short, 'a', claim.door)
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' })).toEqual({
      ok: false, reason: 'the ground a house needs is past the edge of the known country',
    })
    // The same claim, on the world that does reach that far, goes up.
    const ok = withBuilder(full, 'a', claim.door)
    expect(submitIntent(ok, CFG, 'a', 'build', { kind: 'house' }).ok).toBe(true)
  })

  it('★ and the world then owes ground it did not owe before', () => {
    const genesis = genesisTown()
    const size = { w: genesis.terrain[0]!.length, h: genesis.terrain.length }
    // The roofs alone say the world owes four rows south; the ground the town has LAID says
    // seven, and the three between them are where ring 2's far street band would fall.
    expect(edgesOwed(builtBox(genesis)!, size, WORLD_MARGIN)).toEqual([{ edge: 's', owed: 4 }])
    expect(edgesOwed(owedBox(genesis)!, size, WORLD_MARGIN)).toEqual([{ edge: 's', owed: 7 }])
    expect(owedBox(genesis)!.dy1 - builtBox(genesis)!.dy1).toBe(STREET)

    const { after } = raiseUntilRing(2)
    const grown = owedBox(after)!
    expect(grown.dy1 - owedBox(genesis)!.dy1).toBe(PITCH)
    expect(edgesOwed(grown, size, WORLD_MARGIN).map((e) => e.edge)).toEqual(['e', 's'])
    expect(townGroundBox(after)!.dx1 - townGroundBox(genesis)!.dx1).toBe(PITCH)
  })
})
