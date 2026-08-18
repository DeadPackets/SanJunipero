import { describe, expect, it } from 'vitest'
import { RngStreams, doorTile, fold, genesisState, makeFixtureMap } from '@sj/engine'
import type { WorldState } from '@sj/engine'
import { FOUNDER_IDS, INTERIOR_KINDS } from '@sj/shared'
import { libraryEntry } from '@sj/forge'
import { SHOWCASE_CONFIG } from './devWorld.js'
import { devTown } from './devTown.js'
import { showcaseTerrain } from './showcaseMap.js'
import {
  DEV_FAST_FORWARD_FOR_INTERIORS, FOUNDERS_HOME_ID, GO_HOME_BELOW, LEAVE_HOME_ABOVE,
  devHoldings, foundersFor, homeIntent, homeOf, makeFoundersOnTick, townStructuresFor,
} from './founders.js'

// The dev world after its first tick: five founders, six finished buildings.
function townAtTick1(): WorldState {
  let state = genesisState(SHOWCASE_CONFIG, makeFixtureMap())
  const events: Array<{ type: string; payload: unknown }> = []
  const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('founders-test'), () => state)
  onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
  return state
}

const spend = (state: WorldState, id: string, energy: number): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, needs: { ...state.agents[id]!.needs, energy } } },
})

const putAt = (state: WorldState, id: string, x: number, y: number): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, x, y } },
})

const putInside = (state: WorldState, id: string, structureId: string): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, insideId: structureId } },
})

describe('homeIntent', () => {
  const base = townAtTick1()
  const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!

  it('leaves a rested founder to the patrol', () => {
    expect(homeIntent(spend(base, 'omar', 90), 'omar')).toBeNull()
    expect(homeIntent(spend(base, 'omar', GO_HOME_BELOW), 'omar')).toBeNull()
  })

  it('walks a spent founder to the door of the one dwelling', () => {
    const s = putAt(spend(base, 'omar', 10), 'omar', 6, 32)
    expect(homeIntent(s, 'omar')).toEqual({ verb: 'walk', params: { x: door.x, y: door.y } })
  })

  it('goes in once the founder is standing at the door', () => {
    const s = putAt(spend(base, 'omar', 10), 'omar', door.x, door.y)
    expect(homeIntent(s, 'omar')).toEqual({ verb: 'enter', params: { structureId: FOUNDERS_HOME_ID } })
  })

  it('sleeps indoors, then comes out again once rested', () => {
    const inside = putInside(base, 'omar', FOUNDERS_HOME_ID)
    expect(homeIntent(spend(inside, 'omar', 10), 'omar')).toEqual({ verb: 'sleep', params: {} })
    expect(homeIntent(spend(inside, 'omar', LEAVE_HOME_ABOVE + 1), 'omar')).toEqual({ verb: 'exit', params: {} })
  })

  it('says nothing about someone who is not there', () => {
    expect(homeIntent(base, 'nobody')).toBeNull()
  })
})

describe('makeFoundersOnTick interiors switch', () => {
  const spent = (): WorldState => {
    const base = townAtTick1()
    const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
    let s = base
    for (const id of Object.keys(base.agents)) s = spend(s, id, 5)
    return putAt(s, 'omar', door.x, door.y)
  }

  // `enter` is a timed verb: the tick that accepts it emits action_started, and
  // agent_entered lands when the action completes.
  const verbsStarted = (interiors: boolean): string[] => {
    const state = spent()
    const out: string[] = []
    const onTick = makeFoundersOnTick(
      SHOWCASE_CONFIG, new RngStreams('founders-test'), () => state, { interiors },
    )
    onTick({
      tick: 2,
      emit: (type, payload) => {
        if (type !== 'action_started') return
        const p = payload as { agentId: string; verb: string }
        if (p.agentId === 'omar') out.push(p.verb)
      },
    })
    return out
  }

  it('is OFF by default — no gate\'s world folds an event it did not fold before', () => {
    expect(verbsStarted(false)).not.toContain('enter')
  })

  it('sends a spent founder through the door when it is on', () => {
    expect(verbsStarted(true)).toContain('enter')
  })
})


// ---------------------------------------------------------------- U25: five roofs, not one

const SHOWCASE_STRUCTURES = devTown().structures

// The real town at tick 1: five founders and eleven buildings, five of them owned.
function showcaseTownAtTick1(): WorldState {
  let state = genesisState(SHOWCASE_CONFIG, showcaseTerrain())
  const events: Array<{ type: string; payload: unknown }> = []
  const onTick = makeFoundersOnTick(
    SHOWCASE_CONFIG, new RngStreams('u25'), () => state, { structures: SHOWCASE_STRUCTURES },
  )
  onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
  return state
}

