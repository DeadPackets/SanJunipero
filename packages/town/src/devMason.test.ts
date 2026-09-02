// @slow — the proof that something in the running app can build. Scripted masons, no LLM, $0.
// The engine locates the town by reading the authored `TOWN_SQUARE` less `state.origin`.
import { describe, expect, it } from 'vitest'
import {
  CITY_GROUND,
  TOWN_SQUARE,
  T_ROAD,
  freePlots,
  grammarOf,
  plotExtent,
  townOrigin,
} from '@sj/shared'
import {
  claimInWorld,
  fold,
  standingRects,
  submitIntent,
  townGroundOf,
  townSquareOf,
  type WorldState,
} from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import { devTownSquare, devWorldOrigin } from './devTown.js'
import { FOUNDER_ROSTER, GO_HOME_BELOW, masonIntent } from './founders.js'
import { type Run, runFoundersWorld } from './testutil.js'

const TICKS = 4320
const RINGS = 3
const GENESIS_STRUCTURES = 13

function runDevWorld(builders: boolean, rings = RINGS, ticks = TICKS, jointBuild = false): Run {
  return runFoundersWorld({ interiors: true, builders, holdings: true, jointBuild }, ticks, rings)
}

describe('★ the dev world says where its array stands, so the engine can find its town', () => {
  it('★ THE AGREEMENT: under this origin the showcase channel IS the grammar’s channel', () => {
    // The grammar knows one river, at `CITY_GROUND` dx −17…−15 off the square. Checked at every
    // ring count, which is what makes the origin a derivation and not a number that works once.
    for (const rings of [1, 2, 3, 4]) {
      const terrain = devTerrain('showcase', rings)
      const origin = devWorldOrigin(rings)
      const square = devTownSquare(rings)
      const wet: number[] = []
      for (let x = 0; x < terrain[0]!.length; x++) {
        if (terrain.some((row) => row[x] === 2)) wet.push(x + origin.x)
      }
      expect(wet, `rings=${rings}: the showcase river in the authored frame`).toEqual([48, 49, 50])
      // and the grammar agrees about the same three columns, off its own square
      for (const authored of wet)
        expect(CITY_GROUND(authored - TOWN_SQUARE.x, 0), `${authored}`).toBe('water')
      expect(square).toEqual({ x: 8 + townOrigin(rings), y: 8 + townOrigin(rings) })
    }
  })

  it('★ and the engine now finds the square the town is actually drawn around', () => {
    const rings = RINGS
    const terrain = devTerrain('showcase', rings)
    const state = devGenesisState(SHOWCASE_CONFIG, terrain, 'showcase', rings)
    expect(townSquareOf(state)).toEqual(devTownSquare(rings))
    // With no origin the engine does not fail, it ANSWERS — a paved tile ten rows north of the
    // square that is drawn. `townSquareOf` asks about the whole plaza now, so it refuses instead.
    expect(
      townSquareOf({ ...state, origin: undefined }),
      'the engine still answers about a town that is not there',
    ).toBeNull()
    expect(devTownSquare(rings)).not.toEqual({ x: TOWN_SQUARE.x, y: TOWN_SQUARE.y })
  })

  it('leaves the frozen fixture with no origin and no town, which is the truth about it', () => {
    const state = devGenesisState(SHOWCASE_CONFIG, devTerrain('scripted'), 'scripted')
    expect(state.origin).toBeUndefined()
    expect(townSquareOf(state)).toBeNull()
  })
})

