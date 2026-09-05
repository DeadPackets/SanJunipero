import { describe, expect, it } from 'vitest'
import { LawPredicateSchema } from '@sj/engine'
import { LAW_FIXTURE, LAW_FIXTURE_FIRE_PIT, LAW_FIXTURE_STOREHOUSE } from '@sj/shared/testutil'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/llm'
import {
  COMPILE_INSTRUCTION,
  LawCompileSchema,
  makeCouncil,
  NO_WORD_FOR_IT,
  PLAIN_WHY,
  type LawCompileAnswer,
  type LawCompileAsk,
} from './council.js'
import { strictDialect } from './testutil/scriptedLlm.js'

const PLACES = [
  { id: LAW_FIXTURE_STOREHOUSE, kind: 'storehouse', name: 'the Long Shed' },
  { id: LAW_FIXTURE_FIRE_PIT, kind: 'fire_pit' },
]
const THINGS = { itemKinds: ['grain', 'wood', 'plank'], structureKinds: ['storehouse', 'fire_pit'] }

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

type CourtLog = { objectCalls: number; callers: string[]; systems: string[]; users: string[] }

/** Answers in the dialect the court is asked for, counts the calls, and remembers who it was
 *  asked as — the ledger line and the pinned settings both hang off that name. */
class FakeCourt {
  constructor(
    private readonly answers: readonly unknown[],
    readonly log: CourtLog,
  ) {}

  forCaller(caller: string): FakeCourt {
    this.log.callers.push(caller)
    return new FakeCourt(this.answers, this.log)
  }

  object(opts: {
    system: string
    messages: LlmMessage[]
    schema: unknown
  }): Promise<{ value: unknown; usage: LlmUsage }> {
    this.log.systems.push(opts.system)
    this.log.users.push(opts.messages.at(-1)?.content ?? '')
    const raw = this.answers[Math.min(this.log.objectCalls, this.answers.length - 1)]
    this.log.objectCalls += 1
    return Promise.resolve({ value: strictDialect(raw, LawCompileSchema), usage: emptyUsage() })
  }
}

const answer = (over: Partial<LawCompileAnswer>): unknown => ({
  predicate: { kind: 'none' },
  repeals: null,
  why: 'plain words, and nothing the world can watch for',
  ...over,
})

function rig(answers: readonly unknown[], vocabulary = THINGS) {
  const court: CourtLog = { objectCalls: 0, callers: [], systems: [], users: [] }
  const compile = makeCouncil({
    llm: new FakeCourt(answers, court) as unknown as LlmClient,
    vocabulary,
  })
  return { court, compile }
}

const asking = (text: string, standing: LawCompileAsk['standing'] = []): LawCompileAsk => ({
  text,
  standing,
  places: PLACES,
})

describe('the court reads a rule the town agreed', () => {
  it('turns each of the three the prototype reached into its own shape', async () => {
    for (const law of LAW_FIXTURE) {
      const { compile, court } = rig([answer({ predicate: law.predicate as never, why: law.why })])
      const got = await compile(asking(law.text))
      expect(got.predicate, law.name).toEqual(law.predicate)
      expect(LawPredicateSchema.safeParse(got.predicate).success).toBe(true)
      expect(got.why).toBe(law.why)
      expect(court.objectCalls, 'one call per rule that passed').toBe(1)
    }
  })

  it('asks as the caller the ledger and the pins both know', async () => {
    const { compile, court } = rig([answer({})])
    await compile(asking('Let us agree nobody shouts at the well.'))
    expect(court.callers).toEqual(['law.compile'])
  })

  it('teaches the shapes in one system prompt that never moves', async () => {
    const { compile, court } = rig([answer({}), answer({})])
    await compile(asking('From this day the fire is banked at dusk.'))
    await compile(asking('Nobody takes grain after dark.', [{ ordinal: 1, text: 'A rule.' }]))
    expect(court.systems[0]).toBe(COMPILE_INSTRUCTION)
    expect(court.systems[1]).toBe(COMPILE_INSTRUCTION)
    expect(court.users[0]).not.toBe(court.users[1])
  })
})

describe('what the town cannot be held to', () => {
  it('refuses an act that is not one, and says so in words the page can carry', async () => {
    const { compile } = rig([
      answer({ predicate: { kind: 'forbid', verb: 'gossip' } as never, why: 'a fine reading' }),
    ])
    const got = await compile(asking('Nobody gossips at the well.'))
    expect(got.predicate).toEqual({ kind: 'none' })
    expect(got.why).toBe(NO_WORD_FOR_IT)
  })

  it('refuses a building nobody handed over', async () => {
    const { compile } = rig([
      answer({
        predicate: { kind: 'common', itemKind: 'grain', structureId: 'structure_99' } as never,
      }),
    ])
    expect((await compile(asking('One sack each from the store.'))).predicate).toEqual({
      kind: 'none',
    })
  })

  it('refuses a thing the town has no word for', async () => {
    const { compile } = rig([
      answer({
        predicate: {
          kind: 'tithe',
          itemKind: 'silver',
          qty: 1,
          to: LAW_FIXTURE_FIRE_PIT,
          every: 'day',
        } as never,
      }),
    ])
    expect((await compile(asking('A coin for the fire.'))).predicate).toEqual({ kind: 'none' })
  })

  it('keeps a rule in words when two answers running cannot be read', async () => {
    const { compile, court } = rig([{ predicate: 'yes' }, { nothing: true }])
    const got = await compile(asking('Be kind to one another.'))
    expect(got).toEqual({ predicate: { kind: 'none' }, repeals: null, why: NO_WORD_FOR_IT })
    expect(court.objectCalls, 'one retry, and no more').toBe(2)
  })

  it('reads a second answer when the first is off the dialect', async () => {
    const { compile, court } = rig([
      { predicate: 'yes' },
      answer({ predicate: { kind: 'forbid', verb: 'take', whose: 'other' } as never }),
    ])
    expect((await compile(asking("Nobody takes another's planks."))).predicate).toEqual({
      kind: 'forbid',
      verb: 'take',
      whose: 'other',
    })
    expect(court.objectCalls).toBe(2)
  })
})

describe('letting a rule go', () => {
  it('carries the number of a standing rule back', async () => {
    const { compile } = rig([answer({ repeals: 2 })])
    const got = await compile(
      asking('We let go of the fire tax.', [
        { ordinal: 1, text: 'The slate rule.' },
        { ordinal: 2, text: 'The fire tax.' },
      ]),
    )
    expect(got.repeals).toBe(2)
  })

  it('drops a number no standing rule answers to', async () => {
    const { compile } = rig([answer({ repeals: 7 })])
    expect(
      (await compile(asking('Enough of that.', [{ ordinal: 1, text: 'A rule.' }]))).repeals,
    ).toBeNull()
  })
})

describe('the reading is read by people', () => {
  it('replaces one that says the machinery out loud', async () => {
    const { compile } = rig([answer({ why: 'the arbiter reads this as a schema for taking' })])
    expect((await compile(asking('Nobody takes at night.'))).why).toBe(PLAIN_WHY)
  })

  it('leaves a plain reading exactly as the court wrote it', async () => {
    const said = 'The fire is the place they sat at, so that is where the log goes.'
    const { compile } = rig([answer({ why: said })])
    expect((await compile(asking('Bring a log to the fire.'))).why).toBe(said)
  })
})
