import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assemblePrompt } from './assemble.js'
import { CAPABILITIES, FORBIDDEN_FRAMING, RULES_OF_BEING, SPEECH_RULES } from './rulesOfBeing.js'
import { fixtureBlocks, tamarIdentity } from '../testutil/fixtures.js'

// Block 1 is the cache-stable prefix of every prompt. Task 17 rewrites it once
// (SPEECH_RULES + stow/ownership capabilities) and then it is frozen: this hash
// is the enforcement point, not documentation.
const BLOCK1_SHA256 = 'fa7892fb6f29d253ae44c9cd57a55c9b40751b97a1d110eaadf9c2ae3ff788d0'

function block1(): string {
  return [RULES_OF_BEING, CAPABILITIES, SPEECH_RULES].join('\n\n---\n\n')
}

describe('SPEECH_RULES', () => {
  it('carries the distilled humanizer rules, diegetically', () => {
    expect(SPEECH_RULES).toContain('single word')
    expect(SPEECH_RULES).toContain('fragment')
    expect(SPEECH_RULES).toContain('unfinished')
    expect(SPEECH_RULES).toMatch(/just said/)
    expect(SPEECH_RULES).toMatch(/plain/)
    expect(SPEECH_RULES).toMatch(/three|threes/)
  })

  it('never names the machinery', () => {
    expect(SPEECH_RULES).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('lands in the system prompt immediately after CAPABILITIES', () => {
    const a = assemblePrompt(fixtureBlocks())
    expect(a.system).toContain(SPEECH_RULES)
    expect(a.system.indexOf(SPEECH_RULES)).toBeGreaterThan(a.system.indexOf(CAPABILITIES))
    expect(a.system).toContain(`${CAPABILITIES}\n\n---\n\n${SPEECH_RULES}`)
  })
})

describe('CAPABILITIES — C9 verbs and ownership', () => {
  it('names enter, exit, stow and inscribe with their exact parameter keys', () => {
    expect(CAPABILITIES).toMatch(/enter — [^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/exit — [^\n]*nothing more is needed/)
    expect(CAPABILITIES).toMatch(/stow — [^\n]*itemId[^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/inscribe — [^\n]*structureId[^\n]*text/)
  })

  it('teaches that things are owned and that ownership is visible to all', () => {
    expect(CAPABILITIES).toContain("some things are someone's — all can see whose")
  })

  it('replaces the "nothing can be shelved" paragraph with stow guidance', () => {
    expect(CAPABILITIES).not.toContain('no way yet to shelve')
    expect(CAPABILITIES).toMatch(/stow it/)
  })

  it('never names the machinery', () => {
    expect(CAPABILITIES).not.toMatch(FORBIDDEN_FRAMING)
  })
})

describe('block 1 is frozen', () => {
  it('matches its pinned bytes', () => {
    expect(createHash('sha256').update(block1(), 'utf8').digest('hex')).toBe(BLOCK1_SHA256)
  })

  it('opens every system prompt, unchanged by identity or personality', () => {
    const a = assemblePrompt(fixtureBlocks())
    const b = assemblePrompt(
      fixtureBlocks({ identity: { ...tamarIdentity, name: 'Edda', age: 61 } }),
    )
    expect(a.system.startsWith(block1())).toBe(true)
    expect(b.system.startsWith(block1())).toBe(true)
  })
})

describe('word budgets', () => {
  it('renders the budget line when the voice card carries one', () => {
    const a = assemblePrompt(
      fixtureBlocks({
        identity: {
          ...tamarIdentity,
          voiceCard: { ...tamarIdentity.voiceCard, wordBudget: { typical: 10, burst: 40 } },
        },
      }),
    )
    expect(a.system).toContain('You usually say about 10 words at a time; when truly moved, up to 40.')
    expect(a.system).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('renders nothing at all when absent — byte-stable against today', () => {
    const withBudget = assemblePrompt(
      fixtureBlocks({
        identity: {
          ...tamarIdentity,
          voiceCard: { ...tamarIdentity.voiceCard, wordBudget: { typical: 10, burst: 40 } },
        },
      }),
    )
    const without = assemblePrompt(fixtureBlocks())
    expect(without.system).not.toContain('You usually say about')
    expect(without.system).not.toContain('words at a time')
    expect(without.system.length).toBeLessThan(withBudget.system.length)
    // The only difference is the appended line: everything before it is identical.
    const idx = without.system.indexOf('Example lines:')
    expect(withBudget.system.slice(0, idx)).toBe(without.system.slice(0, idx))
  })

  it('two personas with different budgets differ only in that line', () => {
    const terse = assemblePrompt(
      fixtureBlocks({
        identity: {
          ...tamarIdentity,
          voiceCard: { ...tamarIdentity.voiceCard, wordBudget: { typical: 4, burst: 12 } },
        },
      }),
    )
    const talkative = assemblePrompt(
      fixtureBlocks({
        identity: {
          ...tamarIdentity,
          voiceCard: { ...tamarIdentity.voiceCard, wordBudget: { typical: 30, burst: 90 } },
        },
      }),
    )
    expect(terse.system).toContain('about 4 words at a time; when truly moved, up to 12.')
    expect(talkative.system).toContain('about 30 words at a time; when truly moved, up to 90.')
    expect(terse.system).not.toBe(talkative.system)
  })
})