describe('homeOf', () => {
  const town = showcaseTownAtTick1()

  it('gives each of the five founders a different roof', () => {
    const homes = FOUNDER_IDS.map((id) => homeOf(town, id))
    for (const h of homes) expect(h).not.toBeNull()
    expect(new Set(homes.map((h) => h!.id)).size).toBe(5)
    expect(new Set(homes.map((h) => h!.kind))).toEqual(new Set(['hut']))
  })

  it('says nothing about someone who owns nothing', () => {
    expect(homeOf(town, 'nobody')).toBeNull()
  })

  it('ignores a roof that is not built yet', () => {
    const id = homeOf(town, 'amara')!.id
    const half: WorldState = {
      ...town,
      structures: { ...town.structures, [id]: { ...town.structures[id]!, stage: 'construction' } },
    }
    expect(homeOf(half, 'amara')).toBeNull()
  })
})

describe('U25 — the humans were all sleeping inside one house', () => {
  // The user's sentence, as an assertion. Every founder is kept spent so home is the only
  // errand any of them has; the run ends when all five are indoors.
  it('puts five tired founders under five different roofs', () => {
    let state = showcaseTownAtTick1()
    const onTick = makeFoundersOnTick(
      SHOWCASE_CONFIG, new RngStreams('u25'), () => state,
      { interiors: true, structures: SHOWCASE_STRUCTURES },
    )
    let seq = 1000
    for (let tick = 2; tick <= 400; tick++) {
      for (const id of FOUNDER_IDS) state = spend(state, id, 10)   // nobody rests their way out
      const evs: Array<{ type: string; payload: unknown }> = []
      onTick({ tick, emit: (type, payload) => evs.push({ type, payload }) })
      for (const e of evs) state = fold(state, { seq: ++seq, tick, ...e }, SHOWCASE_CONFIG)
      if (FOUNDER_IDS.every((id) => state.agents[id]?.insideId !== undefined)) break
    }
    const inside = FOUNDER_IDS.map((id) => state.agents[id]!.insideId)
    expect(inside.filter((i) => i !== undefined)).toHaveLength(5)
    expect(new Set(inside).size).toBe(5)
  })
})

describe('homeIntent routes an owner to their own door', () => {
  const town = showcaseTownAtTick1()

  it('walks a spent owner to their OWN door, not to a shared one', () => {
    for (const id of FOUNDER_IDS) {
      const mine = homeOf(town, id)!
      const door = doorTile(town, mine)!
      const s = putAt(spend(town, id, 10), id, door.x + 4, door.y)
      expect(homeIntent(s, id)).toEqual({ verb: 'walk', params: { x: door.x, y: door.y } })
    }
    const doors = FOUNDER_IDS.map((id) => doorTile(town, homeOf(town, id)!)!)
    expect(new Set(doors.map((d) => `${d.x},${d.y}`)).size).toBe(5)
  })

  it('enters their OWN hut from one tile away', () => {
    for (const id of FOUNDER_IDS) {
      const mine = homeOf(town, id)!
      const door = doorTile(town, mine)!
      const s = putAt(spend(town, id, 10), id, door.x, door.y)
      expect(homeIntent(s, id)).toEqual({ verb: 'enter', params: { structureId: mine.id } })
    }
  })

  it('leaves the unhoused scripted fixture exactly as it was', () => {
    const base = townAtTick1()
    const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
    const s = putAt(spend(base, 'omar', 10), 'omar', 6, 32)
    expect(homeOf(base, 'omar')).toBeNull()
    expect(homeIntent(s, 'omar')).toEqual({ verb: 'walk', params: { x: door.x, y: door.y } })
  })
})

describe('foundersFor', () => {
  const defs = foundersFor(SHOWCASE_STRUCTURES)
  const town = showcaseTownAtTick1()

  it('spawns every founder on their own doorstep', () => {
    expect(defs).toHaveLength(5)
    for (const d of defs) {
      const door = doorTile(town, homeOf(town, d.id)!)!
      expect(d.spawn).toEqual({ x: door.x, y: door.y })
    }
  })

  it('gives five distinct, walkable spawns', () => {
    const keys = defs.map((d) => `${d.spawn.x},${d.spawn.y}`)
    expect(new Set(keys).size).toBe(5)
    const terrain = showcaseTerrain()
    for (const d of defs) expect(terrain[d.spawn.y]![d.spawn.x]).not.toBe(2)   // never in the river
  })
})

