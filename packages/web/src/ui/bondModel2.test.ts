import { describe, expect, it } from 'vitest'
import { bondId, type Bond, type BondEvent, type BondKind, type BondsResponse } from '@sj/shared'
import { GAMIFICATION_BAN } from './townStats.js'
import {
  ACT_OF_BOND_KIND, BOND_LEVELS, BOND_LEVEL_WORD, BOND_TYPES, BOND_TYPE_WORD, BOND_VALENCE,
  EMPTY_LINEAGE, LEVEL_RANK, LEVEL_THRESHOLDS, SPOUSE_NIGHTS, WARMTH_HALF_LIFE_TICKS,
  bondArc, bondLevel, bondTypeOf, bondWarmth, partnerEvidence, relationLine,
  type BondLevel, type LineageLike,
} from './bondModel2.js'

/** one half-life, which is TWO sim-days — see the constant's own note */
const HALF = WARMTH_HALF_LIFE_TICKS
const DAY = HALF

/** the endpoint records a BondKind per event, so the fixtures speak the endpoint's language */
const at = (tick: number, kind: BondKind): BondEvent => ({ tick, kind, note: 'x' })

const bond = (aId: string, bId: string, history: BondEvent[], kind: BondKind = 'friend'): Bond => ({
  id: bondId(aId, bId), aId, bId, kind, strength: history.length,
  formedTick: history[0]?.tick ?? 0,
  lastUpdatedTick: history[history.length - 1]?.tick ?? 0,
  history,
})

const api = (bonds: Bond[]): BondsResponse => ({ bonds, asOfTick: 0 })

const lineage = (edges: Array<[string, string]>, tick = 100): LineageLike => ({
  parentOf: edges.map(([parentId, childId]) => ({ parentId, childId, tick })),
})

const STEADY = bondArc([], 0)

// ── THE COMPLAINT, AS A TEST ───────────────────────────────────────────────────────────────
describe('U15: the landed model calls anyone who ever spoke a friend', () => {
  // On the landed model this pair is `kind: 'friend'` and the legend prints "Friends".
  // `strength` is 1 and unsigned, so nothing about them can ever get worse.
  it('two people who spoke ONCE are strangers, not friends', () => {
    const h = [at(0, 'friend')]
    expect(bondWarmth(h, 0)).toBe(1)
    expect(bondLevel(bondWarmth(h, 0))).toBe('strangers')
    expect(BOND_LEVEL_WORD[bondLevel(bondWarmth(h, 0))]).toBe('Strangers')
  })

  it('hatred is expressible at all, which it was not', () => {
    expect([...BOND_LEVELS]).toContain('hatred')
    expect(BOND_VALENCE.attack).toBeLessThan(0)
  })
})

describe('every level is reachable, one history each', () => {
  const cases: Array<[BondLevel, BondEvent[]]> = [
    ['strangers', [at(0, 'friend')]],
    ['acquaintances', [at(0, 'friend'), at(0, 'friend'), at(0, 'work')]],
    ['friendly', [at(0, 'owe'), at(0, 'owe'), at(0, 'partner'), at(0, 'friend')]],
    ['close', Array.from({ length: 6 }, () => at(0, 'partner'))],
    ['strained', [at(0, 'rival'), at(0, 'friend')]],
    ['hatred', [at(0, 'rival'), at(0, 'rival')]],
  ]

  it('lands exactly where the thresholds say', () => {
    for (const [level, h] of cases) expect(bondLevel(bondWarmth(h, 0)), level).toBe(level)
    expect(new Set(cases.map((c) => c[0])).size).toBe(BOND_LEVELS.length)
  })

  it('the thresholds ascend, and the rank runs coldest to warmest', () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i]!.at).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]!.at)
    }
    expect(LEVEL_RANK[0]).toBe('hatred')
    expect(LEVEL_RANK[LEVEL_RANK.length - 1]).toBe('close')
    expect([...LEVEL_RANK].sort()).toEqual([...BOND_LEVELS].sort())
  })
})

