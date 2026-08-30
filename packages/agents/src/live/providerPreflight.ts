import { NoObjectGeneratedError } from 'ai'
import { assemblePrompt, type AssembledPrompt, type IdentityCore } from '../prompt/assemble.js'
import type { PersonalityDoc } from '../personality.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { TurnSchema, type Turn } from '../turn.js'

// Asks the real `TurnSchema` with the real system prompt and model id — a grammar-constrained
// provider can return only a schema's required properties, so a toy schema proves nothing.

export const PREFLIGHT_CALLS = 3
// `action` on every call is the bar — it separated four candidates cleanly over 48 probe calls;
// `speech` measures a mind's choice, not a provider's capability, so it is reported and never gates.
export const PREFLIGHT_BAR = { action: 3 } as const
// How many times the bar is repeated before the gate gives up: one probe concludes nothing.
export const PREFLIGHT_ROUNDS = 4

// A founder of the shape the gate boots, so the system prefix is the real one and not a stub.
const PREFLIGHT_IDENTITY: IdentityCore = {
  name: 'Hana',
  age: 33,
  backstory:
    'Keeps the eastern path clear and knows which of the bushes ripen first. Has lived beside this river since she could walk.',
  temperament: 'direct, warm, quick to move',
  voiceCard: {
    register: 'plain and unhurried',
    rhythm: 'a line, then she is doing it',
    tics: ['names the thing she means'],
    neverSays: ['grand words'],
    exampleLines: ['The water is right there.', 'I will go now.'],
    wordBudget: { typical: 13, burst: 24 },
  },
}

const PREFLIGHT_PERSONALITY: PersonalityDoc = {
  temperament: 'direct, warm, quick to move',
  values: ['a full store', 'people looked after'],
  beliefs: ['what needs doing is done now'],
  current: {
    mood: 'clear-headed',
    worries: ['there is work in front of you and nobody else is going to do it'],
    goals: ['see to what is in front of you'],
  },
}

// Deliberately unambiguous moments: this measures whether a provider CAN emit the optional
// fields, not whether a mind chooses to.
const PREFLIGHT_SCENES: readonly string[] = [
  'Your throat is dry and cracking. The well stands three steps away at (62, 70), its rope in reach. Yusuf is beside you, waiting on you.',
  'You have eaten nothing since yesterday. A berry bush stands at your elbow, heavy with fruit; its mark is node_e14. Nadia comes up the path towards you.',
  'Salma is on the ground beside you, shaking with fever. You have a herb in your hand, its mark is item_h3, and nobody else is near.',
]

export function preflightPrompts(
  identity: IdentityCore = PREFLIGHT_IDENTITY,
  personality: PersonalityDoc = PREFLIGHT_PERSONALITY,
): AssembledPrompt[] {
  return PREFLIGHT_SCENES.map((prose) =>
    assemblePrompt({
      rulesOfBeing: RULES_OF_BEING,
      identity,
      personality: { doc: personality, autobiography: [] },
      journal: [],
      recalled: null,
      scene: { ledgers: [], memories: [] },
      dayLog: ['The morning is bright and the valley is awake.'],
      now: { prose },
    }),
  )
}

export type PreflightAnswer = { ok: true; turn: Turn } | { ok: false; error: string }

export type PreflightResult = {
  provider: string
  hardAllowList: boolean
  model: string
  calls: number
  answered: number
  actions: number
  speeches: number
  passed: boolean
  // Rounds of PREFLIGHT_CALLS actually paid for, and how many of them cleared the action bar.
  roundsRun: number
  roundsPassed: number
  // The speech count in words, marked for what it is, so a reader of the report cannot mistake
  // it for something the gate refused on.
  speechAdvisory: string
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
  roundsRun?: number
  roundsPassed?: number
  costUsd?: number
  servedProviders?: readonly string[]
}): PreflightResult {
  const answered = opts.answers.filter((a) => a.ok).length
  // `?? null`, not `!== undefined`: the turn schema takes null for an optional field, and a
  // provider writing `"action": null` has emitted no act.
  const actions = opts.answers.filter((a) => a.ok && (a.turn.action ?? null) !== null).length
  const speeches = opts.answers.filter((a) => a.ok && (a.turn.speech ?? null) !== null).length
  // Over several rounds the bar is "one round cleared it", never "three acts turned up
  // somewhere": a provider that emits one act per round has not cleared a 3-of-3 bar.
  const passed =
    opts.roundsPassed === undefined ? actions >= PREFLIGHT_BAR.action : opts.roundsPassed > 0
  return {
    provider: opts.provider,
    hardAllowList: opts.hardAllowList,
    model: opts.model,
    calls: opts.answers.length,
    answered,
    actions,
    speeches,
    passed,
    roundsRun: opts.roundsRun ?? 1,
    roundsPassed: opts.roundsPassed ?? (passed ? 1 : 0),
    speechAdvisory:
      `speech ${speeches}/${opts.answers.length} — ADVISORY, not gated` +
      " (it measures a mind's choice, not a provider's capability)",
    costUsd: opts.costUsd ?? 0,
    servedProviders: [...new Set(opts.servedProviders ?? [])].sort(),
    failures: opts.answers.flatMap((a) => (a.ok ? [] : [a.error])),
  }
}

