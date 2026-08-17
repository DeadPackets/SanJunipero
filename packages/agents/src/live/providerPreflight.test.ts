import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CAPABILITIES } from '../prompt/rulesOfBeing.js'
import { TurnSchema } from '../turn.js'
import {
  PREFLIGHT_BAR, PREFLIGHT_CALLS, preflightPrompts, preflightRefusal, runPreflight, scorePreflight,
  type PreflightAnswer, type PreflightLlm,
} from './providerPreflight.js'

// Recorded, not invented. Two signatures, both measured live in C11 batch 12's 12-call A/B:
// a grammar-constrained back end returns ONLY the required properties of the schema; a back
// end that serves the optional ones returns a whole turn.
const REQUIRED_ONLY = { thought: 'Salma looks ill. I should tend to her.', importance: 6 }
const WHOLE_TURNS = [
  {
    thought: 'My throat is raw. The well is right there.',
    speech: 'A moment — I am parched.',
    action: { verb: 'drink', params: {} },
    importance: 4,
  },
  {
    thought: 'The bush is heavy and I have eaten nothing.',
    action: { verb: 'forage', params: { nodeId: 'node_e14' } },
    importance: 5,
  },
  {
    thought: 'She is burning up. The herb is in my hand.',
    speech: 'Lie still. I have something for this.',
    action: { verb: 'tend', params: { targetId: 'salma', itemId: 'item_h3' } },
    importance: 8,
  },
]

const ok = (raw: unknown): PreflightAnswer => ({ ok: true, turn: TurnSchema.parse(raw) })

function fakeLlm(answers: readonly unknown[]): PreflightLlm {
  let i = 0
  return {
    async object<T>(): Promise<{ value: T }> {
      const a = answers[i++]
      if (a instanceof Error) throw a
      return { value: a as T }
    },
  }
}

const score = (answers: readonly PreflightAnswer[]) =>
  scorePreflight({ provider: 'DeepInfra', hardAllowList: true, model: 'deepseek/deepseek-v4-flash-0731', answers })

describe('the provider pre-flight asks the real question', () => {
  it('sends the real system prompt, so the capabilities and the speech rules are in it', () => {
    const prompts = preflightPrompts()
    expect(prompts).toHaveLength(PREFLIGHT_CALLS)
    for (const p of prompts) {
      expect(p.system).toContain(CAPABILITIES)
      expect(p.messages).toHaveLength(3)
    }
    // Three different moments, or the probe measures one scene three times.
    expect(new Set(prompts.map((p) => p.messages[2]!.content)).size).toBe(PREFLIGHT_CALLS)
  })

  it('sends the real TurnSchema, whose action and speech are the fields under test', () => {
    const json = JSON.stringify(z.toJSONSchema(TurnSchema, { io: 'input', unrepresentable: 'any' }))
    expect(json).toContain('"action"')
    expect(json).toContain('"speech"')
    expect(JSON.parse(json).required).toEqual(['thought', 'importance'])
  })
})