// ── P3: THIS IS NOT A SCORE, AND THE PROOF IS THAT IT GOES DOWN ───────────────────────────
describe('a friendship is losable and hatred is earnable', () => {
  it('a close pair who fight enough end up in hatred, by way of strained', () => {
    const warm = Array.from({ length: 6 }, () => at(0, 'partner'))   // warmth 24 → close
    expect(bondLevel(bondWarmth(warm, 0))).toBe('close')

    const levels = [0, 1, 2, 3, 4, 5].map((fights) =>
      bondLevel(bondWarmth([...warm, ...Array.from({ length: fights }, () => at(0, 'rival'))], 0)))

    // MEASURED, not asserted from the plan: from `close` (warmth 24) each fight is -8, so the
    // fall runs close → friendly → strangers → strained → hatred. The plan's "two fights →
    // strained, three → hatred" is arithmetically impossible against its own tables; the
    // PROPERTY it is protecting — a level falls, and hatred is reachable — holds exactly.
    expect(levels).toEqual([
      'close', 'friendly', 'acquaintances', 'strangers', 'strained', 'hatred',
    ])
    expect(LEVEL_RANK.indexOf(levels[5]!)).toBeLessThan(LEVEL_RANK.indexOf(levels[0]!))
  })

  it('a friendship nobody keeps up cools on its own — the level WENT DOWN', () => {
    const h = Array.from({ length: 5 }, () => at(0, 'owe'))          // warmth 15 → friendly
    expect(bondLevel(bondWarmth(h, 0))).toBe('friendly')
    const after = bondLevel(bondWarmth(h, 2 * HALF))
    expect(after).toBe('acquaintances')
    expect(LEVEL_RANK.indexOf(after)).toBeLessThan(LEVEL_RANK.indexOf('friendly'))
    // MEASURED, and it amends the plan twice over: the half-life is TWO sim-days, not one, so
    // the plan's "four sim-days of nothing → acquaintances" is exactly right in DAYS while
    // being two half-lives, not four. Four half-lives is already `strangers`.
    expect(bondLevel(bondWarmth(h, 4 * HALF))).toBe('strangers')
  })

  it('bondWarmth is deterministic and order-independent within a tick', () => {
    const h = [at(10, 'friend'), at(10, 'owe'), at(10, 'rival')]
    expect(bondWarmth(h, 10)).toBe(bondWarmth([...h].reverse(), 10))
    expect(bondWarmth(h, 10)).toBe(bondWarmth(h, 10))
    expect(bondWarmth([], 500)).toBe(0)
  })

  it('a birth adds no warmth — being kin is a type, never a temperature', () => {
    expect(BOND_VALENCE.born).toBe(0)
    expect(bondWarmth([at(0, 'kin')], 0)).toBe(0)
  })

  it('the act table covers every kind the endpoint can record', () => {
    for (const k of Object.keys(ACT_OF_BOND_KIND) as BondKind[]) {
      expect(BOND_VALENCE[ACT_OF_BOND_KIND[k]], k).not.toBeUndefined()
    }
  })
})

// ── TYPE ───────────────────────────────────────────────────────────────────────────────────
describe('bondTypeOf — the same edge read from two ends', () => {
  const fam = lineage([['amara', 'kid'], ['yusuf', 'kid'], ['amara', 'sib'], ['yusuf', 'sib']])

  it('is parent from one side and child from the other', () => {
    expect(bondTypeOf('amara', 'kid', fam, api([]))).toBe('parent')
    expect(bondTypeOf('kid', 'amara', fam, api([]))).toBe('child')
  })

  it('two people who share at least one parent are siblings', () => {
    expect(bondTypeOf('kid', 'sib', fam, api([]))).toBe('sibling')
    const half = lineage([['amara', 'kid'], ['amara', 'sib'], ['zed', 'sib']])
    expect(bondTypeOf('kid', 'sib', half, api([]))).toBe('sibling')
  })

  it('cousins are not siblings, and neither are two people with no parents recorded', () => {
    const cousins = lineage([['amara', 'kid'], ['yusuf2', 'cuz']])
    expect(bondTypeOf('kid', 'cuz', cousins, api([]))).toBe('none')
    expect(bondTypeOf('a', 'b', EMPTY_LINEAGE, api([]))).toBe('none')
  })

  it('a pair who slept under one roof are partners', () => {
    const b = api([bond('amara', 'yusuf', [at(0, 'partner')], 'partner')])
    expect(bondTypeOf('amara', 'yusuf', EMPTY_LINEAGE, b)).toBe('partner')
    expect(bondTypeOf('yusuf', 'amara', EMPTY_LINEAGE, b)).toBe('partner')
  })

  it('kin OUTRANKS partner: a recorded birth beats an inferred partnership', () => {
    const b = api([bond('amara', 'kid', [at(0, 'partner')], 'partner')])
    expect(bondTypeOf('amara', 'kid', fam, b)).toBe('parent')
  })

  it('nobody is their own anything, and BOND_TYPE_WORD is total', () => {
    expect(bondTypeOf('a', 'a', fam, api([]))).toBe('none')
    for (const t of BOND_TYPES) expect(BOND_TYPE_WORD[t], t).not.toBeUndefined()
    expect(BOND_TYPE_WORD.none).toBe('')
  })
})

