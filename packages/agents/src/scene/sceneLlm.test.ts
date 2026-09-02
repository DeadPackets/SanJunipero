import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { assemblePrompt, type IdentityCore } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { fixtureBlocks, tamarIdentity } from '../testutil/fixtures.js'
import type { Tie } from '../memory/ties.js'
import { makeSceneLlm, sceneBlock, sceneWordCap, type SceneVoice } from './sceneLlm.js'
import { openScene, type SceneAsk, type SceneLine } from './scene.js'

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
  gesture: null,
  move: 'press',
  stance: null,
  answer: null,
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

  it('shows the last six lines only', () => {
    const thread = Array.from({ length: 9 }, (_, i) => line('yusuf', `line number ${i}`))
    const text = block(ask({ thread }))
    expect(text).not.toContain('line number 2')
    expect(text).toContain('line number 3')
    expect(text).toContain('line number 8')
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
