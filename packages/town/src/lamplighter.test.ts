// @slow — the showcase town lights its own streets through the real build and stoke verbs. A
// scripted lamplighter, not evidence that a mind wants a lit street. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import { dayPhaseFromTick, isDark, lightBandAt, T_PATH, T_ROAD } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, doorTile, isPassable, type WorldState } from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import { runFoundersWorld } from './testutil.js'
import {
  LAMP_VERGE_REACH,
  foundersFor,
  lamplighterOf,
  makeFoundersOnTick,
  townStructuresFor,
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
    store,
    state: devGenesisState(CFG, terrain, 'showcase', RINGS),
    rng,
    config: CFG,
    snapshotEveryTicks: 720,
    onTick: makeFoundersOnTick(CFG, rng, () => loop.state, {
      interiors: true,
      builders: true,
      structures,
      founders: foundersFor(structures),
      holdings: true,
      ...(lamps > 0 ? { lamps } : {}),
    }),
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return loop.state
}

const isFed = (x: { fueledUntilTick?: number }, tick: number) => (x.fueledUntilTick ?? -1) >= tick
const lampsIn = (s: WorldState) => Object.values(s.structures).filter((x) => x.kind === 'lamp_post')
const pitIn = (s: WorldState) => Object.values(s.structures).find((x) => x.kind === 'fire_pit')
const litIn = (s: WorldState) =>
  lampsIn(s).filter((l) => l.stage === 'complete' && isFed(l, s.tick))

