import { NoObjectGeneratedError } from 'ai'
import { assemblePrompt, type AssembledPrompt, type IdentityCore } from '../prompt/assemble.js'
import type { PersonalityDoc } from '../personality.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { TurnSchema, type Turn } from '../turn.js'

// The provider pre-flight, promoted from a throwaway diagnostic to a gate precondition.
//
// G11b ran 38 minutes and $0.76 to discover that its pinned provider serves structured output
// by grammar-constrained decoding and returns ONLY the required properties of a schema: every
// turn came back with `thought` and `importance`, no `action`, and the town died without
// taking a step. Twelve calls costing $0.0035 would have said so first. This is those calls,
// committed, with a bar the gate refuses to start below.
//
// It asks the REAL `TurnSchema` with the REAL system prompt and the REAL model id. A toy
// schema proves nothing: what failed was an optional field inside a union inside a strict
// object, and only the shape the run actually sends can exercise that.

export const PREFLIGHT_CALLS = 3
// `action` on every call and `speech` on two of three. A provider that cannot begin an act is
// unusable for the turn caller at any price; speech is allowed one miss because a mind may
// legitimately keep its mouth shut once.
export const PREFLIGHT_BAR = { action: 3, speech: 2 } as const

// A founder of the same shape the gate boots, so the system prefix is the real one — block 1,
// the capabilities, the speech rules, an identity and a personality — and not a stub.
export const PREFLIGHT_IDENTITY: IdentityCore = {
  name: 'Hana', age: 33,
  backstory: 'Keeps the eastern path clear and knows which of the bushes ripen first. Has lived beside this river since she could walk.',
  temperament: 'direct, warm, quick to move',
  voiceCard: {
    register: 'plain and unhurried', rhythm: 'a line, then she is doing it',
    tics: ['names the thing she means'], neverSays: ['grand words'],
    exampleLines: ['The water is right there.', 'I will go now.'],
    wordBudget: { typical: 13, burst: 24 },
  },
}

export const PREFLIGHT_PERSONALITY: PersonalityDoc = {
  temperament: 'direct, warm, quick to move',
  values: ['a full store', 'people looked after'],
  beliefs: ['what needs doing is done now'],
  current: {
    mood: 'clear-headed',
    worries: ['there is work in front of you and nobody else is going to do it'],
    goals: ['see to what is in front of you'],
  },
}

// Three moments, each one a body would plainly answer with both a word and an act. They are
// deliberately unambiguous: the pre-flight measures whether a provider CAN emit the optional
// fields, not whether a mind chooses to.
export const PREFLIGHT_SCENES: readonly string[] = [
  'Your throat is dry and cracking. The well stands three steps away at (62, 70), its rope in reach. Yusuf is beside you, waiting on you.',
  'You have eaten nothing since yesterday. A berry bush stands at your elbow, heavy with fruit; its mark is node_e14. Nadia comes up the path towards you.',
  'Salma is on the ground beside you, shaking with fever. You have a herb in your hand, its mark is item_h3, and nobody else is near.',
]

export function preflightPrompts(
  identity: IdentityCore = PREFLIGHT_IDENTITY,
  personality: PersonalityDoc = PREFLIGHT_PERSONALITY,
): AssembledPrompt[] {
  return PREFLIGHT_SCENES.map((prose) => assemblePrompt({
    rulesOfBeing: RULES_OF_BEING,
    identity,
    personality: { doc: personality, autobiography: [] },
    scene: { ledgers: [], memories: [] },
    dayLog: ['The morning is bright and the valley is awake.'],
    now: { prose },
  }))
}

export type PreflightAnswer =
  | { ok: true; turn: Turn }
  | { ok: false; error: string }

export type PreflightResult = {
  provider: string
  hardAllowList: boolean
  model: string
  calls: number
  answered: number
  actions: number
  speeches: number
  passed: boolean
  costUsd: number
  servedProviders: string[]
  failures: string[]
}

