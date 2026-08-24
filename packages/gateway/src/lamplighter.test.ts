// @slow — THE PROOF THAT SOMETHING IN THE RUNNING APP CAN LIGHT A STREET.
//
// A scripted lamplighter, declared as one in `founders.ts`, exactly as the mason and the
// bridgewright are. It is NOT evidence that a mind wants a lit street — that is C8's to answer.
// It is evidence that the seam works end to end in the app a viewer actually opens: the same
// `build` verb, the same `stoke` verb, the same refusals, and `isDark` telling the truth about
// the result. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import { dayPhaseFromTick, isDark, lightBandAt, T_PATH, T_ROAD } from '@sj/shared'
import {
  EventStore, RngStreams, TickLoop, doorTile, isPassable, openDb, type WorldState,
} from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import {
  LAMP_VERGE_REACH, foundersFor, lamplighterOf, makeFoundersOnTick, townStructuresFor,
} from './founders.js'

const RINGS = 1
const CFG = SHOWCASE_CONFIG
const LAMPS = 6

function runShowcase(lamps: number, ticks: number): WorldState {
  const terrain = devTerrain('showcase', RINGS)
  const structures = townStructuresFor('showcase', RINGS)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('lamplighter')
  const loop: TickLoop = new TickLoop({
    store, state: devGenesisState(CFG, terrain, 'showcase', RINGS), rng, config: CFG,
    snapshotEveryTicks: 720,
    onTick: makeFoundersOnTick(CFG, rng, () => loop.state, {
      interiors: true, builders: true, structures, founders: foundersFor(structures),
      holdings: true, ...(lamps > 0 ? { lamps } : {}),
    }),
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return loop.state
}

const lampsIn = (s: WorldState) => Object.values(s.structures).filter((x) => x.kind === 'lamp_post')
const litIn = (s: WorldState) => lampsIn(s)
  .filter((l) => l.stage === 'complete' && (l.fueledUntilTick ?? -1) >= s.tick)

describe('★ the lamplighter: the showcase town lights its own streets', () => {
  const lit = runShowcase(LAMPS, 1440)

  it('raises lamp posts through the real build verb, up to the count it was asked for', () => {
    const standing = lampsIn(lit)
    expect(standing.length, 'no lamp was ever raised').toBeGreaterThan(0)
    // ★ A CEILING, NOT A TARGET. The masons keep raising houses, every new door offers a new
    // site, and a lamplighter that only asked "is this site free" would light a growing town
    // forever. Without the `standing.size >= want` line this run stands ten.
    expect(standing.length).toBeLessThanOrEqual(LAMPS)
    for (const l of standing) expect([l.kind, l.w, l.h]).toEqual(['lamp_post', 1, 1])
    // and it built on ground the town actually offered: every post is within a verge's reach
    // of some door, which is what makes these street lamps rather than posts in a field.
    const doors = Object.values(lit.structures).filter((s) => s.kind !== 'lamp_post')
      .map((s) => doorTile(lit, s)).filter((d) => d !== null)
    for (const l of standing) {
      const near = doors.some((d) => Math.max(Math.abs(d!.x - l.x), Math.abs(d!.y - l.y)) <= LAMP_VERGE_REACH)
      expect(near, `the lamp at ${l.x},${l.y} is beside no door in the town`).toBe(true)
    }
  })

  it('★ never closes a street: not one post stands on a road or a path tile', () => {
    for (const l of lampsIn(lit)) {
      expect([l.x, l.y, lit.terrain[l.y]?.[l.x]]).not.toEqual([l.x, l.y, T_ROAD])
      expect([l.x, l.y, lit.terrain[l.y]?.[l.x]]).not.toEqual([l.x, l.y, T_PATH])
    }
    // and every door in the town is still a tile a body can stand on
    for (const s of Object.values(lit.structures)) {
      if (s.kind === 'lamp_post') continue
      const ring = [[s.x - 1, s.y], [s.x + s.w, s.y], [s.x, s.y - 1], [s.x, s.y + s.h]] as const
      expect(ring.some(([x, y]) => isPassable(lit, x, y)), `${s.kind} at ${s.x},${s.y} is walled in`).toBe(true)
    }
  })

  it('★ feeds them, and the ground beside a fed one is not dark at midnight', () => {
    const burning = litIn(lit)
    expect(burning.length, 'lamps stand but nobody fed one').toBeGreaterThan(0)
    const MIDNIGHT = lit.tick     // day 1, 00:00 — deep night by `dayPhaseFromTick`
    expect(dayPhaseFromTick(MIDNIGHT)).toBe('night')
    // ★ THE PAIR, AND WHY THIS IS NOT VACUOUS: one world, one instant, tiles that are lit and
    // tiles that are not. A town where everything was always bright fails the second half, and
    // a town where nothing ever lit fails the first.
    for (const l of burning) {
      expect([l.x, l.y, isDark(lit, l.x, l.y, MIDNIGHT, CFG)]).toEqual([l.x, l.y, false])
      expect(lightBandAt(lit, l.x, l.y, MIDNIGHT, CFG)).toBe('bright')
    }
    // The town is not floodlit: most of it is still dark, which is what makes a lamp worth one.
    const R = CFG.light.glowRadius.lamp_post
    let dark = 0, bright = 0
    for (let y = 0; y < lit.terrain.length; y += 2) {
      for (let x = 0; x < lit.terrain[y]!.length; x += 2) {
        if (isDark(lit, x, y, MIDNIGHT, CFG)) dark++
        else bright++
      }
    }
    expect(bright, 'not one tile in the town is lit').toBeGreaterThan(0)
    expect(dark / (dark + bright), 'the lamps have floodlit the valley').toBeGreaterThan(0.8)
    // and the pools are the flames' own reach, not a blanket: a tile past every lamp is dark
    const far = burning.map((l) => ({ x: l.x, y: l.y })).map((l) => ({ x: l.x + R + 1, y: l.y }))
      .find((p) => burning.every((l) => Math.max(Math.abs(l.x - p.x), Math.abs(l.y - p.y)) > R))
    expect(far, 'every lamp overlaps another — pick a sparser town').toBeDefined()
    expect(isDark(lit, far!.x, far!.y, MIDNIGHT, CFG)).toBe(true)
  })

  it('is OFF unless asked for: the same town with no lamplighter raises none', () => {
    // The whole opt-in. Every landed gate calls `makeFoundersOnTick` without `lamps` and folds
    // exactly the events it always did; without this line the opt-in is a claim.
    expect(lampsIn(runShowcase(0, 1440))).toEqual([])
  })

  it('names its lamplighter deterministically, and never the bridgewright', () => {
    const cast = foundersFor(townStructuresFor('showcase', RINGS))
    expect(lamplighterOf(cast)).toBe(cast.at(-1)!.id)
    expect(lamplighterOf(cast)).not.toBe(cast[0]!.id)   // the wright is the first
    expect(lamplighterOf([])).toBeNull()
  })
})
