import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG, MIN_SEP, PITCH, STREET, TOWN_SQUARE, T_GRASS, T_ROAD, WORLD_MARGIN,
  blockGroundOf, centreOf, dayPhaseFromTick, edgesOwed, type SimEvent, type TownClaim,
} from '@sj/shared'
import { fold } from './fold.js'
import { genesisState, type WorldState } from './state.js'
import { makeGenesisWorld, GENESIS_BUILDER_ID, GENESIS_FORD } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { makeFixtureMap } from './scripted.js'
import {
  buildIsPlotted, buildSiteOf, groundForBuilding, handsOnSite, isAdjacentToRect, isPlottedKind,
  stepBuild, workPenalty,
} from './verbs.js'
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

/** The site as the engine reports it: the plot's rectangle, plus the facing when — and only
 *  when — the plot turned the building. Absent is `sw`. */
const seatedAs = (claim: TownClaim): Record<string, unknown> =>
  ({ ...claim.site, ...(claim.facing === 'sw' ? {} : { facing: claim.facing }) })

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
        // The FACING is part of the site now, and it does not move either: the plot decides
        // which way the house is turned, and no coordinate a mind names changes that.
        expect(buildSiteOf(s, CFG, 'a', { kind: 'house', x, y }).site).toEqual(seatedAs(claim))
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

// ★ THE PROSE NAMES ONE TILE FOR EVERY KIND, AND THERE ARE THREE ROOFS TO RAISE NOW.
// `groundForBuilding` answers with a 1x1 claim's door; a cottage and a farmhouse claim the same
// PLOT but present a different frontage, so their own door tile is one row further south. A
// mind told a tile that then refuses it is exactly the wasted act this lane exists to kill, so
// the tile is asserted to work for every buildable roof rather than assumed to.
describe('the one tile the prose names works for every roof a mind can raise', () => {
  it('accepts a house, a cottage and a farmhouse from the tile groundForBuilding gives', () => {
    const base = genesisTown()
    const told = groundForBuilding(base)!
    for (const [kind, wood] of [['house', 10], ['cottage', 15], ['farmhouse', 20]] as const) {
      const s = withBuilder(base, `b_${kind}`, told, wood)
      const r = submitIntent(s, CFG, `b_${kind}`, 'build', { kind })
      expect(r.ok, `${kind}: ${r.ok ? '' : r.reason}`).toBe(true)
    }
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
    expect(isPlottedKind(CFG, 'bridge')).toBe(false)
    expect(buildIsPlotted(s, CFG, 'bridge')).toBe(false)
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
    expect(buildIsPlotted(s, CFG, 'house')).toBe(false)
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
    expect(buildSiteOf(s, CFG, 'a', { kind: 'house' }).site).toEqual(seatedAs(claim))
  })
})

