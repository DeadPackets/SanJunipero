// @slow — the town survives its first night and somebody sleeps indoors.
//
// The two rules that keep this green are in the header of `founders.ts`.
//
// This is the dev world a viewer actually boots, minus the HTTP: same config, same terrain,
// same structures, same `makeFoundersOnTick`. Scripted policies only. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import { stateHash } from '@sj/shared'
import { fold } from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState } from './devWorld.js'
import { FOUNDERS } from './founders.js'
import { type Run, type Seen, runFoundersWorld } from './testutil.js'

/** Three sim days, the far-bank lane's standard, so a night is a thing this test has seen
 *  three of rather than argued about once. */
const TICKS = 4320
const RINGS = 3

function runDevWorld(interiors: boolean, ticks = TICKS): Run {
  return runFoundersWorld({ interiors, holdings: true }, ticks, RINGS)
}

const of = (run: Run, type: string): Seen[] => run.events.filter((e) => e.type === type)
const who = (e: Seen): string => {
  const id = e.payload.agentId ?? e.payload.id
  return typeof id === 'string' ? id : ''
}

describe('★ THE FIRST NIGHT — the showcase town on rings=3, three sim days', () => {
  const run = runDevWorld(true)

  it('★ NOBODY SPENDS A NIGHT ON THE GROUND — not one collapse in three days', () => {
    const down = of(run, 'agent_collapsed')
    // The failure names the tick and the clock, because 17:02 is the arithmetic and saying so
    // is what stops the next reader treating it as a bad roll.
    expect(
      down.map((e) => `${who(e)}@${e.tick}`),
      'a founder went down in the street',
    ).toEqual([])
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
    // chronicle renders a non-poison affliction as illness. Both halves are asserted.
    expect(of(run, 'agent_afflicted').map((e) => `${who(e)}:${String(e.payload.kind)}`)).toEqual([])
  })

  it('★ and the whole run replays from genesis, event for event, to the same hash', () => {
    // A BARE `genesisState` has not said where its array stands, so the replay starts from the
    // dev world's genesis — still every event of the run folded from nothing, which is the claim.
    const from = devGenesisState(SHOWCASE_CONFIG, run.terrain, 'showcase', RINGS)
    const replayed = run.store.readFrom(0).reduce((s, ev) => fold(s, ev, SHOWCASE_CONFIG), from)
    expect(stateHash(replayed)).toBe(stateHash(run.state))
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
