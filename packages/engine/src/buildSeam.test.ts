import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MIN_SEP, TOWN_SQUARE, centreOf, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { genesisState, type WorldState } from './state.js'
import { makeGenesisWorld, GENESIS_FORD } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { makeFixtureMap } from './scripted.js'
import { buildIsPlotted, buildSiteOf, isPlottedKind } from './verbs.js'
import { claimInWorld, standingRects, townSquareOf } from './town.js'

const CFG = DEFAULT_CONFIG
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