describe('partnerEvidence — shown, never asserted', () => {
  const nights = (n: number, from = 0): BondEvent[] =>
    Array.from({ length: n }, (_, i) => at(from + i * DAY, 'partner'))

  it('names the day once there have been enough nights, and says "lately" before', () => {
    const long = partnerEvidence(bond('a', 'b', nights(SPOUSE_NIGHTS, 5 * DAY)))!
    expect(long).toMatch(/since Day \d+/)
    expect(partnerEvidence(bond('a', 'b', nights(SPOUSE_NIGHTS - 1)))).toBe('They have shared a roof lately.')
  })

  it('never says a word the world did not record', () => {
    for (const n of [1, SPOUSE_NIGHTS, SPOUSE_NIGHTS + 20]) {
      const line = partnerEvidence(bond('a', 'b', nights(n)))!
      expect(line.toLowerCase()).not.toContain('married')
      expect(line.toLowerCase()).not.toContain('wife')
      expect(line.toLowerCase()).not.toContain('husband')
      expect(line).not.toMatch(GAMIFICATION_BAN)
    }
  })

  it('a pair who never shared a roof get no line at all, not an empty one', () => {
    expect(partnerEvidence(bond('a', 'b', [at(0, 'friend')]))).toBeNull()
  })
})

// ── THE ARC ────────────────────────────────────────────────────────────────────────────────
describe('bondArc — which way it is going', () => {
  it('a history that keeps building reports warming', () => {
    const h = [at(0, 'friend'), at(DAY + 10, 'owe'), at(DAY + 20, 'owe'), at(DAY + 30, 'partner')]
    const arc = bondArc(h, DAY + 40)
    expect(arc.direction).toBe('warming')
    expect(LEVEL_RANK.indexOf(arc.to)).toBeGreaterThan(LEVEL_RANK.indexOf(arc.from))
  })

  it('a history that stops reports cooling, and names the day it turned', () => {
    // warmth 24 at tick 0: a day later it is 12 (friendly), two days later 6 (acquaintances)
    const h = Array.from({ length: 6 }, () => at(0, 'partner'))
    const arc = bondArc(h, 2 * DAY)
    expect(arc).toEqual({
      from: 'friendly', to: 'acquaintances', direction: 'cooling', sinceDay: 0,
    })
    expect(LEVEL_RANK.indexOf(arc.to)).toBeLessThan(LEVEL_RANK.indexOf(arc.from))
  })

  it('a level that has not moved is steady, and an empty history does not throw', () => {
    const flat = bondArc([at(0, 'friend')], 10)
    expect(flat.direction).toBe('steady')
    expect(STEADY.direction).toBe('steady')
    expect(STEADY.from).toBe(STEADY.to)
  })
})

// ── THE SENTENCE ───────────────────────────────────────────────────────────────────────────
describe('relationLine is total over BondType × BondLevel', () => {
  it('all thirty cases say something, and none of them is machine vocabulary', () => {
    let n = 0
    for (const type of BOND_TYPES) {
      for (const level of BOND_LEVELS) {
        const line = relationLine(type, level, STEADY, ['Amara', 'Yusuf'])
        n += 1
        expect(line.length, `${type}/${level}`).toBeGreaterThan(10)
        expect(line, `${type}/${level}`).not.toMatch(GAMIFICATION_BAN)
        expect(line, `${type}/${level}`).not.toMatch(/\d/)     // steady: no day, so no digit
        expect(line, `${type}/${level}`).not.toMatch(/_/)
        expect(line).toContain('Amara')
        expect(line).toContain('Yusuf')
        expect(line.endsWith('.')).toBe(true)
      }
    }
    expect(n).toBe(BOND_TYPES.length * BOND_LEVELS.length)
  })

  it('names the type first when there is one, and only the pair when there is not', () => {
    expect(relationLine('sibling', 'close', STEADY, ['Amara', 'Yusuf']))
      .toBe('Amara and Yusuf are siblings, and they are close.')
    expect(relationLine('none', 'strangers', STEADY, ['Amara', 'Yusuf']))
      .toBe('Amara and Yusuf are strangers to each other.')
    expect(relationLine('parent', 'friendly', STEADY, ['Amara', 'Kid']))
      .toBe('Amara is Kid’s parent, and they are friends.')
  })

  it('adds the arc only when it moved, and the day is the only number in the line', () => {
    const warming = { from: 'strangers', to: 'friendly', direction: 'warming', sinceDay: 4 } as const
    const line = relationLine('none', 'friendly', warming, ['Amara', 'Yusuf'])
    expect(line).toContain('Warming since Day 4.')
    expect(line.match(/\d+/g)).toEqual(['4'])
  })
})
