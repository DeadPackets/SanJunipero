import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CAPABILITIES } from '../prompt/rulesOfBeing.js'
import { TurnSchema, TurnSchemaActionRequired } from '../turn.js'
import {
  PREFLIGHT_BAR,
  PREFLIGHT_CALLS,
  preflightPrompts,
  preflightRefusal,
  runPreflight,
  scorePreflight,
  type PreflightAnswer,
  type PreflightLlm,
} from './providerPreflight.js'

// Two recorded signatures: a grammar-constrained back end returns only the schema's required
// properties, and a back end that serves the optional ones returns a whole turn.
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
    async object(): Promise<{ value: unknown }> {
      const a = answers[i++]
      if (a instanceof Error) throw a
      return { value: a }
    },
  }
}

const score = (answers: readonly PreflightAnswer[]) =>
  scorePreflight({
    provider: 'DeepInfra',
    hardAllowList: true,
    model: 'deepseek/deepseek-v4-flash-0731',
    answers,
  })

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
    expect((JSON.parse(json) as { required: string[] }).required).toEqual(['thought', 'importance'])
  })

  // The bar measures the pair the run will use, and the shape asked for is half of that pair: a
  // provider that blanks only under the required action would pass a probe asked the lax way.
  it('asks with the shape the runtime asks with, in which the act is required', () => {
    const json = JSON.stringify(
      z.toJSONSchema(TurnSchemaActionRequired, { io: 'input', unrepresentable: 'any' }),
    )
    expect((JSON.parse(json) as { required: string[] }).required).toContain('action')
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

  it('PASSES a back end that acts three times — the bar exactly', () => {
    const r = score(WHOLE_TURNS.map(ok))
    expect(r.actions).toBe(PREFLIGHT_BAR.action)
    expect(r.passed).toBe(true)
  })

  it('fails two acts out of three, however much it says', () => {
    const r = score([
      ok(WHOLE_TURNS[0]),
      ok(WHOLE_TURNS[2]),
      ok({ ...REQUIRED_ONLY, speech: 'aye' }),
    ])
    expect(r.actions).toBe(2)
    expect(r.speeches).toBe(3)
    expect(r.passed).toBe(false)
  })

  it('SPEECH IS ADVISORY: a silent back end that acts three times still starts the gate', () => {
    // `speech` measures a mind's choice, not a provider's capability, so gating on it aborts a
    // paid run on sampling. Measured and reported, never aborting.
    const r = score([
      ok({ ...WHOLE_TURNS[0], speech: undefined }),
      ok(WHOLE_TURNS[1]),
      ok({ ...WHOLE_TURNS[2], speech: undefined }),
    ])
    expect(r.actions).toBe(3)
    expect(r.speeches).toBe(0)
    expect(r.passed).toBe(true)
    expect(r.speechAdvisory).toContain('0/3')
    expect(r.speechAdvisory).toMatch(/advisory/i)
  })

  it('does not count a null action as an act, now that the schema accepts one', () => {
    const r = score([
      ok({ ...WHOLE_TURNS[0], action: null, speech: null }),
      ok(WHOLE_TURNS[1]),
      ok(WHOLE_TURNS[2]),
    ])
    expect(r.actions).toBe(2)
    expect(r.speeches).toBe(1)
    expect(r.passed).toBe(false)
  })

  it('counts a call that never came back as unanswered and keeps its error', () => {
    const r = score([
      ok(WHOLE_TURNS[0]),
      ok(WHOLE_TURNS[2]),
      { ok: false, error: 'Upstream error: Grammar error: Unimplemented keys: ["propertyNames"]' },
    ])
    expect(r.answered).toBe(2)
    expect(r.actions).toBe(2)
    expect(r.passed).toBe(false)
    expect(r.failures[0]).toContain('propertyNames')
  })

  it('reports the back ends that actually served, deduplicated', () => {
    const r = scorePreflight({
      provider: 'unpinned',
      hardAllowList: false,
      model: 'm',
      answers: WHOLE_TURNS.map(ok),
      costUsd: 0.0009,
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

  it('says the refusal was the action bar and never the speech one', () => {
    const msg = preflightRefusal(score([ok(REQUIRED_ONLY), ok(REQUIRED_ONLY), ok(REQUIRED_ONLY)]))
    expect(msg).toMatch(/speech[^\n]*advisory/i)
  })
})

describe('runPreflight repeats the bar, because one probe concludes nothing', () => {
  it('takes the first round that clears the action bar and stops paying', async () => {
    // Round 1 is the DeepInfra signature; round 2 acts three times. Six calls, then done.
    const r = await runPreflight({
      llm: fakeLlm([REQUIRED_ONLY, REQUIRED_ONLY, REQUIRED_ONLY, ...WHOLE_TURNS, ...WHOLE_TURNS]),
      provider: 'Baidu',
      hardAllowList: true,
      model: 'm',
      rounds: 4,
    })
    expect(r.roundsRun).toBe(2)
    expect(r.roundsPassed).toBe(1)
    expect(r.calls).toBe(2 * PREFLIGHT_CALLS)
    expect(r.passed).toBe(true)
  })

  it('refuses only when every round fails the action bar, and totals them all', async () => {
    const dead = Array.from({ length: 4 * PREFLIGHT_CALLS }, () => REQUIRED_ONLY)
    const r = await runPreflight({
      llm: fakeLlm(dead),
      provider: 'DeepInfra',
      hardAllowList: true,
      model: 'm',
      rounds: 4,
    })
    expect(r.roundsRun).toBe(4)
    expect(r.roundsPassed).toBe(0)
    expect(r.calls).toBe(4 * PREFLIGHT_CALLS)
    expect(r.actions).toBe(0)
    expect(r.passed).toBe(false)
  })

  it('never repeats on speech alone: three acts and no words is one round and a pass', async () => {
    const silent = WHOLE_TURNS.map((t) => ({ ...t, speech: undefined }))
    const r = await runPreflight({
      llm: fakeLlm([...silent, ...WHOLE_TURNS]),
      provider: 'StreamLake',
      hardAllowList: true,
      model: 'm',
      rounds: 4,
    })
    expect(r.roundsRun).toBe(1)
    expect(r.speeches).toBe(0)
    expect(r.passed).toBe(true)
  })
})

describe('runPreflight', () => {
  it('makes exactly three calls and scores what came back', async () => {
    const r = await runPreflight({
      llm: fakeLlm(WHOLE_TURNS),
      provider: 'StreamLake',
      hardAllowList: true,
      model: 'm',
    })
    expect(r.calls).toBe(PREFLIGHT_CALLS)
    expect(r.passed).toBe(true)
  })

  it('records a thrown call instead of abandoning the probe', async () => {
    const r = await runPreflight({
      llm: fakeLlm([
        WHOLE_TURNS[0],
        new Error('Grammar error: Unimplemented keys: ["propertyNames"]'),
        WHOLE_TURNS[2],
      ]),
      provider: 'DeepInfra',
      hardAllowList: true,
      model: 'm',
    })
    expect(r.calls).toBe(PREFLIGHT_CALLS)
    expect(r.answered).toBe(2)
    expect(r.failures).toHaveLength(1)
    expect(r.passed).toBe(false)
  })

  it('hands every answer back, so a bar cleared with three-word turns can be seen', async () => {
    const seen: PreflightAnswer[] = []
    await runPreflight({
      llm: fakeLlm(WHOLE_TURNS),
      provider: 'StreamLake',
      hardAllowList: true,
      model: 'm',
      onAnswer: (a) => seen.push(a),
    })
    expect(seen).toHaveLength(PREFLIGHT_CALLS)
    expect(seen.every((a) => a.ok)).toBe(true)
  })

  it('fails a back end that answers with the required properties and no act at all', async () => {
    const r = await runPreflight({
      llm: fakeLlm([REQUIRED_ONLY, REQUIRED_ONLY, REQUIRED_ONLY]),
      provider: 'DeepInfra',
      hardAllowList: true,
      model: 'm',
    })
    // Not a turn at all under the shape the run asks with: refused at the schema, not scored.
    expect(r.answered).toBe(0)
    expect(r.actions).toBe(0)
    expect(r.passed).toBe(false)
    expect(r.failures).toHaveLength(PREFLIGHT_CALLS)
  })

  it('counts a wait as answered and not as acting, exactly as a turn does', async () => {
    const waited = { thought: 'I stand and let it pass.', action: { verb: 'wait' }, importance: 2 }
    const r = await runPreflight({
      llm: fakeLlm([waited, waited, waited]),
      provider: 'DeepInfra',
      hardAllowList: true,
      model: 'm',
    })
    expect(r.answered).toBe(PREFLIGHT_CALLS)
    expect(r.actions).toBe(0)
    expect(r.passed).toBe(false)
  })

  it('treats an answer that does not fit the turn shape as a failed call', async () => {
    const r = await runPreflight({
      llm: fakeLlm([{ nonsense: true }, WHOLE_TURNS[1], WHOLE_TURNS[2]]),
      provider: 'Baidu',
      hardAllowList: true,
      model: 'm',
    })
    expect(r.answered).toBe(2)
    expect(r.failures[0]).toContain('did not fit TurnSchema')
  })
})
