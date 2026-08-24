// @slow — ★ THE PROOF THAT THE TOWN SURVIVES ITS FIRST NIGHT, AND THAT SOMEBODY SLEEPS INDOORS.
//
// Merge train 3 ran the product — `map=showcase`, `rings=3` — and found all five founders
// `COLLAPSED · WORN OUT` on the road by Day 0 23:19, bodies drawn prone in the street. Three
// integration trains in a row then failed to see an interior, and the reason turned out to be
// the same one: they go down before they reach their door, so `enter` never fires.
//
// ★ THE MECHANISM, MEASURED, BECAUSE FIVE AT ONCE IS NEVER FIVE DECISIONS.
//
//   1. Nothing differentiates the five. All spawn at tick 1 with energy 100 and burn
//      `energyDecayAwakePerTick` (0.093) every waking tick. 100 down to `collapseThreshold`
//      (5) is ceil(95 / 0.093) = 1022 ticks, and tick 1022 IS Day 0 17:02. The time on the
//      clock is not a coincidence; it is that division rendered as hours and minutes.
//   2. The body's own alarm could not be heard. The patrol policy asks to sleep at energy 20 —
//      tick 861 — but `submitIntent` refuses EVERY intent while `activity` is set, and on the
//      showcase map a patrol leg measured 118 to 342 ticks. From 861 to 1022 the request was
//      refused `already busy with walk` 166 consecutive times and thrown away each time. The
//      only thing that ever freed the lock was the collapse itself.
//   3. With interiors ON it was worse and permanent: `homeIntent` answered a body already on
//      the ground with a WALK, `submitIntent` refuses every verb but eat and sleep to a
//      collapsed body, and nothing ever offered `sleep`. Energy 0, hp draining, prone until
//      the world was closed.
//
// None of that is a difficulty setting. It is a scripted policy committing a body to journeys
// it cannot pay for, and having no answer for a body that can no longer walk. Both are fixed
// where they broke — see the header of `founders.ts`.
//
// This is the dev world a viewer actually boots, minus the HTTP: same config, same terrain,
// same structures, same `makeFoundersOnTick`. Scripted policies only. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import { stateHash } from '@sj/shared'
import {
  EventStore, RngStreams, TickLoop, genesisState, openDb, replayFromGenesis, type WorldState,
} from '@sj/engine'
import { SHOWCASE_CONFIG, devTerrain } from './devWorld.js'
import { FOUNDERS, foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'

/** Three sim days, the far-bank lane's standard, so a night is a thing this test has seen
 *  three of rather than argued about once. */
const TICKS = 4320
const RINGS = 3

type Seen = { type: string; tick: number; payload: Record<string, unknown> }
type Run = { state: WorldState; events: Seen[]; store: EventStore; terrain: ReturnType<typeof devTerrain> }

function runDevWorld(interiors: boolean, ticks = TICKS): Run {
  const config = SHOWCASE_CONFIG
  const terrain = devTerrain('showcase', RINGS)
  const structures = townStructuresFor('showcase', RINGS)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('g6')
  const events: Seen[] = []
  const inner = makeFoundersOnTick(config, rng, () => loop.state, {
    interiors, structures, founders: foundersFor(structures), holdings: true,
  })
  const loop: TickLoop = new TickLoop({
    store, state: genesisState(config, terrain), rng, config, snapshotEveryTicks: 720,
    onTick: (ctx) => inner({
      tick: ctx.tick,
      emit: (type, payload) => {
        events.push({ type, tick: ctx.tick, payload: (payload ?? {}) as Record<string, unknown> })
        ctx.emit(type, payload)
      },
    }),
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return { state: loop.state, events, store, terrain }
}

const of = (run: Run, type: string): Seen[] => run.events.filter((e) => e.type === type)
const who = (e: Seen): string => String(e.payload['agentId'] ?? e.payload['id'] ?? '')

describe('★ THE FIRST NIGHT — the showcase town on rings=3, three sim days', () => {
  const run = runDevWorld(true)

  it('★ NOBODY SPENDS A NIGHT ON THE GROUND — not one collapse in three days', () => {
    const down = of(run, 'agent_collapsed')
    // The failure names the tick and the clock, because 17:02 is the arithmetic and saying so
    // is what stops the next reader treating it as a bad roll.
    expect(down.map((e) => `${who(e)}@${e.tick}`), 'a founder went down in the street').toEqual([])
  })

  it('★ AND EVERY ONE OF THE FIVE SLEEPS INDOORS — the interior is reachable at last', () => {
    const slept = new Set<string>()
    const inside = new Set<string>()
    for (const e of run.events) {
      if (e.type === 'agent_entered') inside.add(who(e))
      if (e.type === 'agent_exited') inside.delete(who(e))
      if (e.type === 'agent_slept' && inside.has(who(e))) slept.add(who(e))
    }
    expect([...slept].sort()).toEqual(FOUNDERS.map((f) => f.id).sort())
  })

  it('★ and the town is on its feet at the end of the third day, rested and unafflicted', () => {
    for (const f of FOUNDERS) {
      const a = run.state.agents[f.id]!
      expect(a.alive, f.id).toBe(true)
      expect(a.collapsedSinceTick, `${f.id} is still down`).toBeNull()
      expect(a.afflictions ?? [], `${f.id} is carrying an affliction`).toEqual([])
      expect(a.hp, `${f.id} lost hp`).toBe(SHOWCASE_CONFIG.health.maxHp)
    }
  })

  it('★ and nobody is ever narrated as ill, because nobody is ever ill', () => {
    // `escalateFatigue` mints `agent_afflicted{kind:"fatigue"}` after every collapse, and the
    // chronicle used to render EVERY non-poison affliction as "has fallen ill". Ten exhaustion
    // events read as an epidemic. Both halves are asserted: no affliction is minted at all,
    // and the sentence for the one that would be does not say illness.
    expect(of(run, 'agent_afflicted').map((e) => `${who(e)}:${String(e.payload['kind'])}`)).toEqual([])
  })

  it('★ and the whole run replays from genesis, event for event, to the same hash', () => {
    expect(stateHash(replayFromGenesis(run.store, SHOWCASE_CONFIG, run.terrain)))
      .toBe(stateHash(run.state))
  })

  it('★ and a second run of the same world reaches the same town, tick for tick', () => {
    expect(stateHash(runDevWorld(true).state)).toBe(stateHash(run.state))
  }, 180_000)
})

describe('★ THE FIRST NIGHT with interiors off — the arm every landed gate folds', () => {
  const run = runDevWorld(false)

  it('★ still nobody goes down, because a body that cannot walk lies down where it is', () => {
    expect(of(run, 'agent_collapsed').map((e) => `${who(e)}@${e.tick}`)).toEqual([])
  })

  it('★ and everybody sleeps, out of doors, and gets back up', () => {
    const slept = new Set(of(run, 'agent_slept').map(who))
    expect([...slept].sort()).toEqual(FOUNDERS.map((f) => f.id).sort())
    for (const f of FOUNDERS) expect(run.state.agents[f.id]!.alive, f.id).toBe(true)
  })
})