describe('★ THE DEV WORLD BUILDS — houses appear on plots the town claims', () => {
  const run = runDevWorld(true)
  const raised = run.events.filter((e) => e.type === 'structure_planned' && e.tick > 1)
  const finished = run.events.filter((e) => e.type === 'structure_completed' && e.tick > 1)

  it('★ agents raise houses, through the real build verb, in a world a viewer can open', () => {
    expect(raised.length, 'nothing was built').toBeGreaterThan(20)
    expect(finished.length, 'nothing was finished').toBeGreaterThan(20)
    expect(standingRects(run.state).length).toBe(GENESIS_STRUCTURES + raised.length)
    // ★ Every one was under scaffolding for a while: a roof that appears between frames was never built.
    const planned = new Map(raised.map((e) => [String(e.payload.id), e.tick]))
    for (const e of finished) {
      const at = planned.get(String(e.payload.id))
      expect(at, `${String(e.payload.id)} completed without being planned`).toBeDefined()
      // At least the recipe's own ticks, and sometimes half again: `workPenalty` charges the
      // dark for work, so a roof begun at dusk takes 360 where one begun at noon takes 240.
      expect(e.tick - at!, 'a house went up in one tick').toBeGreaterThanOrEqual(
        SHOWCASE_CONFIG.construction.houseTicks,
      )
    }
  })

  it('★ AND NOT ONE OF THEM WAS TOLD WHERE — every build names {kind} and nothing else', () => {
    const builds = run.events.filter(
      (e) => e.type === 'action_started' && e.payload.verb === 'build',
    )
    expect(builds.length).toBeGreaterThan(20)
    for (const b of builds) {
      expect(
        Object.keys(b.payload.params as object).sort(),
        'a coordinate reached the verb',
      ).toEqual(['kind'])
    }
    // and it is a founder's hand on every one of them, not the tick-1 script's
    for (const e of raised)
      expect(FOUNDER_ROSTER.map((f) => f.id)).toContain(String(e.payload.builderId))
  })

  // "Not on water, not on a street tile" PASSES with the square ten rows out — a plot shifted by
  // a third of a block still mostly lands on grass. PLOT CONTAINMENT is what does not pass.
  it('★ and every roof the town raised sits INSIDE a plot of the lattice that is drawn', () => {
    // Read in ONE frame. A night of map growth shifts every standing thing and the square with
    // it, and a seat quoted from the plan event is a coordinate in the frame that has moved.
    const square = townSquareOf(run.state)!
    const plots = freePlots(RINGS + 2, townGroundOf(run.state, square)).map((p) => plotExtent(p))
    const tiles = new Set<string>()
    for (const e of raised) {
      const { x, y, w, h } = run.state.structures[String(e.payload.id)]!
      const g = grammarOf(square, { x, y })
      const inside = plots.some(
        (p) => p.dx <= g.dx && g.dx + w <= p.dx + p.w && p.dy <= g.dy && g.dy + h <= p.dy + p.h,
      )
      expect(inside, `the house at ${x},${y} stands on no plot of this town`).toBe(true)
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const tile = run.state.terrain[y + dy]?.[x + dx]
          expect(tile, `${x + dx},${y + dy} is water`).not.toBe(2)
          expect(tile, `${x + dx},${y + dy} is off the map`).toBeDefined()
          expect(tile, `a roof stands in the street at ${x + dx},${y + dy}`).not.toBe(T_ROAD)
          expect(tiles.has(`${x + dx},${y + dy}`), 'two roofs on one tile').toBe(false)
          tiles.add(`${x + dx},${y + dy}`)
        }
    }
  })

  it('★ and the town claims a DIFFERENT plot each time — the register is not frozen at genesis', () => {
    const seats = new Set(
      raised.map((e) => {
        const s = run.state.structures[String(e.payload.id)]!
        return `${s.x},${s.y}`
      }),
    )
    expect(seats.size).toBe(raised.length)
    // the claim still has somewhere to offer at the end, so the run did not stop for want of one
    expect(claimInWorld(run.state, { along: 2, deep: 2 })).not.toBeNull()
  })

  it('★ and the town survives building — nobody worked themselves onto the ground', () => {
    expect(run.events.filter((e) => e.type === 'agent_collapsed')).toEqual([])
    for (const f of FOUNDER_ROSTER) expect(run.state.agents[f.id]!.alive, f.id).toBe(true)
  })

  it('builders OFF is the landed world exactly — thirteen buildings and no more', () => {
    const off = runDevWorld(false, RINGS, 1440)
    expect(off.events.filter((e) => e.type === 'structure_planned' && e.tick > 1)).toEqual([])
    expect(standingRects(off.state).length).toBe(GENESIS_STRUCTURES)
  })
})