// ★ OD22. `ownSite` is keyed on the BUILDER, so before this the town handed the second body a
// different plot and five bodies raised five houses. The meadow never lost the behaviour —
// `siteAt` is keyed on the ground — so the only joint-build coverage in the tree passed
// throughout. Everything below asks the question of a TOWN.
describe('★ two bodies raise one building — the second pair of hands joins the walls', () => {
  /** The plot's north-west shoulder: within reach of the walls, and NOT the door tile, so what
   *  these prove is reach rather than a shared tile. */
  const shoulderOf = (claim: TownClaim) => ({ x: claim.site.x - 1, y: claim.site.y - 1 })
  /** The other three corners of the ring around a 2×2 plot. */
  const cornersOf = (c: TownClaim) => [
    { x: c.site.x + c.site.w, y: c.site.y - 1 },
    { x: c.site.x - 1, y: c.site.y + c.site.h },
    { x: c.site.x + c.site.w, y: c.site.y + c.site.h },
  ]

  // ★ THE WALLS THESE HANDS RAISED, and not the seven the founding valley now stands roofless
  // of its own accord. `builtBy` is the whole of the difference: genesis signs its own work.
  const sitesIn = (s: WorldState) => Object.values(s.structures)
    .filter((x) => x.stage === 'construction' && x.builtBy !== GENESIS_BUILDER_ID)
  const woodOf = (s: WorldState, id: string) => Object.values(s.items)
    .filter((i) => i.kind === 'wood' && i.loc.t === 'agent' && i.loc.id === id)
    .reduce((n, i) => n + i.qty, 0)

  /** Put a body's hands on a house, through the real verb, and keep the activity. */
  function raising(s: WorldState, id: string): WorldState {
    const r = submitIntent(s, CFG, id, 'build', { kind: 'house' })
    expect(r.ok, r.ok ? '' : `${id}: ${r.reason}`).toBe(true)
    return apply(s, r.ok ? r.events : [])
  }

  /** `a` has begun a house on the town's next plot; `b` is standing beside the same walls. */
  function aWallAndTwoBodies(bWood = 10): { s: WorldState; claim: TownClaim } {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    let s = withBuilder(base, 'a', claim.door)
    s = withBuilder(s, 'b', shoulderOf(claim), bWood)
    return { s: raising(s, 'a'), claim }
  }

  it('★ the second body is not handed a different plot', () => {
    const { s, claim } = aWallAndTwoBodies()
    // NON-VACUITY: `b` really is beside the first body's walls, and the town really does have
    // somewhere else it would rather send it.
    expect(isAdjacentToRect(s.agents.b!.x, s.agents.b!.y, claim.site)).toBe(true)
    expect(shoulderOf(claim)).not.toEqual(claim.door)
    expect(claimInWorld(s, { along: 2, deep: 2 })!.site).not.toEqual(claim.site)

    const after = raising(s, 'b')
    expect(sitesIn(after)).toHaveLength(1)
    expect(sitesIn(after)[0]!.builtBy).toBe('a')
    expect(buildSiteOf(s, CFG, 'b', { kind: 'house' }).site).toEqual(seatedAs(claim))
  })

  it('★ AND THE WALLS GO UP TWICE AS FAST — two hands, one tick, two ticks of progress', () => {
    const { s } = aWallAndTwoBodies()
    const joined = raising(s, 'b')
    const site = sitesIn(joined)[0]!
    expect(apply(joined, [...stepBuild(joined, CFG, 'a'), ...stepBuild(joined, CFG, 'b')])
      .structures[site.id]!.progressTicks).toBe(site.progressTicks + 2)
    // One hand alone gives one, which is the number the other half of this claim rests on.
    expect(apply(joined, stepBuild(joined, CFG, 'a'))
      .structures[site.id]!.progressTicks).toBe(site.progressTicks + 1)
  })

  it('★ THE JOINER PAYS NOTHING TWICE — no second pile, no second plot, no second plan', () => {
    const { s } = aWallAndTwoBodies()
    const r = submitIntent(s, CFG, 'b', 'build', { kind: 'house' })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const events = r.ok ? r.events : []
    expect(events.map((e) => e.type).filter((t) => t !== 'action_started')).toEqual([])
    const after = apply(s, events)
    expect(woodOf(after, 'b')).toBe(10)
    // The plot the town was keeping is still on offer to whoever comes next.
    expect(claimInWorld(after, { along: 2, deep: 2 })!.site)
      .toEqual(claimInWorld(s, { along: 2, deep: 2 })!.site)
  })

  it('★ five pairs of hands, one house — the number `minHands` was always counting', () => {
    const base = genesisTown()
    const claim = claimInWorld(base, { along: 2, deep: 2 })!
    let s = raising(withBuilder(base, 'h0', claim.door), 'h0')
    const spots = [shoulderOf(claim), ...cornersOf(claim)]
    for (const [i, at] of spots.entries()) s = raising(withBuilder(s, `h${i + 1}`, at), `h${i + 1}`)
    expect(sitesIn(s)).toHaveLength(1)
    const site = sitesIn(s)[0]!
    const hands = ['h0', 'h1', 'h2', 'h3', 'h4']
    const next = apply(s, hands.flatMap((id) => stepBuild(s, CFG, id)))
    expect(next.structures[site.id]!.progressTicks).toBe(site.progressTicks + hands.length)
  })

  it('★ a body across town is still sent to its own ground — joining is a fact about REACH', () => {
    const { s, claim } = aWallAndTwoBodies()
    const far = withBuilder(s, 'c', { x: TOWN_SQUARE.x + 7, y: TOWN_SQUARE.y + 7 })
    expect(isAdjacentToRect(far.agents.c!.x, far.agents.c!.y, claim.site)).toBe(false)
    expect(buildSiteOf(far, CFG, 'c', { kind: 'house' }).resume).toBeNull()
    expect(submitIntent(far, CFG, 'c', 'build', { kind: 'house' })).toEqual({
      ok: false,
      reason: expect.stringContaining('the town keeps ground for a house'),
    })
  })

  it('other walls are not these walls: a well is not joined to a half-built house', () => {
    const { s } = aWallAndTwoBodies()
    expect(buildSiteOf(s, CFG, 'b', { kind: 'well' }).resume).toBeNull()
  })

  it('★ finished walls are not a site: a body beside a standing house still gets its own ground', () => {
    // The valley's own houses stand roofless now, so this test puts a roof on one: the claim is
    // about a FINISHED building, and there has to be one for it to be about anything.
    const roofless = Object.values(genesisTown().structures)
      .find((x) => x.kind === 'house' && x.stage === 'construction')!
    const base = apply(genesisTown(), [{ type: 'structure_completed', payload: { id: roofless.id } }])
    const done = base.structures[roofless.id]!
    expect(done.stage).toBe('complete')
    const s = withBuilder(base, 'd', { x: done.x - 1, y: done.y - 1 })
    expect(isAdjacentToRect(s.agents.d!.x, s.agents.d!.y, done)).toBe(true)
    const ans = buildSiteOf(s, CFG, 'd', { kind: 'house' })
    expect(ans.resume).toBeNull()
    expect(ans.site).not.toMatchObject({ x: done.x, y: done.y })
    // A roof already up is not a job, so this body is still sent to the plot the town keeps.
    expect(submitIntent(s, CFG, 'd', 'build', { kind: 'house' })).toEqual({
      ok: false,
      reason: expect.stringContaining('the town keeps ground for a house'),
    })
  })

  it('★ and there is never a choice of walls: no tile in the town reaches two of them', () => {
    let s = genesisTown()
    for (let i = 0; i < 8; i++) {
      const claim = claimInWorld(s, { along: 2, deep: 2 })!
      s = raising(withBuilder(s, `b${i}`, claim.door), `b${i}`)
    }
    const open = sitesIn(s)
    expect(open).toHaveLength(8)
    // Every tile of the world, against every half-raised roof in it.
    let mostInReach = 0
    for (let y = 0; y < s.terrain.length; y++)
      for (let x = 0; x < s.terrain[0]!.length; x++)
        mostInReach = Math.max(mostInReach, open.filter((r) => isAdjacentToRect(x, y, r)).length)
    expect(mostInReach).toBe(1)
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

// ★ THE WORLD COUNTS HANDS AND CANNOT SPEND THEM. Everything above proves the hands land on
// one set of walls; nothing above asks what the walls got for them. Measured over 4 320
// showcase ticks by the lane that wired joining: 29 roofs with one pair of hands, 16 with
// five, 293 body-ticks per roof against 591. A joiner's own clock is set at intent time to
// `buildTicks − progressTicks` and counts down one a tick whatever else is happening, so five
// hands finish on the same tick one hand would and the site's ledger races past what the
// building needs. Below, the two halves of that, and the night overshoot underneath them.
describe('★ help must help — what a second pair of hands buys the calendar', () => {
  const HOUSE_TICKS = 120
  const FAST = {
    ...DEFAULT_CONFIG,
    construction: { ...DEFAULT_CONFIG.construction, houseTicks: HOUSE_TICKS },
  }
  // Tick 0 is midnight, so a run left at genesis measures the night penalty by accident.
  const NOON = 12 * 60
  const NIGHT = 22 * 60

  const foldWith = (
    s: WorldState, events: ReadonlyArray<{ type: string; payload: unknown }>, tick = 0,
  ): WorldState =>
    events.reduce((acc, e) =>
      fold(acc, { seq: ++seq, tick, type: e.type, payload: e.payload } as unknown as SimEvent, FAST), s)

  const ringOf = (c: TownClaim) => [
    { x: c.site.x - 1, y: c.site.y - 1 },
    { x: c.site.x + c.site.w, y: c.site.y - 1 },
    { x: c.site.x - 1, y: c.site.y + c.site.h },
    { x: c.site.x + c.site.w, y: c.site.y + c.site.h },
  ]

  /** A town, its next plot, and `n` bodies with wood standing round it — the planter on the
   *  door tile, the joiners on the corners. Nobody has started yet. */
  function crewOf(n: number, atTick = NOON): { s: WorldState; ids: string[] } {
    const g = makeGenesisWorld(FAST)
    let s = foldWith(genesisState(FAST, g.terrain), g.events)
    s = { ...s, tick: atTick }
    const claim = claimInWorld(s, { along: 2, deep: 2 })!
    const spots = [claim.door, ...ringOf(claim)]
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const id = `h${i}`
      ids.push(id)
      s = foldWith(s, [
        { type: 'agent_spawned', payload: { id, name: id, x: spots[i]!.x, y: spots[i]!.y, ageDays: 10000 } },
        { type: 'item_spawned', payload: { id: `wood_${id}`, kind: 'wood', qty: 10, loc: { t: 'agent', id } } },
      ], atTick)
    }
    return { s, ids }
  }

  /** `actionsSystem`'s build branch and nothing else — no needs, no weather, no walking — run
   *  until every one of these bodies has stopped working. `ticks` is the CALENDAR: how long
   *  the town waited. `bodyTicks` is the wage: how much of somebody's life it cost. */
  function raise(s0: WorldState, ids: readonly string[], cap = 4000) {
    let s = s0
    let ticks = 0
    let bodyTicks = 0
    for (const id of [...ids].sort()) {
      const r = submitIntent(s, FAST, id, 'build', { kind: 'house' })
      expect(r.ok, r.ok ? '' : `${id}: ${r.reason}`).toBe(true)
      s = foldWith(s, r.ok ? r.events : [], s.tick)
    }
    for (let t = 1; t <= cap; t++) {
      let worked = false
      for (const id of [...ids].sort()) {
        const act = s.agents[id]!.activity
        if (!act || act.verb !== 'build') continue
        worked = true
        bodyTicks++
        s = foldWith(s, stepBuild(s, FAST, id), s.tick)
        const now = s.agents[id]!.activity
        if (!now || now.ticksRemaining > 0) continue
        s = foldWith(s, [{ type: 'action_completed', payload: { agentId: id, verb: 'build' } }], s.tick)
        const resume = buildSiteOf(s, FAST, id, { kind: 'house' }).resume
        if (resume) s = foldWith(s, [{ type: 'structure_completed', payload: { id: resume.id } }], s.tick)
      }
      if (!worked) break
      ticks = t
    }
    const roofs = Object.values(s.structures).filter((x) => x.kind === 'house' && x.stage === 'complete')
    return { s, ticks, bodyTicks, raised: roofs.at(-1)! }
  }

  it('one pair of hands takes the whole of what the recipe asks for', () => {
    const { s, ids } = crewOf(1)
    const run = raise(s, ids)
    expect(run.ticks).toBe(HOUSE_TICKS)
    expect(run.bodyTicks).toBe(HOUSE_TICKS)
  })

  it('★ TWO PAIRS OF HANDS RAISE IT IN HALF THE TIME, AND FIVE IN A FIFTH', () => {
    for (const [hands, calendar] of [[2, HOUSE_TICKS / 2], [4, HOUSE_TICKS / 4], [5, HOUSE_TICKS / 5]] as const) {
      const { s, ids } = crewOf(hands)
      const run = raise(s, ids)
      expect(Object.values(run.s.structures)
        .filter((x) => x.stage === 'construction' && x.builtBy !== GENESIS_BUILDER_ID), `${hands}`).toEqual([])
      expect(run.ticks, `${hands} hands`).toBe(calendar)
    }
  })

  it('★ and the help is free — the same body-ticks buy the same roof', () => {
    // The other half of the ruling. Hands that halved the calendar and doubled the wage would
    // be a different lie: the point is that a joiner's tick is worth exactly a planter's.
    for (const hands of [1, 2, 4, 5]) {
      const { s, ids } = crewOf(hands)
      expect(raise(s, ids).bodyTicks, `${hands} hands`).toBe(HOUSE_TICKS)
    }
  })

  it('★ the site\'s ledger stops at the work the building needs, however many hands', () => {
    for (const hands of [1, 2, 4, 5]) {
      const { s, ids } = crewOf(hands)
      const pt = raise(s, ids).raised.progressTicks
      expect(pt, `${hands} hands`).toBeLessThanOrEqual(HOUSE_TICKS)
      // Short of the target by at most one tick per extra hand, and for a reason worth
      // knowing: `actionsSystem` steps and then completes ONE BODY AT A TIME, so the first
      // hand whose clock runs out finishes the walls before the rest have worked that tick.
      expect(pt, `${hands} hands`).toBeGreaterThan(HOUSE_TICKS - hands)
    }
  })

  /** Put a crew on the town's NEXT free plot and start every one of them building. */
  function alsoRaising(s0: WorldState, n: number, prefix: string): { s: WorldState; ids: string[] } {
    let s = s0
    const claim = claimInWorld(s, { along: 2, deep: 2 })!
    const spots = [claim.door, ...ringOf(claim)]
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const id = `${prefix}${i}`
      ids.push(id)
      s = foldWith(s, [
        { type: 'agent_spawned', payload: { id, name: id, x: spots[i]!.x, y: spots[i]!.y, ageDays: 10000 } },
        { type: 'item_spawned', payload: { id: `wood_${id}`, kind: 'wood', qty: 10, loc: { t: 'agent', id } } },
      ], s.tick)
    }
    for (const id of ids) {
      const r = submitIntent(s, FAST, id, 'build', { kind: 'house' })
      expect(r.ok, r.ok ? '' : `${id}: ${r.reason}`).toBe(true)
      s = foldWith(s, r.ok ? r.events : [], s.tick)
    }
    return { s, ids }
  }

  it('★ the hands are counted per SITE, not per town', () => {
    // Two crews of two, one street apart. Without this, a rate read off "everybody who is
    // building" would make four hands of two and finish both houses twice as fast.
    const two = alsoRaising(crewOf(0).s, 2, 'h')
    const four = alsoRaising(two.s, 2, 'k')
    const sites = Object.values(four.s.structures)
      .filter((x) => x.stage === 'construction' && x.builtBy !== GENESIS_BUILDER_ID)
    expect(sites).toHaveLength(2)
    for (const site of sites) expect(handsOnSite(four.s, site.id), site.id).toBe(2)
  })

  it('a body that has died is not a pair of hands', () => {
    const { s, ids } = alsoRaising(crewOf(0).s, 2, 'h')
    const site = Object.values(s.structures)
      .find((x) => x.stage === 'construction' && x.builtBy !== GENESIS_BUILDER_ID)!
    expect(handsOnSite(s, site.id)).toBe(2)
    const after = foldWith(s, [{ type: 'agent_died', payload: { agentId: ids[1]!, cause: 'hunger' } }], s.tick)
    expect(handsOnSite(after, site.id)).toBe(1)
  })

  // ★ THE SECOND BUG, WHICH WAS THERE BEFORE THE FIRST AND NEEDS ONLY ONE BUILDER.
  // `submitIntent` multiplies a night builder's duration by `light.nightWorkPenalty` while
  // `structure_progressed` still adds one a tick, so the ledger runs half again past what the
  // building needs. G2's own pinned world books 2 903 ticks of work into a 2 880-tick house.
  describe('and the dark charges the clock, not the ledger', () => {
    it('a house raised blind still takes half again as long', () => {
      const { s, ids } = crewOf(1, NIGHT)
      expect(dayPhaseFromTick(NIGHT)).toBe('night')
      expect(workPenalty(s, FAST, 'h0', 'build')).toBe(FAST.light.nightWorkPenalty)
      expect(raise(s, ids).ticks).toBe(Math.ceil(HOUSE_TICKS * FAST.light.nightWorkPenalty))
    })

    it('★ but the walls never record more work than a house is', () => {
      const { s, ids } = crewOf(1, NIGHT)
      expect(raise(s, ids).raised.progressTicks).toBe(HOUSE_TICKS)
    })

    it('★ so a night build that stops halfway never resumes on a negative clock', () => {
      const { s } = crewOf(1, NIGHT)
      const r = submitIntent(s, FAST, 'h0', 'build', { kind: 'house' })
      let w = foldWith(s, r.ok ? r.events : [], NIGHT)
      for (let t = 0; t < HOUSE_TICKS + 20; t++) w = foldWith(w, stepBuild(w, FAST, 'h0'), NIGHT)
      w = foldWith(w, [{ type: 'action_interrupted', payload: { agentId: 'h0', reason: 'rest' } }], NIGHT)
      const site = Object.values(w.structures).find((x) => x.stage === 'construction')!
      expect(site.progressTicks).toBeLessThanOrEqual(HOUSE_TICKS)
      const again = submitIntent({ ...w, tick: NOON }, FAST, 'h0', 'build', { kind: 'house' })
      expect(again.ok, again.ok ? '' : again.reason).toBe(true)
      const started = again.ok ? again.events.find((e) => e.type === 'action_started')! : null
      // Zero, not negative: the walls are up, and going back to them finishes them.
      expect((started!.payload as { duration: number }).duration).toBeGreaterThanOrEqual(0)
      let z = foldWith({ ...w, tick: NOON }, again.ok ? again.events : [], NOON)
      z = foldWith(z, stepBuild(z, FAST, 'h0'), NOON)
      expect(z.agents.h0!.activity!.ticksRemaining).toBeLessThanOrEqual(0)
      z = foldWith(z, [{ type: 'structure_completed', payload: { id: site.id } }], NOON)
      expect(z.structures[site.id]!.stage).toBe('complete')
    })
  })
})