describe('scorePreflight', () => {
  it('FAILS the signature that killed the last gate: required properties only, three times', () => {
    const r = score([ok(REQUIRED_ONLY), ok(REQUIRED_ONLY), ok(REQUIRED_ONLY)])
    expect(r.answered).toBe(3)
    expect(r.actions).toBe(0)
    expect(r.speeches).toBe(0)
    expect(r.passed).toBe(false)
  })

  it('PASSES a back end that acts three times and speaks twice — the bar exactly', () => {
    const r = score(WHOLE_TURNS.map(ok))
    expect(r.actions).toBe(PREFLIGHT_BAR.action)
    expect(r.speeches).toBe(PREFLIGHT_BAR.speech)
    expect(r.passed).toBe(true)
  })

  it('fails two acts out of three, however much it says', () => {
    const r = score([ok(WHOLE_TURNS[0]), ok(WHOLE_TURNS[2]), ok({ ...REQUIRED_ONLY, speech: 'aye' })])
    expect(r.actions).toBe(2)
    expect(r.speeches).toBe(3)
    expect(r.passed).toBe(false)
  })

  it('fails one speech out of three even when every act lands', () => {
    const r = score([ok(WHOLE_TURNS[0]), ok({ ...WHOLE_TURNS[1] }), ok({ ...WHOLE_TURNS[2], speech: undefined })])
    expect(r.actions).toBe(3)
    expect(r.speeches).toBe(1)
    expect(r.passed).toBe(false)
  })

  it('does not count a null action as an act, now that the schema accepts one', () => {
    const r = score([ok({ ...WHOLE_TURNS[0], action: null, speech: null }), ok(WHOLE_TURNS[1]), ok(WHOLE_TURNS[2])])
    expect(r.actions).toBe(2)
    expect(r.speeches).toBe(1)
    expect(r.passed).toBe(false)
  })

  it('counts a call that never came back as unanswered and keeps its error', () => {
    const r = score([
      ok(WHOLE_TURNS[0]), ok(WHOLE_TURNS[2]),
      { ok: false, error: 'Upstream error: Grammar error: Unimplemented keys: ["propertyNames"]' },
    ])
    expect(r.answered).toBe(2)
    expect(r.actions).toBe(2)
    expect(r.passed).toBe(false)
    expect(r.failures[0]).toContain('propertyNames')
  })

  it('reports the back ends that actually served, deduplicated', () => {
    const r = scorePreflight({
      provider: 'unpinned', hardAllowList: false, model: 'm',
      answers: WHOLE_TURNS.map(ok), costUsd: 0.0009,
      servedProviders: ['Wafer', 'DeepInfra', 'Wafer'],
    })
    expect(r.servedProviders).toEqual(['DeepInfra', 'Wafer'])
    expect(r.costUsd).toBeCloseTo(0.0009)
  })
})

describe('preflightRefusal', () => {
  it('names the provider and both counts, which is what the 38 minutes bought', () => {
    const msg = preflightRefusal(score([ok(REQUIRED_ONLY), ok(REQUIRED_ONLY), ok(REQUIRED_ONLY)]))
    expect(msg).toContain('DeepInfra')
    expect(msg).toContain('action 0/3')
    expect(msg).toContain('speech 0/3')
    expect(msg).toContain('GATE REFUSED TO START')
  })
})

describe('runPreflight', () => {
  it('makes exactly three calls and scores what came back', async () => {
    const r = await runPreflight({
      llm: fakeLlm(WHOLE_TURNS), provider: 'StreamLake', hardAllowList: true, model: 'm',
    })
    expect(r.calls).toBe(PREFLIGHT_CALLS)
    expect(r.passed).toBe(true)
  })

  it('records a thrown call instead of abandoning the probe', async () => {
    const r = await runPreflight({
      llm: fakeLlm([WHOLE_TURNS[0], new Error('Grammar error: Unimplemented keys: ["propertyNames"]'), WHOLE_TURNS[2]]),
      provider: 'DeepInfra', hardAllowList: true, model: 'm',
    })
    expect(r.calls).toBe(PREFLIGHT_CALLS)
    expect(r.answered).toBe(2)
    expect(r.failures).toHaveLength(1)
    expect(r.passed).toBe(false)
  })

  it('hands every answer back, so a bar cleared with three-word turns can be seen', async () => {
    const seen: PreflightAnswer[] = []
    await runPreflight({
      llm: fakeLlm(WHOLE_TURNS), provider: 'StreamLake', hardAllowList: true, model: 'm',
      onAnswer: (a) => seen.push(a),
    })
    expect(seen).toHaveLength(PREFLIGHT_CALLS)
    expect(seen.every((a) => a.ok)).toBe(true)
  })

  it('treats an answer that does not fit the turn shape as a failed call', async () => {
    const r = await runPreflight({
      llm: fakeLlm([{ nonsense: true }, WHOLE_TURNS[1], WHOLE_TURNS[2]]),
      provider: 'Baidu', hardAllowList: true, model: 'm',
    })
    expect(r.answered).toBe(2)
    expect(r.failures[0]).toContain('did not fit TurnSchema')
  })
})