describe('the interiors demo window', () => {
  it('starts before the first measured trip indoors, not after it', () => {
    // measured: first entries at ticks 820-875. 1200 lands after them, which is why the
    // controller watched from Day 0 20:00 to Day 1 03:12 and saw nobody go in.
    expect(DEV_FAST_FORWARD_FOR_INTERIORS).toBeLessThan(820)
    expect(DEV_FAST_FORWARD_FOR_INTERIORS).toBeGreaterThan(600)   // not a whole day of waiting
  })

  it('keeps home ahead of the patrol policy\'s own outdoor sleep', () => {
    expect(GO_HOME_BELOW).toBeGreaterThan(20)
    expect(LEAVE_HOME_ABOVE).toBeGreaterThan(GO_HOME_BELOW)
  })
})

// ★ THE HOLDINGS GRID HAD NEVER BEEN SEEN (batch 3 concern 2, controller ruling R4.1). The dev
// world stored ZERO items in ANY structure, so `roomCard.holds`, its icons, its cap and its
// "and N more" line were proven by unit test only and had never once rendered against data.
describe('the storerooms hold something', () => {
  /** the web card's cap — packages/web/src/ui/interiorModel.ts ROOM_HOLDS_MAX */
  const ROOM_HOLDS_MAX = 8

  /** the showcase town after its first tick, which is the town a viewer actually opens */
  function showcaseAtTick1(): WorldState {
    const structures = townStructuresFor('showcase')
    let state = genesisState(SHOWCASE_CONFIG, showcaseTerrain())
    const events: Array<{ type: string; payload: unknown }> = []
    const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('holdings-test'), () => state, {
      structures, founders: foundersFor(structures), holdings: true,
    })
    onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
    let seq = 0
    for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
    return state
  }

  const held = (state: WorldState, structureId: string) =>
    Object.values(state.items).filter((i) => i.loc.t === 'structure' && i.loc.id === structureId)

  it('THE BEFORE-STATE: the town stored nothing at all, in any building', () => {
    // the landed script emits agents and buildings and not one item, which is why a panel
    // with passing tests had never rendered against data
    expect(devHoldings([]).length).toBe(0)
    expect(Object.values(showcaseAtTick1().items).filter((i) => i.loc.t === 'structure').length)
      .toBeGreaterThan(0)   // RED against the landed script, which stores zero
  })

  it('fills the public storehouse past the card’s cap, so "and N more" is real', () => {
    const state = showcaseAtTick1()
    const store = Object.values(state.structures).find((s) => s.kind === 'storehouse')!
    expect(new Set(held(state, store.id).map((i) => i.kind)).size).toBeGreaterThan(ROOM_HOLDS_MAX)
  })

  it('puts something in every enterable room, so no room reads as empty by accident', () => {
    const state = showcaseAtTick1()
    for (const s of Object.values(state.structures)) {
      if (!(INTERIOR_KINDS as readonly string[]).includes(s.kind)) continue
      expect(held(state, s.id).length, s.id).toBeGreaterThan(0)
    }
  })

  it('marks a hut’s things as its owner’s, and leaves the public store unowned', () => {
    const state = showcaseAtTick1()
    for (const s of Object.values(state.structures)) {
      for (const it of held(state, s.id)) expect(it.owner, `${s.id}/${it.kind}`).toBe(s.owner)
    }
  })

  it('every kind it seeds is one the library can draw an icon for', () => {
    for (const h of devHoldings(townStructuresFor('showcase'))) {
      expect(libraryEntry(h.kind), h.kind).not.toBeNull()
    }
  })

  it('is deterministic, and its ids can never collide with a minted one', () => {
    const a = devHoldings(townStructuresFor('showcase'))
    const b = devHoldings(townStructuresFor('showcase'))
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    expect(new Set(a.map((h) => h.id)).size).toBe(a.length)
    // mintId hands out `<prefix>_<n>` and fold bumps the counter off a trailing number, so an
    // id ending in a digit would move the world's entity counter. A fixture must never do that.
    for (const h of a) expect(h.id, h.id).not.toMatch(/_\d+$/)
  })

  // The seed is OFF unless asked for, so every landed gate folds exactly the world it always
  // did — the scripted fixture is frozen and this is a demo town's larder, not world law.
  it('leaves the frozen scripted fixture exactly as every landed gate folded it', () => {
    expect(Object.keys(townAtTick1().items)).toEqual([])
  })
})