// A "with the flag off this is the landed world" row is deliberately absent: it would compare
// two runs of the same policy and pass even when the policy ignores the flag.
describe('★ TWO MASONS RAISE ONE HOUSE, in the dev world, through a real TickLoop', () => {
  const TICKS_J = 1440
  const on = runDevWorld(true, RINGS, TICKS_J, true)
  const off = runDevWorld(true, RINGS, TICKS_J, false)

  const mostHands = (r: Run): number => {
    const perTick = new Map<string, number>()
    for (const e of r.events) {
      if (e.type !== 'structure_progressed') continue
      const k = `${e.tick}:${String(e.payload.id)}`
      perTick.set(k, (perTick.get(k) ?? 0) + 1)
    }
    return Math.max(0, ...perTick.values())
  }
  const builds = (r: Run) =>
    r.events.filter((e) => e.type === 'action_started' && e.payload.verb === 'build')
  const planted = (r: Run) => r.events.filter((e) => e.type === 'structure_planned' && e.tick > 1)

  it('★ more than one pair of hands lands on one house, and they are different people', () => {
    // A build that planted nothing is a build that joined somebody.
    const joins = builds(on).length - planted(on).length
    expect(joins, 'nobody joined anybody').toBeGreaterThan(0)
    expect(mostHands(on), 'no two hands were ever on one site in one tick').toBeGreaterThanOrEqual(
      2,
    )

    expect(builds(off).length - planted(off).length).toBe(0)
    expect(mostHands(off)).toBe(1)

    // Different people, not one body counted twice: `stepBuild` emits the worker's
    // `action_progressed` immediately before the site's, so the pairing reads off the log.
    const bodiesOn = new Map<string, Set<string>>() // `${tick}:${siteId}` -> agent ids
    let worker = ''
    for (const e of on.events) {
      if (e.type === 'action_progressed') worker = String(e.payload.agentId)
      if (e.type !== 'structure_progressed') continue
      const k = `${e.tick}:${String(e.payload.id)}`
      const who = bodiesOn.get(k) ?? new Set<string>()
      who.add(worker)
      bodiesOn.set(k, who)
    }
    let peak = { key: '', who: new Set<string>() }
    for (const [k, who] of [...bodiesOn].sort())
      if (who.size > peak.who.size) peak = { key: k, who }
    expect(
      peak.who.size,
      'no site had two different bodies on it in one tick',
    ).toBeGreaterThanOrEqual(2)
    for (const id of peak.who) expect(FOUNDER_ROSTER.map((f) => f.id)).toContain(id)
    const [peakTick, peakId] = peak.key.split(':')
    expect(
      planted(on).some((e) => String(e.payload.id) === peakId),
      'the busiest site was never planned',
    ).toBe(true)
    console.log(
      `[joint-hands] showcase rings=${RINGS}, ${TICKS_J} ticks: ${joins} builds joined walls` +
        ` somebody else began; ${peak.who.size} bodies on ${peakId} at tick ${peakTick}` +
        ` (${[...peak.who].sort().join(', ')}); ${planted(on).length} roofs begun` +
        ` (${planted(off).length} with the policy off)`,
    )
  })

  it('★ and the joiner pays nothing twice — no second plan, no second plot, no roof off the lattice', () => {
    // Every roof in the world was planted exactly once, and the count of standing things is
    // the genesis eleven plus what was planted — a join adds a pair of hands, never a building.
    const ids = planted(on).map((e) => String(e.payload.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(standingRects(on.state).length).toBe(GENESIS_STRUCTURES + ids.length)
    const seats = new Set(planted(on).map((e) => `${String(e.payload.x)},${String(e.payload.y)}`))
    expect(seats.size).toBe(ids.length)
    for (const b of builds(on)) {
      expect(
        Object.keys(b.payload.params as object).sort(),
        'a coordinate reached the verb',
      ).toEqual(['kind'])
    }
  })

  it('★ the house they raised together finished, and nobody went down doing it', () => {
    const done = on.events.filter((e) => e.type === 'structure_completed' && e.tick > 1)
    expect(done.length, 'nothing was finished').toBeGreaterThan(0)
    const plannedAt = new Map(planted(on).map((e) => [String(e.payload.id), e.tick]))
    for (const e of done) {
      expect(plannedAt.get(String(e.payload.id)), 'finished without being planned').toBeDefined()
    }
    expect(on.events.filter((e) => e.type === 'agent_collapsed')).toEqual([])
    for (const f of FOUNDER_ROSTER) expect(on.state.agents[f.id]!.alive, f.id).toBe(true)
  })

  // Asked of the pure function instead: in a run a founder only decides with its hands free and
  // `homeIntent` has taken it to bed by then, so the reserve looks inert.
  describe('the mason, asked directly', () => {
    function twoAtOneSite(): WorldState {
      const cfg = SHOWCASE_CONFIG
      let n = 0
      const put = (s: WorldState, type: string, payload: unknown): WorldState =>
        fold(s, { seq: ++n, tick: 1, type, payload }, cfg)
      const body = (s: WorldState, id: string, at: { x: number; y: number }): WorldState =>
        put(
          put(s, 'agent_spawned', { id, name: id, x: at.x, y: at.y, ageDays: 7300 }),
          'item_spawned',
          { id: `item_wood_${id}`, kind: 'wood', qty: 99, loc: { t: 'agent', id } },
        )

      const base = devGenesisState(cfg, devTerrain('showcase', RINGS), 'showcase', RINGS)
      const claim = claimInWorld(base, { along: 2, deep: 2 })!
      let s = body(body(base, 'a', claim.door), 'b', { x: claim.site.x - 1, y: claim.site.y - 1 })
      const r = submitIntent(s, cfg, 'a', 'build', { kind: 'house' })
      expect(r.ok, r.ok ? '' : r.reason).toBe(true)
      for (const e of r.ok ? r.events : []) s = put(s, e.type, e.payload)
      return s
    }
    const spend = (s: WorldState, id: string, energy: number): WorldState => ({
      ...s,
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id]!, needs: { ...s.agents[id]!.needs, energy } },
      },
    })

    it('★ the DEFAULT walks away from a neighbour’s walls — this lane changed no default', () => {
      const s = twoAtOneSite()
      const next = claimInWorld(s, { along: 2, deep: 2 })!
      expect(masonIntent(s, SHOWCASE_CONFIG, 'b')).toEqual({
        verb: 'walk',
        params: { x: next.door.x, y: next.door.y },
      })
      expect(masonIntent(s, SHOWCASE_CONFIG, 'b', true)).toEqual({
        verb: 'build',
        params: { kind: 'house' },
      })
    })

    it('★ and a spent body does not take on work it cannot finish, joining or not', () => {
      const s = twoAtOneSite()
      expect(masonIntent(spend(s, 'b', 100), SHOWCASE_CONFIG, 'b', true)).toEqual({
        verb: 'build',
        params: { kind: 'house' },
      })
      expect(
        masonIntent(spend(s, 'b', GO_HOME_BELOW + 1), SHOWCASE_CONFIG, 'b', true),
        'a spent body lent hands it does not have',
      ).toBeNull()
    })
  })
})
