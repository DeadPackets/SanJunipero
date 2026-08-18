// THE SETTING. San Junipero is contemporary rural, hands-on: the user established the
// period after C12a and the arbiter's canon said the opposite. These are the assertions
// that keep the canon and the era ladder in the century the Style Bible's sole reference
// anchor (Stardew Valley) always implied.
import { describe, expect, it } from 'vitest'
import { scanPromptForGlassLeak } from '@sj/agents'
import { CANON, ERAS, ERA_ORDER } from './canon.js'
import { ADJUDICATION_INSTRUCTION, FORBIDDEN_FRAMING } from './prompt.js'

// Words that only belong to a town with no metal and no machine. A canon that names one
// of these has slipped back a period; the whole lane exists to keep them out.
const WRONG_CENTURY = [
  /\bstone[- ]age\b/i, /\bneolithic\b/i, /\bflint\b/i, /\bthatch/i, /\bknapp/i,
  /\bclay pots?\b/i, /\bstrike sparks?\b/i, /\bstone (?:implement|tool)s?\b/i,
  /\bpottery\b/i, /\bcordage\b/i, /\bloincloth\b/i, /\bsinew\b/i,
]

describe('CANON — contemporary rural', () => {
  it('names the baseline the user settled: a generator, hands, and no factory in reach', () => {
    expect(CANON).toMatch(/generator/i)
    expect(CANON).toMatch(/factory/i)
    expect(CANON).toMatch(/by hand/i)
  })

  it('states a frontier, so adjacency still has a boundary to bite on', () => {
    // "A world where anything is possible gives the arbiter nothing to do."
    expect(CANON).toMatch(/nothing arrives from outside/i)
  })

  it('keeps the adjacency rule verbatim — the engine of the arbiter and the codifier', () => {
    expect(CANON).toContain(
      'each new craft must be reached from one the town already practices, one careful step at a time',
    )
  })

  it('carries not one word of the wrong century', () => {
    for (const re of WRONG_CENTURY) expect(CANON).not.toMatch(re)
  })

  it('stays diegetic and leaks no ops vocabulary', () => {
    expect(FORBIDDEN_FRAMING.test(CANON)).toBe(false)
    expect(scanPromptForGlassLeak(CANON)).toEqual([])
  })
})

describe('ADJUDICATION_INSTRUCTION — contemporary rural', () => {
  it('carries not one word of the wrong century', () => {
    for (const re of WRONG_CENTURY) expect(ADJUDICATION_INSTRUCTION).not.toMatch(re)
  })

  it('leaks no ops vocabulary', () => {
    expect(scanPromptForGlassLeak(ADJUDICATION_INSTRUCTION)).toEqual([])
  })
})

describe('the era ladder', () => {
  it('climbs reach, not a tech tree', () => {
    expect(ERAS).toEqual(['handwork', 'arrangement', 'works', 'machinery', 'industry'])
  })

  it('orders every era once, from one, with no gaps — the ranking mechanic is untouched', () => {
    expect(Object.keys(ERA_ORDER).sort()).toEqual([...ERAS].sort())
    expect(ERAS.map((e) => ERA_ORDER[e])).toEqual([1, 2, 3, 4, 5])
  })

  it('never names an era with a word the one-way glass bans', () => {
    for (const era of ERAS) expect(scanPromptForGlassLeak(era)).toEqual([])
  })
})
