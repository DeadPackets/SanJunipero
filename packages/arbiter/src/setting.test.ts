// San Junipero is contemporary rural and hands-on. These assertions keep the canon and the
// era ladder in that century.
import { describe, expect, it } from 'vitest'
import { scanPromptForGlassLeak } from '@sj/agents'
import { CANON, ERAS, ERA_ORDER, GENESIS_CODEX } from './canon.js'
import { CodexStore } from './codex.js'
import { openArbiterDb } from './schema.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import { ADJUDICATION_INSTRUCTION } from './prompt.js'

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

describe('GENESIS_CODEX — what this town already practises, and what stands one step out', () => {
  const known = GENESIS_CODEX.filter((e) => e.known !== false)
  const frontier = GENESIS_CODEX.filter((e) => e.known === false)

  it('practises eight crafts, every one of them a thing hands do here', () => {
    expect(known.map((e) => e.id)).toEqual([
      'farming', 'fishing', 'foraging', 'carpentry',
      'masonry', 'tailoring', 'cooking', 'machine_repair',
    ])
  })

  it('has earned nothing the canon denies — no metal drawn, no craft that needs a factory', () => {
    for (const e of GENESIS_CODEX) {
      expect(e.id, e.id).not.toMatch(/smelt|foundry|pottery|knapp|cordage|weaving/)
    }
  })

  it('starts every practised craft on the first rung and every unearned one above it', () => {
    for (const e of known) {
      expect(e.era, e.id).toBe('handwork')
      expect(e.prerequisiteId, e.id).toBeNull()
    }
    for (const e of frontier) expect(e.era, e.id).toBe('arrangement')
  })

  it('reaches for arrangements between people, not only for crafts', () => {
    expect(frontier.map((e) => e.id).sort()).toEqual(
      ['bridging', 'common_store', 'food_preserving', 'memorial', 'work_rota'],
    )
  })

  it('hangs every unearned rung on a craft the town actually practises', () => {
    const practised = new Set(known.map((e) => e.id))
    for (const e of frontier) expect(practised.has(e.prerequisiteId!), e.id).toBe(true)
  })

  it('leaks no ops vocabulary through an id or a name the arbiter will read', () => {
    for (const e of GENESIS_CODEX) {
      expect(scanPromptForGlassLeak(e.id), e.id).toEqual([])
      expect(scanPromptForGlassLeak(e.name), e.id).toEqual([])
    }
  })

  it('seeds a store whose frontier is exactly the unearned rungs', () => {
    const store = new CodexStore(openArbiterDb(':memory:'))
    for (const e of GENESIS_CODEX) store.insert(e)
    expect(store.known()).toEqual(known.map((e) => e.id))
    expect(store.frontier()).toEqual(frontier.map((e) => e.id).sort())
    expect(store.knownEra()).toBe('handwork')
  })
})