// What the gate prints instead of running: the provider and the counts.
export function preflightRefusal(r: PreflightResult): string {
  return [
    `GATE REFUSED TO START: provider '${r.provider}' failed the turn pre-flight.`,
    `  model=${r.model} allowList=${r.hardAllowList} served=${r.servedProviders.join(',') || 'unattributed'}`,
    `  action ${r.actions}/${r.calls} (need ${PREFLIGHT_BAR.action} in one round of ${PREFLIGHT_CALLS}),` +
      ` answered ${r.answered}/${r.calls}` +
      ` over ${r.roundsRun} round(s), ${r.roundsPassed} passed`,
    `  ${r.speechAdvisory}`,
    ...r.failures.map((f) => `  failed call: ${f}`),
    '  A provider that cannot emit an optional field cannot emit an act, and a town that',
    '  cannot act is not a gate result. Pick a provider by probe, not by publication.',
  ].join('\n')
}

// The only part that spends. A call that throws is recorded as a failure rather than aborting:
// failing outright and answering emptily are both disqualifying and both worth reporting.
export type PreflightLlm = {
  object(opts: {
    system: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    schema: { _zod?: unknown }
  }): Promise<{ value: unknown }>
}

export async function runPreflight(opts: {
  llm: PreflightLlm
  provider: string
  hardAllowList: boolean
  model: string
  identity?: IdentityCore | undefined
  personality?: PersonalityDoc | undefined
  // How many times the three scenes are asked before the provider is refused. The gate asks
  // for PREFLIGHT_ROUNDS; the default of one keeps a bare call to this a single probe.
  rounds?: number | undefined
  costUsd?: (() => number) | undefined
  servedProviders?: () => string[]
  // A probe that discards its answers cannot be audited: a back end can clear the bar with
  // three-word turns, and only the turns themselves say so.
  onAnswer?: (answer: PreflightAnswer) => void
}): Promise<PreflightResult> {
  const rounds = Math.max(1, opts.rounds ?? 1)
  const all: PreflightAnswer[] = []
  let roundsRun = 0
  let roundsPassed = 0
  for (let round = 0; round < rounds; round++) {
    const answers: PreflightAnswer[] = []
    const record = (a: PreflightAnswer): void => {
      answers.push(a)
      all.push(a)
      opts.onAnswer?.(a)
    }
    for (const prompt of preflightPrompts(opts.identity, opts.personality)) {
      try {
        const { value } = await opts.llm.object({
          system: prompt.system,
          messages: prompt.messages,
          schema: TurnSchema,
        })
        const parsed = TurnSchema.safeParse(value)
        record(
          parsed.success
            ? { ok: true, turn: parsed.data }
            : {
                ok: false,
                error: `answer did not fit TurnSchema: ${JSON.stringify(value).slice(0, 200)}`,
              },
        )
      } catch (err) {
        // The raw text a rejected generation carried. Without it "could not parse the response"
        // names a symptom and hides which field the schema refused.
        const raw = NoObjectGeneratedError.isInstance(err)
          ? ` :: ${(err.text ?? '').slice(0, 400)}`
          : ''
        record({ ok: false, error: `${err instanceof Error ? err.message : String(err)}${raw}` })
      }
    }
    roundsRun += 1
    const thisRound = scorePreflight({
      provider: opts.provider,
      hardAllowList: opts.hardAllowList,
      model: opts.model,
      answers,
    })
    if (thisRound.passed) {
      roundsPassed += 1
      break
    }
  }
  return scorePreflight({
    provider: opts.provider,
    hardAllowList: opts.hardAllowList,
    model: opts.model,
    answers: all,
    roundsRun,
    roundsPassed,
    ...(opts.costUsd === undefined ? {} : { costUsd: opts.costUsd() }),
    ...(opts.servedProviders === undefined ? {} : { servedProviders: opts.servedProviders() }),
  })
}
