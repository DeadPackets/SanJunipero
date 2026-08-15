import { describe, expect, it } from 'vitest'
import { assembleAdjudicationPrompt, FORBIDDEN_FRAMING, type AdjudicationBlocks } from './prompt.js'

function fixtureBlocks(overrides: Partial<AdjudicationBlocks> = {}): AdjudicationBlocks {
  return {
    canon: 'CANON BLOCK\n\nThe town currently knows: fire, pottery, charcoal',
    agent: {
      name: 'Tamar',
      skills: { farming: 120, pottery: 80 },
      inventory: [
        { kind: 'wood', qty: 2 },
        { kind: 'clay_pot', qty: 1 },
      ],
      position: { x: 12, y: 8 },
    },
    precedent: [
      { summary: 'Boil river water for salt', verdictKind: 'attempt', recipeName: 'Boil Salt' },
      { summary: 'Chop a tree for wood', verdictKind: 'map' },
    ],
    intent: 'I try to boil river water for salt.',
    ...overrides,
  }
}

describe('adjudication prompt prefix stability', () => {
  it('keeps system byte-identical and user prefix byte-identical when only intent changes', () => {
    const intentA = 'I try to boil river water for salt.'
    const intentB = 'I want to build a clay oven.'
    const a = assembleAdjudicationPrompt(fixtureBlocks({ intent: intentA }))
    const b = assembleAdjudicationPrompt(fixtureBlocks({ intent: intentB }))

    expect(a.system).toBe(b.system)

    const ua = a.messages[0].content
    const ub = b.messages[0].content
    // Everything before the intent line is a shared, byte-identical prefix.
    expect(ua.slice(0, ua.lastIndexOf(intentA))).toBe(ub.slice(0, ub.lastIndexOf(intentB)))
  })

  it('changes only the inventory line when inventory changes', () => {
    const base = fixtureBlocks()
    const changed = fixtureBlocks({
      agent: {
        ...fixtureBlocks().agent,
        inventory: [
          { kind: 'wood', qty: 9 },
          { kind: 'clay_pot', qty: 1 },
        ],
      },
    })
    const ua = assembleAdjudicationPrompt(base).messages[0].content
    const ub = assembleAdjudicationPrompt(changed).messages[0].content

    // Mask the one differing line; the rest must be byte-identical.
    expect(ua.replace('2 wood', '9 wood')).toBe(ub)
    expect(ua).not.toBe(ub)
  })
})

describe('adjudication prompt anti-eloquence', () => {
  it('carries numeric skills and inventory, and the intent exactly once at the end', () => {
    const blocks = fixtureBlocks()
    const r = assembleAdjudicationPrompt(blocks)

    expect(r.messages).toHaveLength(1)
    expect(r.messages[0].role).toBe('user')
    const user = r.messages[0].content

    expect(user).toContain('farming: 120')
    expect(user).toContain('2 wood')

    // The freeform intent is carried verbatim once, at the end — never woven
    // into the evidence prose.
    expect(user.split(blocks.intent).length - 1).toBe(1)
    expect(user.endsWith(blocks.intent)).toBe(true)
  })
})

describe('framing-free outputs contract', () => {
  it('FORBIDDEN_FRAMING catches A.I., plural models, and tools', () => {
    for (const bad of ['the A.I. decided', 'our models', 'tools']) {
      expect(bad).toMatch(FORBIDDEN_FRAMING)
    }
  })

  it('FORBIDDEN_FRAMING does not match reworded implements or substrings like toolkit', () => {
    expect('stone implements').not.toMatch(FORBIDDEN_FRAMING)
    expect('the toolkit sat on the bench').not.toMatch(FORBIDDEN_FRAMING)
  })

  it('assembly takes only structural blocks', () => {
    expect(assembleAdjudicationPrompt.length).toBe(1)
  })
})

describe('token estimate', () => {
  it('is ceil(totalChars/4) and monotonic in block size', () => {
    const base = assembleAdjudicationPrompt(fixtureBlocks())
    const totalChars = base.system.length + base.messages[0].content.length
    expect(base.estTokens).toBe(Math.ceil(totalChars / 4))

    const longerIntent = assembleAdjudicationPrompt(
      fixtureBlocks({ intent: 'I try to boil river water for salt. '.repeat(10) }),
    )
    expect(longerIntent.estTokens).toBeGreaterThan(base.estTokens)

    const longerCanon = assembleAdjudicationPrompt(fixtureBlocks({ canon: 'C'.repeat(2000) }))
    expect(longerCanon.estTokens).toBeGreaterThan(base.estTokens)
  })
})