describe('★ the lamplighter: the showcase town lights its own streets', () => {
  const lit = runShowcase(LAMPS, 1440)

  it('raises lamp posts through the real build verb, up to the count it was asked for', () => {
    const standing = lampsIn(lit)
    expect(standing.length, 'no lamp was ever raised').toBeGreaterThan(0)
    // A ceiling, not a target: a lamplighter that only asked "is this site free" would light a
    // growing town for ever. Without the `standing.size >= want` line this run stands ten.
    expect(standing.length).toBeLessThanOrEqual(LAMPS)
    for (const l of standing) expect([l.kind, l.w, l.h]).toEqual(['lamp_post', 1, 1])
    // and it built on ground the town actually offered: every post is within a verge's reach
    // of some door, which is what makes these street lamps rather than posts in a field.
    const doors = Object.values(lit.structures)
      .filter((s) => s.kind !== 'lamp_post')
      .map((s) => doorTile(lit, s))
      .filter((d) => d !== null)
    for (const l of standing) {
      const near = doors.some(
        (d) => Math.max(Math.abs(d.x - l.x), Math.abs(d.y - l.y)) <= LAMP_VERGE_REACH,
      )
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
      const ring = [
        [s.x - 1, s.y],
        [s.x + s.w, s.y],
        [s.x, s.y - 1],
        [s.x, s.y + s.h],
      ] as const
      expect(
        ring.some(([x, y]) => isPassable(lit, x, y)),
        `${s.kind} at ${s.x},${s.y} is walled in`,
      ).toBe(true)
    }
  })

  it('★ feeds them, and the ground beside a fed one is not dark at midnight', () => {
    const burning = litIn(lit)
    expect(burning.length, 'lamps stand but nobody fed one').toBeGreaterThan(0)
    const MIDNIGHT = lit.tick // day 1, 00:00 — deep night by `dayPhaseFromTick`
    expect(dayPhaseFromTick(MIDNIGHT)).toBe('night')
    // Not vacuous: one world, one instant. A town that was always bright fails the second half,
    // and a town where nothing ever lit fails the first.
    for (const l of burning) {
      expect([l.x, l.y, isDark(lit, l.x, l.y, MIDNIGHT, CFG)]).toEqual([l.x, l.y, false])
      expect(lightBandAt(lit, l.x, l.y, MIDNIGHT, CFG)).toBe('bright')
    }
    // The town is not floodlit: most of it is still dark, which is what makes a lamp worth one.
    const R = CFG.light.glowRadius.lamp_post
    let dark = 0,
      bright = 0
    for (let y = 0; y < lit.terrain.length; y += 2) {
      for (let x = 0; x < lit.terrain[y]!.length; x += 2) {
        if (isDark(lit, x, y, MIDNIGHT, CFG)) dark++
        else bright++
      }
    }
    expect(bright, 'not one tile in the town is lit').toBeGreaterThan(0)
    expect(dark / (dark + bright), 'the lamps have floodlit the valley').toBeGreaterThan(0.8)
    // and the pools are the flames' own reach, not a blanket: a tile past every lamp is dark
    const far = burning
      .map((l) => ({ x: l.x, y: l.y }))
      .map((l) => ({ x: l.x + R + 1, y: l.y }))
      .find((p) => burning.every((l) => Math.max(Math.abs(l.x - p.x), Math.abs(l.y - p.y)) > R))
    expect(far, 'every lamp overlaps another — pick a sparser town').toBeDefined()
    expect(isDark(lit, far!.x, far!.y, MIDNIGHT, CFG)).toBe(true)
  })

  // ONE three-day run through the shipped harness, read by both the tests below.
  const threeDays = (() => {
    const STOOD = 60 // a post that has stood a stoke's walk is one the rounds have had time to reach
    const completedAt = new Map<string, number>()
    const postsDark: string[] = []
    const pitDark: number[] = []
    let postTicks = 0
    let pitTicks = 0
    let pitFirstFed = -1
    const { state } = runFoundersWorld(
      { interiors: true, builders: true, holdings: true, lamps: 8 },
      4320,
      3,
      (tick, s) => {
        const posts = lampsIn(s)
        for (const l of posts) {
          if (l.stage === 'complete' && !completedAt.has(l.id)) completedAt.set(l.id, tick)
        }
        const pit = pitIn(s)
        if (pit !== undefined && pitFirstFed < 0 && (pit.fueledUntilTick ?? -1) >= tick) {
          pitFirstFed = tick
        }
        if (dayPhaseFromTick(tick) !== 'night') return
        for (const l of posts) {
          const since = completedAt.get(l.id)
          if (since === undefined || tick - since < STOOD) continue
          postTicks++
          if (!isFed(l, tick)) postsDark.push(`${l.id} at ${l.x},${l.y} tick ${tick}`)
        }
        if (pit === undefined || pitFirstFed < 0) return
        pitTicks++
        if (!isFed(pit, tick)) pitDark.push(tick)
      },
    )
    return { state, postsDark, pitDark, postTicks, pitTicks, pitFirstFed }
  })()

  it('★ keeps them lit EVERY night for the life of the town, not just the first', () => {
    expect(lampsIn(threeDays.state)).toHaveLength(8)
    // Seven of the eight posts through two full nights of 480 ticks: the square's pit shares
    // the same rounds, which stands the last post ~20 ticks later.
    expect(threeDays.postTicks, 'no post stood through a night').toBeGreaterThan(2 * 480 * 7)
    expect(threeDays.postsDark).toEqual([])
  })

  // The square's fire pit is fed daily like the lamps: one armful covers the whole coming night.
  it('★ feeds the square fire pit too, and it is lit at every night tick', () => {
    // Nobody can feed a fire they have not walked to: the first armful lands in the first half hour.
    expect(threeDays.pitFirstFed).toBeGreaterThan(0)
    expect(threeDays.pitFirstFed).toBeLessThan(30)
    expect(threeDays.pitTicks, 'the pit stood through no night').toBeGreaterThan(3 * 400)
    expect(threeDays.pitDark).toEqual([])
    // ★ VACUOUS GUARD: with no lamplighter on the rounds nobody feeds it, and it never lights.
    const unlit = runFoundersWorld({ interiors: true, builders: true, holdings: true }, 1440, 3)
    expect(pitIn(unlit.state)?.fueledUntilTick).toBeUndefined()
  }, 120_000)

  it('★ keeps one tile between posts, so every post has a side to be fed from', () => {
    const posts = lampsIn(lit)
    for (const [i, a] of posts.entries()) {
      for (const b of posts.slice(i + 1)) {
        expect(
          Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
          `posts ${a.id} and ${b.id} touch`,
        ).toBeGreaterThan(1)
      }
    }
  })

  it('is OFF unless asked for: the same town with no lamplighter raises none', () => {
    // Every landed gate calls `makeFoundersOnTick` without `lamps`; without this the opt-in is a claim.
    expect(lampsIn(runShowcase(0, 1440))).toEqual([])
  }, 120_000)

  it('names its lamplighter deterministically, and never the bridgewright', () => {
    const cast = foundersFor(townStructuresFor('showcase', RINGS))
    expect(lamplighterOf(cast)).toBe(cast.at(-1)!.id)
    expect(lamplighterOf(cast)).not.toBe(cast[0]!.id) // the wright is the first
    expect(lamplighterOf([])).toBeNull()
  })
})
