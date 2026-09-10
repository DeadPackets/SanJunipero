import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  FORBIDDEN_FRAMING,
  MINUTES_PER_DAY,
  simTimeFromTick,
  type SimEvent,
} from '@sj/shared'
import { fold, genesisState, submitIntent, type TileId, type WorldState } from '@sj/engine'
import { proposesALaw } from '../scene/scene.js'
import { assemblePrompt } from './assemble.js'
import { calendarLine, inTalkLine, perceptionToProse } from './prose.js'
import { CAPABILITIES, RULES_OF_BEING, SPEECH_RULES, WORKED_TURN } from './rulesOfBeing.js'
import { readMindTurn, StrictTurnSchema } from '../turn.js'
import { fixtureBlocks, quietMeadowPacket, tamarIdentity } from '../testutil/fixtures.js'

// Block 1 is the cache-stable prefix of every prompt.
function block1(): string {
  return [RULES_OF_BEING, CAPABILITIES, SPEECH_RULES].join('\n\n---\n\n')
}

describe('SPEECH_RULES', () => {
  it('carries the distilled humanizer rules, diegetically', () => {
    expect(SPEECH_RULES).toContain('plain words')
    expect(SPEECH_RULES).toContain('Half a sentence is fine')
    expect(SPEECH_RULES).toMatch(/plain/)
  })

  // The two deleted sentences are the ones the live transcript obeyed into an 81% talk rate
  // and a forty-line plank loop; silence and the decay ladder are what replaced them.
  it('makes silence the default and gives a repeat somewhere to go', () => {
    expect(SPEECH_RULES).toMatch(/Most of the time you say nothing/)
    expect(SPEECH_RULES).toMatch(/Once it is said, it is said/)
    expect(SPEECH_RULES).not.toMatch(/never wasted|words spent on/i)
    expect(SPEECH_RULES).not.toContain('in the words they said it')
  })

  it('aims a line at one person, lets it end, and keeps the counting out of it', () => {
    expect(SPEECH_RULES).toMatch(/one person at a time/)
    expect(SPEECH_RULES).toMatch(/do not have to get the last word/)
    expect(SPEECH_RULES).toMatch(/Map coordinates are for your feet/)
  })

  // The em dash ran at 35-54% of lines in a corpus produced with the old block already in the
  // prompt, and it was the one humanizer tell nothing here named.
  it('forbids the long dash', () => {
    expect(SPEECH_RULES).toMatch(/No dashes/)
  })

  it('spends no em dash of its own', () => {
    expect(SPEECH_RULES).not.toContain('—')
  })

  it('forbids only, and grants no voice', () => {
    // A shared block that hands every mind the same mannerism makes five copies of one actor.
    // Anything that makes a mind sound like someone in particular belongs on its own card.
    expect(SPEECH_RULES).not.toMatch(/\b(say|use|open with|begin with) ["'][a-z]/i)
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
    expect(CAPABILITIES).toMatch(/enter: [^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/exit: [^\n]*Nothing more is needed/)
    expect(CAPABILITIES).toMatch(/stow: [^\n]*itemId[^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/inscribe: [^\n]*structureId[^\n]*text/)
  })

  it('teaches that things are owned and that ownership is visible to all', () => {
    expect(CAPABILITIES).toContain("some things are someone's, and all can see whose")
  })

  it('replaces the "nothing can be shelved" paragraph with stow guidance', () => {
    expect(CAPABILITIES).not.toContain('no way yet to shelve')
    expect(CAPABILITIES).toMatch(/stow it/)
  })

  it('never names the machinery', () => {
    expect(CAPABILITIES).not.toMatch(FORBIDDEN_FRAMING)
  })

  // The K20 empty-act paragraph treated a DeepSeek fault. The back end the town now runs fills
  // its params on every call, so the prefix pays no bytes for it and the schema carries it.
  it('spends no bytes on the empty-act paragraph or its exemplars', () => {
    expect(CAPABILITIES).not.toContain('Every act carries what it asks for')
    expect(CAPABILITIES).not.toContain('An act named with nothing in it')
    expect(CAPABILITIES).not.toMatch(/mind who means/)
    expect(block1()).not.toContain('Every act carries what it asks for')
  })

  // Nothing in the prompt said "you may invent"; the old closing line said the opposite.
  it('carries the invitation, not the old promise of a lesson', () => {
    expect(CAPABILITIES).toContain(
      'Anything you can name, you can try. The world tells you what it cost.\n',
    )
    expect(CAPABILITIES).not.toContain('the world will show you')
  })

  // ★ The one worked answer. It has to be the last bytes of the block or every mind's cached
  // prefix moves, and it has to parse as the very thing the mind is asked for or it teaches
  // the wrong shape.
  it('closes on one whole answer that the turn schema itself accepts', () => {
    expect(CAPABILITIES.endsWith(WORKED_TURN)).toBe(true)
    const read = StrictTurnSchema.safeParse(JSON.parse(WORKED_TURN))
    expect(read.error?.issues ?? []).toEqual([])
    expect(readMindTurn(JSON.parse(WORKED_TURN)).data?.action).toEqual({
      verb: 'stoke',
      params: { structureId: 'structure_4' },
    })
  })

  it('keeps the example short enough to be worth its bytes', () => {
    expect(Math.ceil(WORKED_TURN.length / 4)).toBeLessThan(150)
  })

  // A shared block that hands every mind the same example makes five copies of one actor.
  it('names no founder', () => {
    for (const founder of ['Omar', 'Salma', 'Nadia', 'Amara', 'Yusuf']) {
      expect(CAPABILITIES, founder).not.toContain(founder)
    }
  })
})

// Discovery by schema is not knowledge: a verb registered and nameable but shown to nobody is
// a verb `hunt` can only ask for by an id no mind was ever given.
describe('CAPABILITIES — the twelve C11 Tier-1 verbs', () => {
  const C11_VERBS = [
    'drink',
    'fill',
    'dig_channel',
    'douse',
    'pave',
    'hunt',
    'wear',
    'doff',
    'kindle',
    'snuff',
    'stoke',
    'chop',
  ]

  it.each(C11_VERBS)('names %s with the word the registry answers to', (verb) => {
    expect(CAPABILITIES).toMatch(new RegExp(`^${verb}: name it ${verb}`, 'm'))
  })

  it('gives each of them exactly what its verb asks for', () => {
    expect(CAPABILITIES).toMatch(/hunt: [^\n]*faunaId/)
    expect(CAPABILITIES).toMatch(/forage: [^\n]*nodeId/)
    expect(CAPABILITIES).toMatch(/fill: [^\n]*itemId/)
    expect(CAPABILITIES).toMatch(/stoke: [^\n]*structureId/)
    expect(CAPABILITIES).toMatch(/dig_channel: [^\n]*x and y as two numbers/)
    expect(CAPABILITIES).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('leaves every verb a mind already had exactly where it was', () => {
    for (const verb of ['walk', 'sleep', 'enter', 'stow', 'craft', 'experiment']) {
      expect(CAPABILITIES).toMatch(new RegExp(`^${verb}: name it ${verb}`, 'm'))
    }
  })
})

// Asserting block 1's words on their own would be vacuous — any sentence contains itself — so
// each half of what it claims is run through `submitIntent` on a real world.
describe('★ block 1 tells the truth about sleep', () => {
  const CFG = DEFAULT_CONFIG
  const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
    seq,
    tick: 0,
    type,
    payload,
  })
  const sleepLine = CAPABILITIES.split('\n').find((l) => l.startsWith('sleep: '))!

  /** One roofed building at (2,1), one body, and a way to put it inside or leave it out. */
  function body(opts: { indoors: boolean; energy?: number }): WorldState {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (): TileId => 0))
    let s = genesisState(CFG, rows)
    s = fold(
      s,
      ev(1, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'b',
      }),
      CFG,
    )
    s = fold(s, ev(2, 'structure_completed', { id: 'structure_1' }), CFG)
    s = fold(
      s,
      ev(3, 'agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 3, ageDays: ADULT_AGE_DAYS }),
      CFG,
    )
    if (opts.indoors) {
      s = fold(s, ev(4, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CFG)
    }
    if (opts.energy !== undefined) {
      s = fold(
        s,
        ev(5, 'needs_changed', {
          id: 'a1',
          changes: [{ need: 'energy', delta: opts.energy - 100 }],
        }),
        CFG,
      )
    }
    return s
  }
  const trySleep = (s: WorldState) => submitIntent(s, CFG, 'a1', 'sleep', {})

  it('no longer says the thing that was false', () => {
    expect(sleepLine).not.toContain('Nothing more is needed')
  })

  it('a roof over you is what it takes — and the verb agrees, both ways', () => {
    expect(sleepLine).toContain('A roof over you is what it takes')
    expect(trySleep(body({ indoors: true })).ok).toBe(true)
    expect(trySleep(body({ indoors: false })).ok).toBe(false)
  })

  it('worn down far enough, the bare ground will do — and the verb agrees, both ways', () => {
    expect(sleepLine).toContain('the bare ground will do')
    const spare = CFG.needs.debuffThreshold + 10
    const spent = CFG.needs.debuffThreshold - 1
    expect(trySleep(body({ indoors: false, energy: spare })).ok).toBe(false)
    expect(trySleep(body({ indoors: false, energy: spent })).ok).toBe(true)
  })

  it('is still a fact about the hands and never counsel', () => {
    expect(sleepLine).not.toMatch(FORBIDDEN_FRAMING)
    expect(sleepLine).not.toMatch(/\b(festival|faith|council|market|should|gather|build)\b/i)
  })
})

describe('the shared calendar', () => {
  const at = (tick: number): string => calendarLine(simTimeFromTick(tick))

  it('names the day, the part of the day and the season, in that order', () => {
    // A season is a week now, so day 12 falls late in the first summer, not early in spring.
    expect(at(11 * MINUTES_PER_DAY + 19 * 60)).toBe('It is Friday, day 12, dusk, late summer.')
    expect(at(350 * MINUTES_PER_DAY + 3 * 60)).toBe('It is Monday, day 351, night, early autumn.')
    expect(at(222 * MINUTES_PER_DAY + 12 * 60)).toBe('It is Saturday, day 223, day, late winter.')
  })

  it('reaches every turn through the moment prose, ahead of everything else in it', () => {
    const prose = perceptionToProse({
      ...quietMeadowPacket,
      time: simTimeFromTick(11 * MINUTES_PER_DAY + 19 * 60),
    })
    expect(prose.startsWith('It is Friday, day 12, dusk, late summer.')).toBe(true)
    const a = assemblePrompt(fixtureBlocks({ now: { prose } }))
    expect(a.messages.at(-1)!.content).toContain('day 12, dusk, late summer')
  })

  it('is a fact and nothing more — no machinery, no counsel, no taxonomy', () => {
    for (const tick of [0, 11 * MINUTES_PER_DAY + 19 * 60, 350 * MINUTES_PER_DAY + 3 * 60]) {
      const line = at(tick)
      expect(line).not.toMatch(FORBIDDEN_FRAMING)
      expect(line).not.toMatch(
        /\b(festival|faith|council|market|milestone|tier|construct|should|gather)\b/i,
      )
    }
  })
})

// Block 1 is the cache-stable prefix, so what matters is that every prompt opens with the SAME
// one; the bytes themselves are free to be edited.
describe('block 1 is the shared prefix', () => {
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
    expect(a.system).toContain(
      'You usually say about 10 words at a time, and up to 40 when it really matters to you.',
    )
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
    const idx = without.system.indexOf('Example lines,')
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
    expect(terse.system).toContain(
      'about 4 words at a time, and up to 12 when it really matters to you.',
    )
    expect(talkative.system).toContain(
      'about 30 words at a time, and up to 90 when it really matters to you.',
    )
    expect(terse.system).not.toBe(talkative.system)
  })
})

describe('CAPABILITIES — the four acts that need another person to agree', () => {
  const RELATIONSHIP_VERBS = ['court', 'propose', 'lie_with', 'leave_partner']

  it.each(RELATIONSHIP_VERBS)('names %s with the word the registry answers to', (verb) => {
    expect(CAPABILITIES).toMatch(new RegExp(`^${verb}: name it ${verb}. Give targetId`, 'm'))
  })

  it('says who answers, and that three of the four need a yes', () => {
    expect(CAPABILITIES).toMatch(/court: [^\n]*whoever is near may hear the answer/)
    expect(CAPABILITIES).toMatch(/propose: [^\n]*Only they can say yes/)
    expect(CAPABILITIES).toMatch(/lie_with: [^\n]*only if they say yes/)
    expect(CAPABILITIES).toMatch(/leave_partner: [^\n]*needs no answer/)
  })

  // The roof gate is the whole of it: 31 of rehearsal 13's 42 ask refusals read "not under a
  // roof of your own", and the line never said the rule before the mind spent the turn.
  it('says the roof rule on the line it gates, before the ask', () => {
    expect(CAPABILITIES).toMatch(
      /lie_with: [^\n]*a house that is yours or theirs, with the two of you inside it/,
    )
    expect(CAPABILITIES).toMatch(/lie_with: [^\n]*neither will standing outside one/)
  })

  it('warns that a child may come of one of them, and names no dial behind it', () => {
    expect(CAPABILITIES).toContain('A child may come of it')
    expect(CAPABILITIES).not.toMatch(/chance|roll|percent|1 in /i)
  })

  it('never names the machinery', () => {
    for (const verb of RELATIONSHIP_VERBS) {
      const line = CAPABILITIES.split('\n').find((l) => l.startsWith(`${verb}:`))!
      expect(line, verb).not.toMatch(FORBIDDEN_FRAMING)
    }
  })
})

// r13: 49 of 106 talks ended because the turn walked off or went to bed without knowing it was
// in one. The turn is told, every turn it is, and told the others will remember how it left.
describe('a mind in a talk is told so', () => {
  it('names who it is talking to and what leaving costs, and says nothing when it is not in one', () => {
    expect(inTalkLine([])).toBe('')
    const one = inTalkLine(['Omar'])
    expect(one).toContain('You are in a conversation with Omar right now.')
    expect(one).toContain('answer wait and keep talking')
    expect(one).toContain('Omar will remember whether you walked off or said goodbye.')
    expect(inTalkLine(['Omar', 'Salma', 'Nadia'])).toContain('with Omar, Salma and Nadia right now')
  })
})

describe('★ the body on the page is the only body', () => {
  it('a mind may not invent an ailment for itself or anyone else', () => {
    expect(SPEECH_RULES).toContain('Your body is what the page says it is, and nothing else.')
    expect(SPEECH_RULES).toContain(
      'another person is ill or hurt only when the page says so beside their name',
    )
  })

  // r45 invented a back and r47 a cough. The cough came from this very rule, which used to say
  // "a cough you have carried for years is yours to mention" and then "a cough nobody's body
  // has is a story that never ends". Name an ailment in a mind's prompt and the town catches it.
  it('★ names no ailment of its own, because a named one gets caught', () => {
    for (const ailment of ['cough', 'fever', 'ache', 'limp', 'wound'])
      expect(SPEECH_RULES.toLowerCase(), ailment).not.toContain(ailment)
  })

  // The loophole that let it last seven days: a condition the world cannot hold can never be
  // cured, so the scenes about it never stop.
  it('★ allows no long-carried trouble the world has no way to end', () => {
    expect(SPEECH_RULES).not.toContain('plus whatever has always been true of you')
    expect(SPEECH_RULES).toContain('there is no old trouble you have carried for years either')
  })
})

// The council machinery is complete - proposal, quorum, tally, tabling, lapse, repeal - and in
// r45 and r47 it fired zero times. No mind was ever told the town can hold a rule, and laws only
// appear in a prompt once one exists, so the first one could never be made.
describe('★ a mind is told the town can hold a rule', () => {
  it('says three can bind the town, and that a rule is said out loud', () => {
    expect(CAPABILITIES).toContain('Three or more of you standing together can agree something')
    expect(CAPABILITIES).toContain('a later room of three can let it go')
  })

  // The load-bearing half: the register the prompt teaches has to be one the scene detector
  // actually hears, or a mind does everything right and no council ever opens.
  it('★ speaks in a register the scene detector recognises as a proposal', () => {
    const taught = 'From now on, this is how we do it.'
    expect(CAPABILITIES.toLowerCase()).toContain('from now on')
    expect(proposesALaw(taught)).toBe(true)
  })

  // r49 ran four sim-days on these exact words and produced zero proposals, and not one line in
  // the taught register. They sat at the end of the speak: grammar, in a list of fifteen verbs,
  // where they read as a parameter and not as a thing a person might want. Presence was already
  // pinned above and presence was never the problem, so this pins where the words sit.
  it("★ stands on its own, not buried in a verb's grammar", () => {
    const speak = CAPABILITIES.split('\n').find((l) => l.startsWith('speak:')) ?? ''
    expect(speak).toBe('speak: name it speak. Give text, the words you say aloud')
    expect(CAPABILITIES).toContain("\n\nSome things are not one person's to decide.")
  })
})

describe('★ looking is not an experiment', () => {
  it('the experiment door is for hands, not eyes', () => {
    expect(CAPABILITIES).toContain('what you attempt with your hands to make or change something')
    expect(CAPABILITIES).toContain('Looking, checking, counting and inspecting are not experiments')
  })
})
