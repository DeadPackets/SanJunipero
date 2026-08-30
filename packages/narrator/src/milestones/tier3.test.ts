// Tier 3: the arbiter recognizes a construct, and the ledger is how it reaches the chronicle.
// Every construct here is a fixture — no provider is reached.
import { describe, expect, it } from 'vitest'
import { CONSTRUCT_TYPES, MINUTES_PER_DAY } from '@sj/shared'
import { openNarratorDb } from '../schema.js'
import { NarratorStore } from '../store.js'
import { scanPromptForGlassLeak } from '@sj/shared'
import { constructMilestones, type RecognizedConstruct } from './tier3.js'

const QUOTE = 'Every seventh night now. We call it the Long Turning.'

const construct = (over: Partial<RecognizedConstruct> = {}): RecognizedConstruct => ({
  id: 'construct_21_20',
  type: 'festival',
  nameProvenance: {
    name: 'Long Turning',
    sourceKind: 'speech',
    eventSeq: 42,
    quote: QUOTE,
    byId: 'bex',
  },
  participants: ['ada', 'bex', 'cass'],
  firstTick: 0,
  recurrences: [{ tick: MINUTES_PER_DAY }, { tick: 2 * MINUTES_PER_DAY + 19 * 60 }],
  ...over,
})

const store = (): NarratorStore => new NarratorStore(openNarratorDb(':memory:'))

describe('tier 3 — a construct becomes a milestone', () => {
  it('mints the first of its kind and the day it was named, on the gathering that made it one', () => {
    const rows = constructMilestones([construct()], new Set())
    expect(rows.map((m) => m.kind)).toEqual(['first_festival', 'first_name_construct_21_20'])
    for (const m of rows) {
      expect(m.tier).toBe(3)
      expect(m.domain).toBe('construct')
      expect(m.constructId).toBe('construct_21_20')
      expect(m.day).toBe(2)
      expect(m.tick).toBe(2 * MINUTES_PER_DAY + 19 * 60)
      expect(m.agentIds).toEqual(['ada', 'bex', 'cass'])
    }
    expect(rows[1]!.nameProvenance).toEqual({
      name: 'Long Turning',
      sourceKind: 'speech',
      eventSeq: 42,
      quote: QUOTE,
      byId: 'bex',
    })
    expect(rows[1]!.eventSeq).toBe(42)
  })

  it('says nothing an unnamed gathering has not earned', () => {
    const rows = constructMilestones([construct({ nameProvenance: null })], new Set())
    expect(rows.map((m) => m.kind)).toEqual(['first_festival'])
  })

  it('names it later: the ledger already holds the kind, so only the naming is new', () => {
    const rows = constructMilestones([construct()], new Set(['first_festival']))
    expect(rows.map((m) => m.kind)).toEqual(['first_name_construct_21_20'])
    expect(
      constructMilestones([construct()], new Set(['first_festival', 'first_name_construct_21_20'])),
    ).toEqual([])
  })

  it('the second gathering of a kind is not a first, and its own name still is', () => {
    const second = construct({ id: 'construct_4_9' })
    const rows = constructMilestones([construct(), second], new Set())
    expect(rows.map((m) => m.kind)).toEqual([
      'first_festival',
      'first_name_construct_21_20',
      'first_name_construct_4_9',
    ])
  })

  it('★ ONE-WAY GLASS: no label says which kind it is — the taxonomy is ours', () => {
    for (const type of CONSTRUCT_TYPES) {
      const [row] = constructMilestones([construct({ type, nameProvenance: null })], new Set())
      expect(scanPromptForGlassLeak(row!.label), row!.label).toEqual([])
    }
  })

  it('★ the chronicle reads it: the row the observatory selects carries the line', () => {
    const s = store()
    for (const m of constructMilestones([construct()], s.milestoneKinds())) s.insertMilestone(m)

    // The very SELECT `/api/chronicle` runs against the narrator db.
    const feed = s
      .milestones()
      .filter((m) => m.tick >= 2 * MINUTES_PER_DAY && m.tick < 3 * MINUTES_PER_DAY)
    expect(feed.map((m) => m.label)).toEqual([
      'the first time they gathered to celebrate',
      'the day they had a word of their own for it: Long Turning',
    ])
    expect(feed[1]!.nameProvenance?.quote).toBe(QUOTE)

    // A second night over the same registry adds nothing: a first happens once.
    for (const m of constructMilestones([construct()], s.milestoneKinds())) s.insertMilestone(m)
    expect(s.milestones()).toHaveLength(2)
  })
})
