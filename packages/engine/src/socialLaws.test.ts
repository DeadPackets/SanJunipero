import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  scanPromptForGlassLeak,
  stateHash,
  type SimEvent,
} from '@sj/shared'
import { LAW_FIXTURE, LAW_FIXTURE_FIRE_PIT } from '@sj/shared/testutil'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { fold } from './fold.js'
import {
  LAWS_SHOWN,
  LAW_TEXT_MAX,
  LawPredicateSchema,
  judgeLaws,
  markLaw,
  periodIndex,
  standingLaws,
  witnessesOf,
  type LawPredicate,
} from './socialLaws.js'
import { RngStreams } from './rng.js'
import { replayFromGenesis } from './replay.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { TickLoop } from './tickLoop.js'

let seq = 1
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

const NOON = 720

const ratify = (
  id: string,
  agentId: string,
  text: string,
  predicate: LawPredicate,
): { type: string; payload: unknown } => ({
  type: 'law_ratified',
  payload: {
    lawId: id,
    agentId,
    text,
    why: 'because they said so',
    predicate,
    votes: { for: [agentId], against: [] },
  },
})

function world(agents: { id: string; x: number; y: number }[] = []): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)),
  )
  for (const a of agents)
    s = fold(
      s,
      ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: ADULT_AGE_DAYS }),
    )
  return { ...s, tick: NOON }
}

describe('the fixture the three lanes share', () => {
  it('is three prototype laws whose predicates the engine can hold and whose texts fit a prompt', () => {
    expect(LAW_FIXTURE.map((f) => f.name)).toEqual(['the slate rule', 'the fire tax', 'well-order'])
    for (const f of LAW_FIXTURE) {
      expect(f.text.length, f.name).toBeLessThanOrEqual(LAW_TEXT_MAX)
      expect(LawPredicateSchema.parse(f.predicate).kind).toBe(f.predicate.kind)
    }
    expect(LAW_FIXTURE.map((f) => f.predicate.kind)).toEqual(['forbid', 'tithe', 'require_before'])
    expect(LAWS_SHOWN).toBe(8)
  })
})

describe('the fold keeps what the town agreed', () => {
  it('numbers laws in the order they passed and stands them until they are let go', () => {
    let s = world()
    s = fold(s, ev('law_ratified', ratify('law_a', 'nadia', 'A', { kind: 'none' }).payload, 10))
    s = fold(s, ev('law_ratified', ratify('law_b', 'omar', 'B', { kind: 'none' }).payload, 20))
    expect(s.socialLaws?.law_a?.ordinal).toBe(1)
    expect(s.socialLaws?.law_b?.ordinal).toBe(2)
    expect(s.socialLaws?.law_a?.ratifiedTick).toBe(10)
    expect(s.socialLaws?.law_a?.proposedBy).toBe('nadia')
    expect(s.socialLaws?.law_b?.repealedTick).toBe(null)
    expect(standingLaws(s).map((l) => l.id)).toEqual(['law_a', 'law_b'])

    s = fold(s, ev('law_repealed', { lawId: 'law_a', agentId: 'omar', text: 'A' }, 30))
    expect(s.socialLaws?.law_a?.repealedTick).toBe(30)
    expect(standingLaws(s).map((l) => l.id)).toEqual(['law_b'])
  })

  it('refuses a law ratified twice and a law let go that never stood', () => {
    let s = world()
    s = fold(s, ev('law_ratified', ratify('law_a', 'nadia', 'A', { kind: 'none' }).payload, 10))
    expect(() =>
      fold(s, ev('law_ratified', ratify('law_a', 'nadia', 'A', { kind: 'none' }).payload, 20)),
    ).toThrow(/law_ratified twice/)
    expect(() =>
      fold(s, ev('law_repealed', { lawId: 'law_z', agentId: 'omar', text: 'Z' }, 20)),
    ).toThrow(/unknown law/)
  })

  it('a proposal and a breach are witnessed and fold to nothing', () => {
    const s = world([{ id: 'a1', x: 0, y: 0 }])
    const after = fold(
      fold(s, ev('law_proposed', { lawId: 'law_a', agentId: 'a1', text: 'A' }, 5)),
      ev('law_broken', { lawId: 'law_a', agentId: 'a1', verb: 'take', witnesses: ['a2'] }, 6),
    )
    expect(stateHash(after)).toBe(stateHash(s))
  })
})

describe('GATE: a log with laws in it replays to the state the live run left', () => {
  const run = (withLaws: boolean): { store: EventStore; live: TickLoop } => {
    const store = new EventStore(openDb(':memory:'))
    const live = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG),
      rng: new RngStreams('social-laws'),
      snapshotEveryTicks: 60,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          for (const id of ['nadia', 'salma', 'amara'])
            emit('agent_spawned', { id, name: id, x: 1, y: 1, ageDays: ADULT_AGE_DAYS })
        if (!withLaws) return
        if (tick === 2)
          for (const f of LAW_FIXTURE)
            emit('law_proposed', { lawId: f.id, agentId: f.proposedBy, text: f.text })
        if (tick === 3)
          for (const f of LAW_FIXTURE)
            emit('law_ratified', {
              lawId: f.id,
              agentId: f.proposedBy,
              text: f.text,
              why: f.why,
              predicate: f.predicate,
              votes: f.votes,
            })
        if (tick === 4)
          emit('law_broken', {
            lawId: 'law_slate',
            agentId: 'salma',
            verb: 'take',
            witnesses: ['amara', 'nadia'],
          })
        if (tick === 5) emit('law_repealed', { lawId: 'law_fire_tax', agentId: 'salma', text: 'X' })
      },
    })
    for (let i = 0; i < 8; i++) live.step()
    return { store, live }
  }

  it('every law event folds the same way replayed as it did live', () => {
    const { store, live } = run(true)
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(live.state))
    expect(Object.keys(live.state.socialLaws ?? {}).sort()).toEqual([
      'law_fire_tax',
      'law_slate',
      'law_well_order',
    ])
  })

  // The whole cost of this feature to a town that never holds a council: nothing.
  it('a town that agreed nothing grows neither socialLaws nor lawMarks', () => {
    const { live } = run(false)
    expect('socialLaws' in live.state).toBe(false)
    for (const a of Object.values(live.state.agents)) expect('lawMarks' in a).toBe(false)
    expect(judgeLaws(live.state, DEFAULT_CONFIG, 'nadia', 'take', {}, live.state.tick)).toBe(null)
    expect(markLaw(live.state, 'nadia', 'sleep', {}, live.state.tick)).toBe(undefined)
  })
})

