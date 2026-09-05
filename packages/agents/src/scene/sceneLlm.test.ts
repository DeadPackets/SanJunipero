import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { assemblePrompt, type IdentityCore } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { fixtureBlocks, tamarIdentity } from '../testutil/fixtures.js'
import type { Tie } from '../memory/ties.js'
import {
  makeSceneLlm,
  sceneBlock,
  sceneWordCap,
  threadLinesFor,
  type SceneVoice,
} from './sceneLlm.js'
import { openScene, SceneTurnSchema, type SceneAsk, type SceneLine } from './scene.js'
import { askPhrase } from './invitations.js'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const MORNING = 10 * 60
const PAST_MIDNIGHT = 24 * 60 + 60
const SMALL_HOURS = 24 * 60 + 4 * 60
const JUST_DARK = 21 * 60

const LIVING = [
  { id: 'tamar', name: 'Tamar' },
  { id: 'yusuf', name: 'Yusuf' },
  { id: 'nadia', name: 'Nadia' },
]

const CARDED: IdentityCore = {
  ...tamarIdentity,
  voiceCard: { ...tamarIdentity.voiceCard, wordBudget: { typical: 11, burst: 22 } },
}

function voice(overrides: Partial<SceneVoice> = {}): SceneVoice {
  const blocks = fixtureBlocks()
  return {
    identity: CARDED,
    personality: () => blocks.personality,
    livingCast: () => LIVING,
    ...overrides,
  }
}

const line = (agentId: string, text: string, aside = ''): SceneLine => ({
  agentId,
  text,
  aside,
  move: 'none',
  tick: 600,
})

function ask(overrides: Partial<SceneAsk> = {}): SceneAsk {
  const scene = openScene({
    openedTick: 600,
    participants: ['tamar', 'yusuf'],
    opener: 'yusuf',
    topic: 'the bread',
    stakes: 5,
  })
  return {
    scene,
    agentId: 'tamar',
    cast: [
      { id: 'tamar', name: 'Tamar' },
      { id: 'yusuf', name: 'Yusuf' },
    ],
    audience: [],
    ties: [],
    thread: [line('yusuf', 'Four days of bread, you said.')],
    wrapUp: false,
    tick: MORNING,
    energy: 80,
    ...overrides,
  }
}

const block = (a = ask(), v = voice()): string =>
  sceneBlock(a, { ...v, words: sceneWordCap(v.identity.voiceCard) })