// Pure: the answers in, the verdict out. Everything the gate refuses on is computed here so
// the refusal can be tested without spending a cent.
export function scorePreflight(opts: {
  provider: string
  hardAllowList: boolean
  model: string
  answers: readonly PreflightAnswer[]
  costUsd?: number
  servedProviders?: readonly string[]
}): PreflightResult {
  const answered = opts.answers.filter((a) => a.ok).length
  const actions = opts.answers.filter((a) => a.ok && a.turn.action !== undefined).length
  const speeches = opts.answers.filter((a) => a.ok && a.turn.speech !== undefined).length
  return {
    provider: opts.provider,
    hardAllowList: opts.hardAllowList,
    model: opts.model,
    calls: opts.answers.length,
    answered,
    actions,
    speeches,
    passed: actions >= PREFLIGHT_BAR.action && speeches >= PREFLIGHT_BAR.speech,
    costUsd: opts.costUsd ?? 0,
    servedProviders: [...new Set(opts.servedProviders ?? [])].sort(),
    failures: opts.answers.flatMap((a) => (a.ok ? [] : [a.error])),
  }
}

// What the gate prints instead of running. It names the provider and the counts, because the
// last gate's 38 minutes bought exactly this sentence.
export function preflightRefusal(r: PreflightResult): string {
  return [
    `GATE REFUSED TO START: provider '${r.provider}' failed the turn pre-flight.`,
    `  model=${r.model} allowList=${r.hardAllowList} served=${r.servedProviders.join(',') || 'unattributed'}`,
    `  action ${r.actions}/${r.calls} (need ${PREFLIGHT_BAR.action}),`
    + ` speech ${r.speeches}/${r.calls} (need ${PREFLIGHT_BAR.speech}),`
    + ` answered ${r.answered}/${r.calls}`,
    ...r.failures.map((f) => `  failed call: ${f}`),
    '  A provider that cannot emit an optional field cannot emit an act, and a town that',
    '  cannot act is not a gate result. Pick a provider by probe, not by publication.',
  ].join('\n')
}

// The only part that spends. Three calls on the real schema; a call that throws is recorded
// as a failure rather than aborting the probe, because a provider that fails outright and one
// that answers emptily are both disqualified and both worth reporting.
export type PreflightLlm = {
  object<T>(opts: { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; schema: { _zod?: unknown } }): Promise<{ value: T }>
}

export async function runPreflight(opts: {
  llm: PreflightLlm
  provider: string
  hardAllowList: boolean
  model: string
  identity?: IdentityCore
  personality?: PersonalityDoc
  costUsd?: () => number
  servedProviders?: () => string[]
  // A probe that discards its answers cannot be audited: a back end can clear the bar with
  // three-word turns, and only the turns themselves say so.
  onAnswer?: (answer: PreflightAnswer) => void
}): Promise<PreflightResult> {
  const answers: PreflightAnswer[] = []
  const record = (a: PreflightAnswer): void => { answers.push(a); opts.onAnswer?.(a) }
  for (const prompt of preflightPrompts(opts.identity, opts.personality)) {
    try {
      const { value } = await opts.llm.object<Turn>({
        system: prompt.system, messages: prompt.messages, schema: TurnSchema,
      })
      const parsed = TurnSchema.safeParse(value)
      record(parsed.success
        ? { ok: true, turn: parsed.data }
        : { ok: false, error: `answer did not fit TurnSchema: ${JSON.stringify(value).slice(0, 200)}` })
    } catch (err) {
      // The raw text a rejected generation carried. Without it "could not parse the response"
      // names a symptom and hides which field the schema refused.
      const raw = NoObjectGeneratedError.isInstance(err) ? ` :: ${(err.text ?? '').slice(0, 400)}` : ''
      record({ ok: false, error: `${err instanceof Error ? err.message : String(err)}${raw}` })
    }
  }
  return scorePreflight({
    provider: opts.provider, hardAllowList: opts.hardAllowList, model: opts.model, answers,
    ...(opts.costUsd === undefined ? {} : { costUsd: opts.costUsd() }),
    ...(opts.servedProviders === undefined ? {} : { servedProviders: opts.servedProviders() }),
  })
}
