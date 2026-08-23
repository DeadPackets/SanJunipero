import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import { calendarLine, perceptionToProse } from './prose.js'
import { CAPABILITIES, FORBIDDEN_FRAMING, RULES_OF_BEING, SPEECH_RULES } from './rulesOfBeing.js'
import { fixtureBlocks, quietMeadowPacket, tamarIdentity } from '../testutil/fixtures.js'

// Block 1 is the cache-stable prefix of every prompt. Task 17 rewrites it once
// (SPEECH_RULES + stow/ownership capabilities) and then it is frozen: this hash
// is the enforcement point, not documentation.
// Moved once since, by C11 batch-7 controller ruling 5 — the one-time authorized
// amendment adding the twelve C11 Tier-1 verbs to CAPABILITIES. Re-pinned in that
// same commit; the prefix is frozen again from here.
//
// MOVED A SECOND TIME by the claim-seam lane, for one line: `build` no longer takes a
// coordinate in a town, and the block was still telling minds to give one. It is the one
// place a mind is taught its own hands, so a line that names a parameter the verb refuses is
// a trap rather than a stale comment. Nothing else in the block changed; the diff is the
// `build` row alone, and the reasoning is on CAPABILITIES itself.
// Previous value (C11 batch-7 ruling 5): 28c1fce0781ec9019416c234a9eae47401ff4b9dc4a96b91c371335fbad97bd6
const BLOCK1_SHA256 = '4205d892c18a91de4c9c3a50f0122abaad0d6170488455419dc045bfc4d50065'

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

// Batch-7 ruling 5, the one-time amendment: twelve verbs were registered, nameable, and shown
// to nobody. The mini-rehearsal found `drink` and `fill` through the turn schema alone;
// discovery by schema is not knowledge, and `hunt` proved it by asking for an id no mind had.
describe('CAPABILITIES — the twelve C11 Tier-1 verbs', () => {
  const C11_VERBS = [
    'drink', 'fill', 'dig_channel', 'douse', 'pave', 'hunt',
    'wear', 'doff', 'kindle', 'snuff', 'stoke', 'chop',
  ]

  it.each(C11_VERBS)('names %s with the word the registry answers to', (verb) => {
    expect(CAPABILITIES).toMatch(new RegExp(`^${verb} — name it ${verb}`, 'm'))
  })

  it('gives each of them exactly what its verb asks for', () => {
    expect(CAPABILITIES).toMatch(/hunt — [^\n]*faunaId/)
    expect(CAPABILITIES).toMatch(/forage — [^\n]*nodeId/)
    expect(CAPABILITIES).toMatch(/fill — [^\n]*itemId/)
    expect(CAPABILITIES).toMatch(/stoke — [^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/dig_channel — [^\n]*x and y as two numbers/)
    expect(CAPABILITIES).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('leaves every verb a mind already had exactly where it was', () => {
    for (const verb of ['walk', 'sleep', 'enter', 'stow', 'craft', 'experiment']) {
      expect(CAPABILITIES).toMatch(new RegExp(`^${verb} — name it ${verb}`, 'm'))
    }
  })
})

describe('the shared calendar', () => {
  const at = (tick: number): string => calendarLine(simTimeFromTick(tick))

  it('names the day, the part of the day and the season, in that order', () => {
    expect(at(11 * MINUTES_PER_DAY + 19 * 60)).toBe('It is day 12, dusk, early spring.')
    expect(at(350 * MINUTES_PER_DAY + 3 * 60)).toBe('It is day 351, night, late winter.')
    expect(at(222 * MINUTES_PER_DAY + 12 * 60)).toBe('It is day 223, day, mid autumn.')
  })

  it('reaches every turn through the moment prose, ahead of everything else in it', () => {
    const prose = perceptionToProse({
      ...quietMeadowPacket, time: simTimeFromTick(11 * MINUTES_PER_DAY + 19 * 60),
    })
    expect(prose.startsWith('It is day 12, dusk, early spring.')).toBe(true)
    const a = assemblePrompt(fixtureBlocks({ now: { prose } }))
    expect(a.messages.at(-1)!.content).toContain('day 12, dusk, early spring')
  })

  it('is a fact and nothing more — no machinery, no counsel, no taxonomy', () => {
    for (const tick of [0, 11 * MINUTES_PER_DAY + 19 * 60, 350 * MINUTES_PER_DAY + 3 * 60]) {
      const line = at(tick)
      expect(line).not.toMatch(FORBIDDEN_FRAMING)
      expect(line).not.toMatch(/\b(festival|faith|council|market|milestone|tier|construct|should|gather)\b/i)
    }
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