function answering(text: string): { model: MockLanguageModelV4; prompts: string[] } {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const parts = (options.prompt as { role: string; content: unknown }[]).map((m) =>
        Array.isArray(m.content)
          ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
          : String(m.content),
      )
      prompts.push(parts.join('\n'))
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

function client(model: MockLanguageModelV4, caller = 'scene'): LlmClient {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return new LlmClient({ model, db, caller, agentId: 'tamar', maxRetries: 0 })
}

const TURN = JSON.stringify({
  thought: 'He is counting wrong again.',
  speech: 'Three, and I counted this morning.',
  to: null,
  gesture: null,
  move: 'press',
  stance: null,
  answer: null,
  ask: null,
  leave: false,
  importance: 4,
})

describe('the scene turn keeps the cached prefix', () => {
  it('sends the ordinary turn’s system prompt, byte for byte', () => {
    const blocks = fixtureBlocks()
    const turnSystem = assemblePrompt({
      ...blocks,
      rulesOfBeing: RULES_OF_BEING,
      identity: CARDED,
    }).system
    const { model, prompts } = answering(TURN)
    const llm = makeSceneLlm(client(model), voice())
    return llm.line(ask()).then(() => {
      expect(prompts[0]).toContain(turnSystem)
    })
  })

  // The frontier is one more block between customs and identity, so a scene line that skipped it
  // ended the shared prefix there and cached the autobiography a second time per mind.
  it('sends the frontier the ordinary turn sends, so the prefix runs to the end', () => {
    const frontier = ['the ridge past the north field']
    const blocks = fixtureBlocks()
    const turnSystem = assemblePrompt({
      ...blocks,
      rulesOfBeing: RULES_OF_BEING,
      identity: CARDED,
      frontier,
    }).system
    const { model, prompts } = answering(TURN)
    const llm = makeSceneLlm(client(model), voice({ frontier: () => frontier }))
    return llm.line(ask()).then(() => {
      expect(prompts[0]).toContain(turnSystem)
    })
  })

  it('replaces every volatile block with one scene block', async () => {
    const { model, prompts } = answering(TURN)
    const llm = makeSceneLlm(client(model), voice())
    await llm.line(ask())
    const blocks = fixtureBlocks()
    // The journal, the day log and the moment prose are what a turn pays for every time.
    expect(prompts[0]).not.toContain(blocks.dayLog[0])
    expect(prompts[0]).not.toContain('You turn back the pages')
    expect(prompts[0]).toContain('It is your turn.')
  })
})

describe('the scene block', () => {
  it('names the living cast and closes the roll', () => {
    expect(block()).toContain('Everyone alive in the valley: Tamar, Yusuf, Nadia.')
    expect(block()).toContain('has never lived here')
  })

  it('names who is standing here, and never the mind itself', () => {
    expect(block()).toContain('Standing with you: Yusuf.')
    expect(block()).not.toContain('Standing with you: Tamar')
  })

  it('names the audience apart from the cast, and offers `to`', () => {
    const text = block(ask({ audience: [{ id: 'nadia', name: 'Nadia' }] }))
    expect(text).toContain('Within earshot and not in the talk: Nadia.')
    expect(text).not.toContain('Standing with you: Nadia')
    expect(block()).toContain('Put in "to" the one name you are speaking to')
  })

  it('names one silent mind in the run cue rather than asking for somebody', () => {
    const text = block(
      ask({
        cast: [
          { id: 'tamar', name: 'Tamar' },
          { id: 'yusuf', name: 'Yusuf' },
          { id: 'nadia', name: 'Nadia' },
        ],
      }),
    )
    expect(text).toContain('Not a word yet from Nadia.')
    expect(text).toContain('Answer Nadia, or say nothing at all')
    expect(text).not.toContain('Answer them,')
  })

  it('says an arrival and a going as lines of the thread', () => {
    const thread = [
      line('yusuf', 'Four days of bread, you said.'),
      { ...line('nadia', ''), presence: 'joined' as const },
      { ...line('yusuf', ''), presence: 'left' as const },
    ]
    const text = block(ask({ thread }))
    expect(text).toContain('Nadia joins.')
    expect(text).toContain('Yusuf leaves.')
    expect(text).not.toContain('Nadia: ""')
  })
})

// A live run measured the scene path at 84.9% cache read and $0.00017 a line, a fifth of an
// ordinary turn. The roster is the one block a join rewrites, so it sits BELOW the thread: the
// thread only ever grows at its end, and everything above it stays byte-for-byte.
describe('a join does not throw the cached prefix away', () => {
  const THREAD = [
    line('yusuf', 'Four days of bread, you said, and it was three.'),
    line('tamar', 'I counted them out on the step.', 'he never listens'),
    line('yusuf', 'Then somebody else took one.'),
  ]
  const before = ask({ thread: THREAD, audience: [{ id: 'nadia', name: 'Nadia' }] })
  const after = ask({
    thread: [...THREAD, { ...line('nadia', ''), presence: 'joined' as const }],
    cast: [
      { id: 'tamar', name: 'Tamar' },
      { id: 'yusuf', name: 'Yusuf' },
      { id: 'nadia', name: 'Nadia' },
    ],
    audience: [],
  })

  const common = (a: string, b: string): number => {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return i
  }

  it('leaves every byte before the thread exactly where it was', () => {
    const a = block(before)
    const b = block(after)
    const head = a.slice(0, a.indexOf('What has been said'))
    expect(head.length).toBeGreaterThan(0)
    expect(b.startsWith(head), 'the answer contract, the cast law, ties and want all hold').toBe(
      true,
    )
  })

  it('holds the shared prefix through the thread the join did not touch', () => {
    const a = block(before)
    const b = block(after)
    // Everything up to and including "Then somebody else took one." is common; only the arrival
    // line and the roster under it are re-read.
    expect(common(a, b)).toBeGreaterThan(a.indexOf('Then somebody else took one.'))
    expect(common(a, b) / a.length, 'four fifths of the block survives a join').toBeGreaterThan(
      0.75,
    )
  })

  it('shows the last six lines only, to a pair', () => {
    const thread = Array.from({ length: 9 }, (_, i) => line('yusuf', `line number ${i}`))
    const text = block(ask({ thread }))
    expect(text).not.toContain('line number 2')
    expect(text).toContain('line number 3')
    expect(text).toContain('line number 8')
  })

  // Six lines of twelve is half a round, and a mind answering half a round reads as talking
  // past people. The window is a whole round, floored at the pair's six and capped at twelve.
  it('shows a whole round however big the cast, and never more than twelve lines', () => {
    expect(threadLinesFor(2)).toBe(6)
    expect(threadLinesFor(6)).toBe(6)
    expect(threadLinesFor(12)).toBe(12)
    expect(threadLinesFor(20), 'and never more than twelve').toBe(12)
    for (const n of [2, 6, 12]) expect(threadLinesFor(n)).toBeGreaterThanOrEqual(Math.min(n, 12))
  })

  it('reads a whole round back at twelve, where six lines saw half of one', () => {
    const cast = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Person${i}` }))
    const thread = Array.from({ length: 20 }, (_, i) => line(`p${i % 12}`, `line number ${i}`))
    const text = block(ask({ agentId: 'p0', cast, thread }))
    expect(text).not.toContain('line number 7')
    expect(text).toContain('line number 8')
    expect(text).toContain('line number 19')
  })

  it('keeps this mind’s own asides and shows no others', () => {
    const thread = [line('tamar', 'I counted it.', 'he never listens'), line('yusuf', 'Did you.')]
    const text = block(ask({ thread }))
    expect(text).toContain('(you were thinking: he never listens)')
    expect(text).toContain('You: "I counted it."')
    expect(text).toContain('Yusuf: "Did you."')
  })

  it('sanitizes a spoken line before it becomes a quote in the prompt', () => {
    const text = block(ask({ thread: [line('yusuf', 'he said "four days"\nand left')] }))
    expect(text).toContain(`Yusuf: "he said 'four days' and left"`)
  })

  it('caps the line at the persona’s typical length, never its burst', () => {
    expect(sceneWordCap(CARDED.voiceCard)).toBe(11)
    expect(block()).toContain('No more than 11 words.')
    expect(block()).not.toContain('22 words')
  })

  it('falls back to the town’s median line for a persona with no card', () => {
    expect(sceneWordCap(tamarIdentity.voiceCard)).toBe(16)
  })

  it('asks for an answer or a silence, and on the wrap-up cue asks for the last word', () => {
    expect(block()).toContain('Answer Yusuf, or say nothing at all and let the talk end.')
    expect(block(ask({ wrapUp: true }))).toContain('Say the last thing you have to say')
  })

  it('renders open ties by name, and nothing at all when there are none', () => {
    const ties: Tie[] = [
      {
        id: 1,
        personId: 'yusuf',
        kind: 'debt',
        text: 'he owes you a day on the well gate',
        tick: 300,
        settledTick: null,
        source: 'scene',
      },
    ]
    expect(block(ask({ ties }))).toContain('Yusuf, a debt: he owes you a day on the well gate')
    expect(block()).not.toContain('What already stands between you')
  })

  it('says nothing about wanting until there is a want', () => {
    expect(block()).not.toContain('What you want most')
    const withWant = voice({ want: () => 'a roof that holds the winter' })
    expect(block(ask(), withWant)).toContain('What you want most: a roof that holds the winter')
  })

  it('tells the mind this moment is not an act', () => {
    expect(block()).toContain('This moment is not an act')
  })
})

describe('the hour, and the body that has to sit through it', () => {
  it('says nothing at all by day to a body with something left in it', () => {
    const text = block()
    expect(text).not.toContain('Sleep will keep')
    expect(text).not.toContain('midnight')
    expect(text).not.toContain('Weariness')
  })

  it('tells the hour after dark, in the words somebody outdoors would use', () => {
    expect(block(ask({ tick: JUST_DARK }))).toContain('It is late, and the town has gone quiet')
    expect(block(ask({ tick: PAST_MIDNIGHT }))).toContain('It is past midnight.')
    expect(block(ask({ tick: SMALL_HOURS }))).toContain('The night is nearly out.')
  })

  it('says the tiredness as weariness and never as a number', () => {
    expect(block(ask({ energy: 40 }))).toContain('Weariness drags at your limbs.')
    expect(block(ask({ energy: 20 }))).toContain('Your eyes keep closing.')
    expect(block(ask({ energy: 20 }))).not.toContain('20')
  })

  it('leaves both doors open, and sends nobody to bed', () => {
    const text = block(ask({ tick: PAST_MIDNIGHT, energy: 20 }))
    expect(text).toContain('Sleep will keep. Stay while the talk is worth it')
    expect(text).toContain('say that you leave when it is not')
    // Nothing in it tells a mind to go: a night owl reads the same sentence and stays.
    expect(text).not.toMatch(/go to bed|you should sleep|time to sleep/i)
  })

  it('costs a daylight line nothing, and a midnight line one short paragraph', () => {
    const est = (t: string): number => Math.ceil(t.length / 4)
    const day = est(block())
    const worst = est(block(ask({ tick: PAST_MIDNIGHT, energy: 20 })))
    expect(worst - day, 'the whole of what a late line adds').toBeLessThanOrEqual(40)
    expect(est(block(ask({ tick: PAST_MIDNIGHT, energy: 80 }))) - day).toBeLessThanOrEqual(30)
  })
})

describe('the line call', () => {
  it('is one call, billed to the caller that pays for a scene', async () => {
    const { model, prompts } = answering(TURN)
    const llm = makeSceneLlm(client(model), voice())
    const turn = await llm.line(ask())
    expect(prompts).toHaveLength(1)
    expect(turn.speech).toBe('Three, and I counted this morning.')
    expect(turn.move).toBe('press')
  })

  it('lets a refusal through to the coordinator, which is what catches it', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('provider said no')
      },
    })
    const llm = makeSceneLlm(client(model), voice())
    await expect(llm.line(ask())).rejects.toThrow(/provider said no/)
  })
})

describe('the close', () => {
  const closed = () => {
    const scene = openScene({
      openedTick: 600,
      participants: ['tamar', 'yusuf'],
      opener: 'yusuf',
      topic: 'the bread',
      stakes: 5,
    })
    scene.thread = [
      line('yusuf', 'I will cut you a third loaf tomorrow.', 'she will hold me to it'),
      line('tamar', 'Tomorrow, then.'),
    ]
    scene.closeReason = 'ended'
    return {
      scene,
      cast: [
        { id: 'tamar', name: 'Tamar' },
        { id: 'yusuf', name: 'Yusuf' },
      ],
    }
  }

  const answer = (ties: unknown[]): string =>
    JSON.stringify({ summary: 'Yusuf promised Tamar a third loaf.', ties })

  it('reads the whole thread with everybody’s asides, and why it ended', async () => {
    const { model, prompts } = answering(answer([]))
    const llm = makeSceneLlm(client(model), voice())
    await llm.close(closed())
    expect(prompts[0]).toContain('(Yusuf was thinking: she will hold me to it)')
    expect(prompts[0]).toContain('It ended because they had said what there was to say.')
    expect(prompts[0]).toContain('Who was there: Tamar, Yusuf.')
  })

  it('turns the names it was given back into ids', async () => {
    const { model } = answering(
      answer([
        { holder: 'Tamar', about: 'Yusuf', kind: 'promise', text: 'a third loaf', settled: false },
      ]),
    )
    const llm = makeSceneLlm(client(model), voice())
    const out = await llm.close(closed())
    expect(out.summary).toBe('Yusuf promised Tamar a third loaf.')
    expect(out.deltas).toEqual([
      { agentId: 'tamar', personId: 'yusuf', kind: 'promise', text: 'a third loaf' },
    ])
  })

  it('drops a tie about somebody who was not there, and a tie about oneself', async () => {
    const { model } = answering(
      answer([
        { holder: 'Tamar', about: 'Kepler', kind: 'grudge', text: 'invented', settled: false },
        { holder: 'Tamar', about: 'Tamar', kind: 'secret', text: 'her own', settled: false },
        { holder: 'Yusuf', about: 'Tamar', kind: 'debt', text: 'a loaf', settled: false },
      ]),
    )
    const llm = makeSceneLlm(client(model), voice())
    const out = await llm.close(closed())
    expect(out.deltas).toEqual([
      { agentId: 'yusuf', personId: 'tamar', kind: 'debt', text: 'a loaf' },
    ])
  })

  it('carries a settled tie through as settled', async () => {
    const { model } = answering(
      answer([
        { holder: 'Tamar', about: 'Yusuf', kind: 'debt', text: 'the well gate', settled: true },
      ]),
    )
    const llm = makeSceneLlm(client(model), voice())
    const out = await llm.close(closed())
    expect(out.deltas[0]?.settled).toBe(true)
  })

  it('keeps at most six ties out of one scene', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      holder: 'Tamar',
      about: 'Yusuf',
      kind: 'slight',
      text: `slight ${i}`,
      settled: false,
    }))
    const { model } = answering(answer(many))
    const llm = makeSceneLlm(client(model), voice())
    expect((await llm.close(closed())).deltas).toHaveLength(6)
  })
})

describe('the one thing an invitation line has to settle', () => {
  const asked = (to: string): SceneAsk => {
    const a = ask()
    a.scene.invitation = { verb: 'court', from: 'yusuf', to, askedTick: 600 }
    return a
  }

  it('puts the question to the one who has to answer it, by name', () => {
    const said = block(asked('tamar'))
    expect(said).toContain(askPhrase('court', 'Yusuf'))
    expect(said).toContain('accept or refuse')
  })

  it('says nothing of it to the one who asked', () => {
    expect(block(asked('yusuf'))).not.toContain(askPhrase('court', 'Yusuf'))
  })

  it('costs a talk with no invitation in it not one byte', () => {
    expect(block()).not.toContain(askPhrase('court', 'Yusuf'))
    expect(block()).toBe(block(ask()))
  })

  it('teaches the ask and the answer in the same breath, every line', () => {
    expect(block()).toContain('put in "ask"')
    expect(block()).toContain('answer it in "answer": accept or refuse')
    expect(block()).toContain('lie_with')
  })
})

describe('what a scene turn may name', () => {
  const turn = (over: Record<string, unknown> = {}): unknown => ({
    thought: 'Well.',
    speech: 'Yes.',
    to: null,
    gesture: null,
    move: 'none',
    stance: null,
    answer: null,
    ask: null,
    leave: false,
    importance: 4,
    ...over,
  })

  it('takes the three asks and an empty one, and no word of its own invention', () => {
    for (const verb of ['court', 'propose', 'lie_with', null]) {
      expect(SceneTurnSchema.safeParse(turn({ ask: verb })).success, String(verb)).toBe(true)
    }
    expect(SceneTurnSchema.safeParse(turn({ ask: 'marry' })).success).toBe(false)
    expect(SceneTurnSchema.safeParse(turn({ ask: undefined })).success).toBe(false)
  })
})
