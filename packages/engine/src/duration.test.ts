import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  DURATION_TICKS,
  DURATION_WORDS,
  SimConfigSchema,
  stateHash,
  ticksFor,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { VERBS } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'
import { RngStreams } from './rng.js'
import { ev, grid } from './testutil/world.js'

const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  fauna: { enabled: false },
})

// The four whose clock is worked out from the world — a route, a building, an operator's dial,
// a tree against a sapling. Adding a verb here claims a number is honest for it; every other
// verb in the town must say one of the six words.
const COMPUTED = ['walk', 'build', 'pave', 'chop'] as const

function world(): WorldState {
  const rows: TileId[][] = grid(16)
  let s = genesisState(CFG, rows)
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: ADULT_AGE_DAYS }))
  return fold(
    s,
    ev('item_spawned', { id: 'item_1', kind: 'bread', qty: 2, loc: { t: 'agent', id: 'a1' } }),
    CFG,
  )
}

describe('the six words an act may take', () => {
  it('every verb the town has says how long it takes, in a word or off the world', () => {
    for (const [kind, def] of Object.entries(VERBS)) {
      const computed = (COMPUTED as readonly string[]).includes(kind)
      expect(
        def.takes !== undefined || computed,
        `${kind} has neither a duration word nor a computed duration`,
      ).toBe(true)
      if (def.takes !== undefined) expect(DURATION_WORDS).toContain(def.takes)
      // Both at once is two answers to one question, and the word would be the one nobody reads.
      expect(def.takes !== undefined && computed, `${kind} says its length twice`).toBe(false)
    }
  })

  it("a verb's word is exactly what its clock reads", () => {
    for (const def of Object.values(VERBS)) {
      if (def.takes === undefined) continue
      expect(def.duration(world(), CFG, 'a1', {}), def.kind).toBe(DURATION_TICKS[def.takes])
    }
  })

  it('the six are log-spaced, and a day is the ceiling', () => {
    const ticks = DURATION_WORDS.map((w) => DURATION_TICKS[w])
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
    expect(new Set(ticks).size).toBe(DURATION_WORDS.length)
    expect(Math.max(...ticks)).toBe(DURATION_TICKS.day)
    for (const def of Object.values(VERBS)) {
      if (def.takes !== undefined)
        expect(ticksFor(def.takes)).toBeLessThanOrEqual(DURATION_TICKS.day)
    }
  })

  // A second table anywhere is two vocabularies that drift apart. Any file but duration.ts that
  // writes a word beside a number is that second table being born.
  it('duration.ts is the only place a word becomes ticks', () => {
    const WORD_BESIDE_A_NUMBER = new RegExp(
      `['"\`](?:${DURATION_WORDS.join('|')})['"\`]\\s*[:=]\\s*\\d`,
    )
    const roots = ['packages/engine/src', 'packages/arbiter/src', 'packages/shared/src']
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        // Source only: a snapshot of a clock reading "hour: 12" is not a second table.
        if (entry.isDirectory()) {
          walk(path)
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts') &&
          entry.name !== 'duration.ts'
        ) {
          if (WORD_BESIDE_A_NUMBER.test(readFileSync(path, 'utf8'))) offenders.push(path)
        }
      }
    }
    for (const root of roots) walk(join(process.cwd(), root))
    expect(offenders).toEqual([])
  })
})

describe('an act that takes minutes runs every one of them', () => {
  // eat is half an hour; the clock is settled at action_started and recorded in the payload,
  // which is the whole of what replay reads back.
  function chew(): { started: number; events: { type: string; payload: unknown }[] } {
    const s = world()
    const r = submitIntent(s, CFG, 'a1', 'eat', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    const started = (r.events[0]!.payload as { duration: number }).duration
    let state = r.events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, 0), CFG), s)
    const worldTick = createWorldTick(CFG, new RngStreams('duration'))
    const events: { type: string; payload: unknown }[] = []
    for (let tick = 1; tick <= started + 5; tick++) {
      const out = worldTick(fold(state, ev('tick_advanced', {}, tick), CFG))
      state = out.state
      events.push(...out.events)
    }
    return { started, events }
  }

  it('progresses once a tick for its whole length and completes exactly once', () => {
    const { started, events } = chew()
    expect(started).toBe(DURATION_TICKS.half_hour)
    const mine = (type: string) =>
      events.filter((e) => e.type === type && (e.payload as { agentId?: string }).agentId === 'a1')
    expect(mine('action_progressed')).toHaveLength(started)
    expect(mine('action_completed')).toHaveLength(1)
    expect(mine('action_interrupted')).toHaveLength(0)
  })

  it('and a replay of those minutes lands on the state the live run left', () => {
    const s = world()
    const r = submitIntent(s, CFG, 'a1', 'eat', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    let live = r.events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, 0), CFG), s)
    const log: { tick: number; type: string; payload: unknown }[] = r.events.map((e) => ({
      tick: 0,
      ...e,
    }))
    const worldTick = createWorldTick(CFG, new RngStreams('duration'))
    for (let tick = 1; tick <= DURATION_TICKS.half_hour + 2; tick++) {
      log.push({ tick, type: 'tick_advanced', payload: {} })
      const out = worldTick(fold(live, ev('tick_advanced', {}, tick), CFG))
      live = out.state
      for (const e of out.events) log.push({ tick, ...e })
    }
    const replayed = log.reduce((acc, e) => fold(acc, ev(e.type, e.payload, e.tick), CFG), s)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})

describe('the night charges for a long act, and the record keeps the number', () => {
  it('a duration is settled once, at action_started, penalty and all', () => {
    const night = { ...world(), tick: 60 } // 01:00 — the dark, and the dark costs more
    const r = submitIntent(night, DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    const { duration } = r.events[0]!.payload as { duration: number }
    expect(duration).toBeGreaterThanOrEqual(DURATION_TICKS.half_hour)
    const folded = fold(night, ev('action_started', r.events[0]!.payload, 60), DEFAULT_CONFIG)
    expect(folded.agents.a1!.activity!.ticksRemaining).toBe(duration)
  })
})