describe('who saw it', () => {
  it('reads the same lens a taking is seen through: alive, same room, inside the light, sorted', () => {
    let s = world([
      { id: 'breaker', x: 10, y: 10 },
      { id: 'near', x: 12, y: 10 },
      { id: 'also', x: 10, y: 13 },
      { id: 'far', x: 10, y: 30 },
      { id: 'dead', x: 11, y: 10 },
    ])
    s = fold(s, ev('agent_died', { agentId: 'dead', cause: 'starvation' }))
    expect(witnessesOf(s, DEFAULT_CONFIG, 'breaker')).toEqual(['also', 'near'])
  })

  it('a wall is a wall: somebody indoors sees nothing of the street', () => {
    let s = world([
      { id: 'breaker', x: 4, y: 4 },
      { id: 'inside', x: 3, y: 2 },
    ])
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 20,
        flammable: true,
        builderId: 'breaker',
      }),
    )
    s = fold(s, ev('structure_completed', { id: 'structure_1' }))
    s = fold(s, ev('agent_entered', { agentId: 'inside', structureId: 'structure_1' }))
    expect(witnessesOf(s, DEFAULT_CONFIG, 'breaker')).toEqual([])
    expect(witnessesOf(s, DEFAULT_CONFIG, 'inside')).toEqual([])
  })
})

describe('a refusal in the town’s own words', () => {
  it('quotes the sentence and never the id it is filed under, and is clean through the glass', () => {
    let s = world([{ id: 'a1', x: 1, y: 1 }])
    const text = 'Nobody fills before they have slept.'
    s = fold(
      s,
      ev(
        'law_ratified',
        ratify('law_well_order', 'a1', text, {
          kind: 'require_before',
          verb: 'fill',
          before: 'sleep',
        }).payload,
        10,
      ),
    )
    const judged = judgeLaws(s, DEFAULT_CONFIG, 'a1', 'fill', {}, NOON)
    expect(judged).toEqual({ refusal: `the town agreed: ${text}` })
    const reason = judged !== null && 'refusal' in judged ? judged.refusal : ''
    expect(reason).not.toContain('law_')
    expect(scanPromptForGlassLeak(reason)).toEqual([])
  })
})

describe('the calendar a tithe is paid on', () => {
  it('a day is a day and a week is the seven days a season is', () => {
    expect(periodIndex(0, 'day')).toBe(0)
    expect(periodIndex(MINUTES_PER_DAY, 'day')).toBe(1)
    expect(periodIndex(MINUTES_PER_DAY * 6, 'week')).toBe(0)
    expect(periodIndex(MINUTES_PER_DAY * 7, 'week')).toBe(1)
  })
})

describe('the marks a completion leaves', () => {
  const shelved = (): WorldState => {
    let s = world([{ id: 'a1', x: 3, y: 3 }])
    s = fold(
      s,
      ev('structure_planned', {
        id: LAW_FIXTURE_FIRE_PIT,
        kind: 'fire_pit',
        x: 5,
        y: 5,
        w: 1,
        h: 1,
        maxHp: 20,
        flammable: false,
        builderId: 'a1',
      }),
    )
    s = fold(s, ev('structure_completed', { id: LAW_FIXTURE_FIRE_PIT }))
    return fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }),
    )
  }

  it('only a verb a standing law names leaves one', () => {
    let s = shelved()
    s = fold(
      s,
      ev(
        'law_ratified',
        ratify('law_w', 'a1', 'W', LAW_FIXTURE[2]!.predicate as LawPredicate).payload,
        100,
      ),
    )
    expect(markLaw(s, 'a1', 'eat', {}, 200)).toBe(undefined)
    expect(markLaw(s, 'a1', 'sleep', {}, 200)).toEqual({ sleep: 200 })
  })

  it('a tithe is paid by shelving the kind at the place, and the mark is the period', () => {
    let s = shelved()
    s = fold(
      s,
      ev(
        'law_ratified',
        ratify('law_t', 'a1', 'T', LAW_FIXTURE[1]!.predicate as LawPredicate).payload,
        100,
      ),
    )
    const params = { itemId: 'item_1', structureId: LAW_FIXTURE_FIRE_PIT }
    expect(markLaw(s, 'a1', 'stow', params, MINUTES_PER_DAY * 2)).toEqual({ law_t: 2 })
    expect(markLaw(s, 'a1', 'stow', { itemId: 'item_1', structureId: 'structure_9' }, 0)).toBe(
      undefined,
    )
  })
})
