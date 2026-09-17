import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  tool,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { assertNoGlassLeak, strictSchemaFaults } from '@sj/shared'
import {
  insertAlert,
  insertLlmCall,
  insertTurnOutcome,
  makeBudgetGuard,
  mergeBlockTokens,
  oldestCallTsSince,
  sumCostUsd,
  type BudgetGuard,
  type LlmCallInsert,
} from './callLog.js'
import { railHold, tripRail, RAIL_WINDOW_MS } from './rails.js'
import { bookCostUsd, computeCostUsd } from './pricing.js'
import {
  FALLBACK_MODELS,
  MIND_MODEL,
  PROVIDER_ORDER,
  callSettingsFor,
  requestTimeoutMsFor,
  type ReasoningSetting,
} from './pins.js'
import { jsonOrNothing, repairToSchema } from './repair.js'
import { limiterFor, rateLimited, RateLimitWaitError, type AdaptiveLimiter } from './rateLimiter.js'

export type { ReasoningSetting }

export type LlmUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

export type LlmMessage = { role: 'user' | 'assistant'; content: string }

/** Why this call was made and what it sent, carried onto the row whichever way the call ends —
 *  a call that came back with nothing is the one this most needs to explain. */
export type CallBill = {
  wakeReason?: string | null
  wakeReasons?: readonly string[] | null
  blockTokens?: Record<string, number> | null
}

/** What one attempt is known to have done, recorded the moment the provider answers and BEFORE
 *  the value is read: a generation that answered but produced no output still billed its
 *  tokens, and reading its value throws. */
type StepFacts = {
  usage?: LanguageModelUsage | undefined
  servedModel?: string | undefined
  provider?: string | null | undefined
  reportedCostUsd?: number | null | undefined
  finishReason?: FinishReason | undefined
  generationId?: string | undefined
}

type Note = (facts: StepFacts) => void

type GeneratedStep = {
  usage: LanguageModelUsage
  finishReason: FinishReason
  finalStep: { response: { id?: string; modelId?: string }; providerMetadata?: unknown }
}

function stepFacts(r: GeneratedStep): StepFacts {
  return {
    usage: r.usage,
    servedModel: r.finalStep.response.modelId,
    provider: servedProvider(r.finalStep.response, r.finalStep.providerMetadata),
    reportedCostUsd: reportedCostUsd(r.finalStep.providerMetadata),
    finishReason: r.finishReason,
    generationId: r.finalStep.response.id,
  }
}

export class BudgetExceededError extends Error {}

/** A generation that spent its whole output ceiling and answered nothing: the model thought
 *  itself out of tokens. Asking the same question the same way again buys the same silence. */
class RunawayError extends Error {
  constructor(
    readonly outputTokens: number,
    cause: unknown,
  ) {
    super(`no answer within the output ceiling after ${outputTokens} tokens`, { cause })
  }
}

const effortWord = (r: ReasoningSetting | null): string =>
  r === null ? 'the default effort' : 'enabled' in r ? 'no reasoning' : r.effort

/** One caller has spent its own day. Its calls are refused and every other caller keeps going:
 *  a `turn` refusal dozes one mind, a `scene` refusal times one floor out, and the town runs. */
export class CallerRailError extends BudgetExceededError {
  constructor(
    readonly caller: string,
    readonly spentUsd: number,
    readonly railUsd: number,
    readonly untilMs: number,
  ) {
    super(
      `LLM caller rail reached for '${caller}': spent $${spentUsd.toFixed(4)} of` +
        ` $${railUsd.toFixed(2)} for the day; held until ${new Date(untilMs).toISOString()}`,
    )
  }
}

// The provider's own bytes from a generation the schema refused. Anything else is not a wrong
// answer and must never be re-asked.
function malformedObjectText(err: unknown): string | undefined {
  return NoObjectGeneratedError.isInstance(err) ? (err.text ?? '') : undefined
}

// A rejected generation still carries its usage; this stands in only when the SDK reports none.
const EMPTY_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
}

const strictChecked = new Set<string>()

/** What one caller sends OpenRouter over and above the prompt: which models may answer, which
 *  back ends may serve, and which mind is asking. */
export type RequestBody = {
  models: string[]
  provider: {
    only?: string[]
    order?: string[]
    allow_fallbacks: boolean
    require_parameters: boolean
  }
  reasoning?: ReasoningSetting
  session_id?: string
  prompt_cache_key?: string
}

// The pinned back ends are an allow-list either way with `allow_fallbacks:false`, the default
// here: 8 of the 30 endpoints serving MIND_MODEL cannot do structured output, so a hop to one is
// a hard failure. The mind route names them under `only` and every other route under `order`,
// because OpenRouter drops sticky routing the moment an order is named, and the mind is the one
// route with a per-mind prefix worth keeping warm. `require_parameters` narrows to the endpoints
// that can serve what the request asks for; it cannot REPLACE the allow-list, which bans back
// ends that answer well-formed JSON with no act inside it — no capability flag reports that.
export function defaultExtraBody(
  fallbackModels: string[] = FALLBACK_MODELS,
  providerOrder: string[] = PROVIDER_ORDER,
  allowFallbacks = false,
  reasoning?: ReasoningSetting,
  model: string = MIND_MODEL,
  sessionId?: string,
): RequestBody {
  // r15: sent as `only`, the pair landed every call on DeepInfra, which rate-limited 27% of them
  // upstream and dozed the fleet; `order` keeps Wafer first, as r13 measured it. Stickiness is lost.
  const homes = { order: providerOrder }
  return {
    models: [model, ...fallbackModels],
    provider: { ...homes, allow_fallbacks: allowFallbacks, require_parameters: false },
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    // OpenAI routes a prompt to a cache by this key and passes it through OpenRouter: probed
    // 2026-09-05, the same 6.8k prefix missed 3 of 5 times without it and hit every time with it.
    ...(sessionId === undefined || !model.startsWith('openai/')
      ? {}
      : { prompt_cache_key: sessionId }),
  }
}

/** OpenRouter's sticky-routing key, sent top level. One per mind and not per caller, so a mind's
 *  turn and its scene line land on the same back end and share the one prefix they both carry. */
function sessionIdFor(agentId: string | null): string | undefined {
  return agentId === null ? undefined : `sj-${agentId}`
}

// OpenRouter names the back end in its own metadata and again in the raw body; neither is
// guaranteed, and a call nobody can attribute is recorded as one.
export function servedProvider(response: unknown, meta: unknown): string | null {
  const fromMeta = (meta as { openrouter?: { provider?: unknown } } | undefined)?.openrouter
    ?.provider
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
  const fromBody = (response as { body?: { provider?: unknown } } | undefined)?.body?.provider
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null
}

// Reported under `usage.cost` only once `usage: { include: true }` is set on the request.
function reportedCostUsd(meta: unknown): number | null {
  const cost = (meta as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter
    ?.usage?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

export type LlmClientOpts = {
  model?: LanguageModel
  db: Database.Database
  caller: string
  agentId?: string
  providerOrder?: string[]
  // True turns `providerOrder` back into a preference; absent keeps it the allow-list.
  allowProviderFallbacks?: boolean
  // Both of these fall back to the caller's row in `pins.ts` when absent; `reasoning: null`
  // sends nothing at all.
  reasoning?: ReasoningSetting | null
  maxRetries?: number
  // Without it a stalled response hangs the caller for ever, with the retries queued behind it.
  requestTimeoutMs?: number
  maxQueueWaitMs?: number
  budgetUsd?: number
  maxOutputTokens?: number
  temperature?: number
  // Pre-booked per call while it is in flight. ~3x the observed mean call.
  expectedCallCostUsd?: number
  // Experiment lever: 'tool' moves the schema through the tools API instead of response_format.
  transport?: 'response_format' | 'tool'
  // Tool transport only. 'named' forces the turn tool; Z.AI-class endpoints 404 on anything but auto.
  toolChoice?: 'named' | 'auto'
  // 'ops' is a prompt no mind reads, whose question is made of the ops plane's own words — the
  // recognisers. Sealed by default, so a caller nobody has thought about yet is a mind's.
  audience?: 'mind' | 'ops'
}

type CallTokens = Pick<
  LlmCallInsert,
  'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens'
>

// Absent on a call that died before it reported anything; every column is still written, as 0.
function tokensOf(raw: LanguageModelUsage | undefined): CallTokens {
  return {
    inputTokens: raw?.inputTokens ?? 0,
    outputTokens: raw?.outputTokens ?? 0,
    cacheReadTokens: raw?.inputTokenDetails.cacheReadTokens ?? 0,
    reasoningTokens: raw?.outputTokenDetails.reasoningTokens ?? 0,
  }
}

const DEFAULT_EXPECTED_CALL_COST_USD = 0.005

// One retry after the abort, then the call fails loudly. A third attempt only spends the
// stall again.
const DEFAULT_MAX_RETRIES = 1

// A rate-limited pair in the live ledger sits 5.5 s apart and both halves fail: an immediate
// re-ask lands inside the window that just refused it. The first window, doubled on each further
// refusal and jittered, so a fleet of minds refused together does not re-ask together.
const RATE_LIMIT_WAIT_MS = 2_000

// How long a caller with no pinned patience will queue behind the gate before giving its tick up.
const DEFAULT_QUEUE_WAIT_MS = 15_000

/** What a RE-ASK gets at the gate however little of the call's budget the attempt before it
 *  left. A first attempt that stalled out its whole patience handed the retry 0 ms, which dozed
 *  the mind the instant the pool was full: 9 of r13's 13 dozes. Half the 9.9 s turn p50, which
 *  is several hand-backs at a cap of 8; a pool still full when it runs out dozes as before. */
export const MIN_QUEUE_WAIT_MS = 5_000

/** How long to wait before re-asking; nothing at all unless the refusal was a rate limit.
 *  Public so a test can prove the shape without waiting it out. */
export function retryBackoffMs(err: unknown, attempt = 0): number {
  if (!rateLimited(err)) return 0
  // Doubling: at r3 the first attempt was refused 35% of the time and the second 75%, because one
  // 2 s-wide window is not spread enough for five minds refused in the same instant.
  const window = RATE_LIMIT_WAIT_MS * 2 ** attempt
  return window + Math.floor(Math.random() * window)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = (): void => {
      clearTimeout(timer)
      reject(signal.reason as Error)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export class LlmClient {
  private readonly db: Database.Database
  private readonly caller: string
  private readonly agentId: string | null
  private readonly providerOrder: string[]
  private readonly modelId: string
  private readonly allowProviderFallbacks: boolean
  private readonly reasoning: ReasoningSetting | null
  private readonly fallbackReasoning: ReasoningSetting | null
  private readonly maxRetries: number
  private readonly rateLimitRetries: number
  private readonly requestTimeoutMs: number
  private readonly maxQueueWaitMs: number
  private readonly limiter: AdaptiveLimiter
  private readonly budgetUsd: number | undefined
  private readonly dailyUsd: number | undefined
  private readonly maxOutputTokens: number | undefined
  private readonly temperature: number | undefined
  private readonly transport: 'response_format' | 'tool'
  private readonly toolChoice: 'named' | 'auto'
  private readonly expectedCallCostUsd: number
  private readonly audience: 'mind' | 'ops'
  private readonly guard: BudgetGuard
  private readonly opts: LlmClientOpts
  private readonly cancellation: AbortController
  private model: LanguageModel | undefined
  private fallbackModel: LanguageModel | undefined
  private lastCallId: number | null = null

  constructor(opts: LlmClientOpts, cancellation = new AbortController()) {
    this.opts = { ...opts }
    this.cancellation = cancellation
    this.db = opts.db
    this.caller = opts.caller
    this.agentId = opts.agentId ?? null
    const pinned = callSettingsFor(opts.caller)
    this.providerOrder = opts.providerOrder ?? pinned.providerOrder ?? PROVIDER_ORDER
    this.modelId = pinned.model ?? MIND_MODEL
    this.allowProviderFallbacks = opts.allowProviderFallbacks ?? false
    this.reasoning = opts.reasoning === undefined ? (pinned.reasoning ?? null) : opts.reasoning
    this.fallbackReasoning = pinned.fallbackReasoning ?? null
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    // An explicit count is the caller saying exactly how many; only the default defers to the pin.
    this.rateLimitRetries = opts.maxRetries ?? pinned.rateLimitRetries ?? this.maxRetries
    this.requestTimeoutMs = opts.requestTimeoutMs ?? requestTimeoutMsFor(opts.caller)
    this.maxQueueWaitMs = opts.maxQueueWaitMs ?? pinned.maxQueueWaitMs ?? DEFAULT_QUEUE_WAIT_MS
    // One gate per back end, not per caller and not per model: what refuses these calls is the
    // key's concurrency at that back end, shared by every mind and every pass in the process.
    this.limiter = limiterFor(this.providerOrder.join(','))
    this.budgetUsd = opts.budgetUsd
    this.dailyUsd = pinned.dailyUsd
    this.maxOutputTokens = opts.maxOutputTokens ?? pinned.maxOutputTokens
    this.temperature = opts.temperature ?? pinned.temperature
    this.transport = opts.transport ?? 'response_format'
    this.toolChoice = opts.toolChoice ?? 'named'
    this.expectedCallCostUsd = opts.expectedCallCostUsd ?? DEFAULT_EXPECTED_CALL_COST_USD
    this.audience = opts.audience ?? 'mind'
    this.guard = makeBudgetGuard(opts.db, opts.caller)
    this.model = opts.model
  }

  // `repairOnce` is off by default: the second rung sends the provider's own bytes back with
  // the schema error, and that costs a second billed generation.
  async object<T>(opts: {
    system: string
    messages: LlmMessage[]
    schema: z.ZodType<T>
    repairOnce?: boolean
    bill?: CallBill
  }): Promise<{ value: T; usage: LlmUsage }> {
    this.cancellation.signal.throwIfAborted()
    const system = this.seal(opts.system)
    const messages = this.sealAll(opts.messages)
    const bill = opts.bill ?? {}
    try {
      return await this.generateObject(system, messages, opts.schema, bill)
    } catch (err) {
      const bad = opts.repairOnce === true ? malformedObjectText(err) : undefined
      if (bad === undefined) throw err
      const why = opts.schema.safeParse(jsonOrNothing(bad)).error
      return await this.generateObject(
        system,
        [
          ...messages,
          // Sealed like the rest: these two carry the provider's own bytes and the schema's
          // complaint, and they are appended after the one pass above.
          ...this.sealAll([
            { role: 'assistant', content: bad.length > 0 ? bad : '…' },
            {
              role: 'user',
              content: `Your answer was rejected. Fix it:\n${why === undefined ? bad : z.prettifyError(why)}`,
            },
          ]),
        ],
        opts.schema,
        bill,
      )
    }
  }

  private async generateObject<T>(
    system: string,
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    bill: CallBill,
  ): Promise<{ value: T; usage: LlmUsage }> {
    // OpenAI's decoder refuses a shape rather than bending it; say which, once, before the bill.
    if (this.modelId.startsWith('openai/') && !strictChecked.has(this.caller)) {
      strictChecked.add(this.caller)
      const faults = strictSchemaFaults(schema)
      if (faults.length > 0)
        this.alert('schema_not_strict', `${this.caller}: ${faults.slice(0, 3).join('; ')}`)
    }
    return this.invoke(async (model, note) => {
      if (this.transport === 'tool') {
        const r = await generateText({
          model,
          system,
          messages: toModelMessages(messages),
          maxRetries: 0,
          ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
          ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
          abortSignal: AbortSignal.any([
            this.cancellation.signal,
            AbortSignal.timeout(this.requestTimeoutMs),
          ]),
          tools: {
            turn: tool({ description: 'Your turn, as structured data.', inputSchema: schema }),
          },
          toolChoice: this.toolChoice === 'named' ? { type: 'tool', toolName: 'turn' } : 'auto',
        })
        note(stepFacts(r))
        const call = r.toolCalls[0]
        const parsed = schema.safeParse(call?.input)
        if (parsed.success) return parsed.data
        // A turn the model wrote as prose instead of calling the tool is in the text channel;
        // stringifying the call it never made throws that answer away.
        const answer = call === undefined ? r.text : JSON.stringify(call.input)
        const repaired = repairToSchema(answer, schema)
        if (repaired !== undefined) {
          this.alert('decode_repaired', `${this.caller}: ${repaired.how}`)
          return repaired.value
        }
        // The same class the response_format path throws: an off-schema answer is a wrong
        // answer, and the loop must not bill an identical second ask for it.
        throw new NoObjectGeneratedError({
          message: `tool transport: ${call === undefined ? 'no tool call' : z.prettifyError(parsed.error)}`,
          text: answer,
          response: r.finalStep.response,
          usage: r.usage,
          finishReason: r.finishReason,
        })
      }
      try {
        const r = await generateText({
          model,
          system,
          messages: toModelMessages(messages),
          maxRetries: 0,
          ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
          ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
          abortSignal: AbortSignal.any([
            this.cancellation.signal,
            AbortSignal.timeout(this.requestTimeoutMs),
          ]),
          output: Output.object({ schema }),
        })
        note(stepFacts(r))
        return r.output
      } catch (err) {
        // Re-frames the provider's own bytes against the schema; never re-asks, never invents.
        if (!NoObjectGeneratedError.isInstance(err)) throw err
        const repaired = repairToSchema(err.text ?? '', schema)
        if (repaired === undefined) throw err
        this.alert('decode_repaired', `${this.caller}: ${repaired.how}`)
        note({
          usage: err.usage ?? EMPTY_USAGE,
          servedModel: err.response?.modelId,
          provider: servedProvider(err.response, undefined),
          finishReason: err.finishReason,
        })
        return repaired.value
      }
    }, bill)
  }

  async text(opts: {
    system?: string
    messages: LlmMessage[]
  }): Promise<{ text: string; usage: LlmUsage }> {
    this.cancellation.signal.throwIfAborted()
    const system = opts.system === undefined ? undefined : this.seal(opts.system)
    const messages = this.sealAll(opts.messages)
    const { value, usage } = await this.invoke(async (model, note) => {
      const r = await generateText({
        model,
        ...(system === undefined ? {} : { system }),
        messages: toModelMessages(messages),
        maxRetries: 0,
        ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
        ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
        abortSignal: AbortSignal.any([
          this.cancellation.signal,
          AbortSignal.timeout(this.requestTimeoutMs),
        ]),
      })
      note(stepFacts(r))
      return r.text
    })
    return { text: value, usage }
  }

  /** The same ledger, budget and routing under another caller name, so one call inside a pass
   *  can carry its own pinned settings and its own by-caller line. */
  forCaller(caller: string): LlmClient {
    return new LlmClient({ ...this.opts, caller }, this.cancellation)
  }

  abort(): void {
    this.cancellation.abort()
  }

  totalCostUsd(): number {
    return sumCostUsd(this.db, this.caller)
  }

  alert(kind: string, detail: string): void {
    insertAlert(this.db, { agentId: this.agentId, kind, detail })
  }

  /** Adds to the block JSON of the row this client wrote last — what the answer turned out to
   *  be worth, which is only known once it has parsed. */
  noteCallBill(patch: Record<string, number>): void {
    if (this.lastCallId === null) return
    mergeBlockTokens(this.db, this.lastCallId, patch)
  }

  /** Books what the last answer produced against the back end that served it. A well-formed
   *  turn that does nothing is the one failure the ledger cannot see from the call row alone. */
  noteTurnOutcome(outcome: { acted: boolean; spoke: boolean; planContinued: boolean }): void {
    const row = this.db
      .prepare(
        'SELECT provider FROM llm_calls WHERE caller = ? AND agent_id IS ? ORDER BY id DESC LIMIT 1',
      )
      .get(this.caller, this.agentId) as { provider: string | null } | undefined
    insertTurnOutcome(this.db, {
      agentId: this.agentId,
      provider: row?.provider ?? null,
      ...outcome,
    })
  }

  // `length` is the ceiling cutting an answer off mid-word. Without this row it reaches the
  // operator as an ordinary decode failure and the caller's cap looks correct.
  private warnIfTruncated(finishReason: FinishReason | null | undefined): void {
    if (finishReason !== 'length') return
    this.alert(
      'llm_output_truncated',
      `${this.caller}: the answer stopped at the ${this.maxOutputTokens ?? 'endpoint'} output ` +
        'token ceiling — raise it or the answer is a fragment',
    )
  }

  // The one door every mind-bound prompt passes through, whichever of the six callers assembled
  // it: an ops-plane word is cut out here and the row says which caller leaked it.
  private seal(text: string): string {
    if (this.audience === 'ops') return text
    return assertNoGlassLeak(text, this.caller, (leaks, where) => {
      this.alert('glass_leak', `${where}: ${leaks.join(', ')} — redacted before the call`)
    })
  }

  private sealAll(messages: readonly LlmMessage[]): LlmMessage[] {
    return messages.map((m) => ({ ...m, content: this.seal(m.content) }))
  }

  private async invoke<T>(
    exec: (model: LanguageModel, note: Note) => Promise<T>,
    bill: CallBill = {},
  ): Promise<{ value: T; usage: LlmUsage }> {
    this.cancellation.signal.throwIfAborted()
    if (this.budgetUsd !== undefined && this.totalCostUsd() >= this.budgetUsd) {
      throw new BudgetExceededError(
        `LLM budget exceeded for caller '${this.caller}': spent $${this.totalCostUsd().toFixed(6)} of $${this.budgetUsd.toFixed(6)}`,
      )
    }
    const now = Date.now()
    // Already held: the map is the answer, so a held caller costs no SQL on the tick thread.
    const standing = this.dailyUsd === undefined ? null : railHold(this.caller, now)
    if (standing !== null) {
      throw new CallerRailError(this.caller, standing.spentUsd, standing.railUsd, standing.untilMs)
    }
    // Pre-book what this call is expected to cost, so concurrent callers cannot
    // all read the same headroom and all spend it.
    const rail =
      this.dailyUsd === undefined ? null : { usd: this.dailyUsd, sinceMs: now - RAIL_WINDOW_MS }
    const reservation = this.guard.reserve(this.expectedCallCostUsd, this.budgetUsd ?? null, rail)
    if ('held' in reservation) {
      if (reservation.held === 'budget') {
        throw new BudgetExceededError(
          `LLM budget exceeded for caller '${this.caller}': spent $${this.totalCostUsd().toFixed(6)} plus $${this.guard.sumReserved().toFixed(6)} in flight of $${(this.budgetUsd ?? 0).toFixed(6)}`,
        )
      }
      throw this.holdOnRail(reservation.spentUsd, rail!, now)
    }
    try {
      return await this.invokeReserved(exec, bill)
    } finally {
      this.guard.release(reservation.id)
    }
  }

  /** Records the trip, writes the operator one line for it, and hands back the refusal. The
   *  hold lifts when the oldest call in the window rolls out of it. */
  private holdOnRail(
    spentUsd: number,
    rail: { usd: number; sinceMs: number },
    now: number,
  ): CallerRailError {
    const oldest = oldestCallTsSince(this.db, this.caller, rail.sinceMs) ?? now
    const untilMs = oldest + RAIL_WINDOW_MS
    const hold = { caller: this.caller, untilMs, spentUsd, railUsd: rail.usd }
    if (tripRail(hold, now)) {
      this.alert(
        'caller_rail_tripped',
        `${this.caller} has spent $${spentUsd.toFixed(4)} of its $${rail.usd.toFixed(2)} for` +
          ` the day; its calls are held until ${new Date(untilMs).toISOString()},` +
          ` the town keeps running`,
      )
    }
    return new CallerRailError(this.caller, spentUsd, rail.usd, untilMs)
  }

  private async invokeReserved<T>(
    exec: (model: LanguageModel, note: Note) => Promise<T>,
    bill: CallBill,
  ): Promise<{ value: T; usage: LlmUsage }> {
    let model = this.resolveModel()
    let modelName = typeof model === 'string' ? model : model.modelId
    let fellBack = false
    let lastError: unknown
    let sends = 0
    // Two budgets, two counters: one shared attempt number lets a burst re-ask carry the counter
    // past `maxRetries`, after which no stall can ever spend its own bound again.
    let bursts = 0
    let stalls = 0
    // One patience for the whole call, not one per attempt: a budget the retries each spent in
    // full would multiply the two waits together.
    const queueUntil = Date.now() + this.maxQueueWaitMs
    for (;;) {
      sends += 1
      try {
        return await this.limiter.run(
          () => this.attemptOnce(model, modelName, exec, bill),
          Math.max(sends === 1 ? 0 : MIN_QUEUE_WAIT_MS, queueUntil - Date.now()),
          this.cancellation.signal,
        )
      } catch (err) {
        this.cancellation.signal.throwIfAborted()
        lastError = err
        // Nothing was sent, so there is nothing to re-ask: another attempt only re-joins the
        // queue this one already timed out in.
        if (err instanceof RateLimitWaitError) break
        // Thought itself out of tokens: once more at the lower effort if the pin names one,
        // and never the identical ask again.
        if (err instanceof RunawayError) {
          if (this.fallbackReasoning === null || fellBack) break
          fellBack = true
          this.alert(
            'reasoning_runaway',
            `${this.caller}: ${err.outputTokens} tokens at ${effortWord(this.reasoning)} and no` +
              ` answer; asking once more at ${effortWord(this.fallbackReasoning)}`,
          )
          model = this.resolveModel(this.fallbackReasoning)
          modelName = typeof model === 'string' ? model : model.modelId
          continue
        }
        // An invalid generation is not a transient provider fault: retrying
        // the identical request wastes calls — surface it for a real repair.
        if (NoObjectGeneratedError.isInstance(err)) throw err
        // Only a burst limit earns the pinned patience: it is refused in milliseconds and bills
        // nothing, where re-asking a stall this often would sit out the whole bound each time.
        if (rateLimited(err) ? ++bursts > this.rateLimitRetries : ++stalls > this.maxRetries) break
        const wait = retryBackoffMs(err, sends - 1)
        // A wait the caller has no time left for buys nothing: fail now rather than bill it too.
        if (wait > this.requestTimeoutMs) break
        if (wait > 0) await sleep(wait, this.cancellation.signal)
      } finally {
        const pinned = this.limiter.pinnedAlert()
        if (pinned !== null) this.alert('llm_rate_pinned', pinned)
      }
    }
    this.alert(
      'llm_call_failed',
      `${this.caller}: ${sends} attempt(s) failed, the last bounded at ` +
        `${(this.requestTimeoutMs / 1000).toFixed(0)}s — ` +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    )
    throw lastError
  }

  /** One ask, ledgered whichever way it ends. Every row `llm_calls` carries is written here. */
  private async attemptOnce<T>(
    model: LanguageModel,
    modelName: string,
    exec: (model: LanguageModel, note: Note) => Promise<T>,
    bill: CallBill,
  ): Promise<{ value: T; usage: LlmUsage }> {
    const start = performance.now()
    let facts: StepFacts = {}
    const note: Note = (f) => {
      facts = f
    }
    try {
      const value = await exec(model, note)
      const served = facts.servedModel ?? modelName
      const tokens = tokensOf(facts.usage)
      const { inputTokens, outputTokens, cacheReadTokens } = tokens
      const provider = facts.provider ?? null
      const reported = facts.reportedCostUsd ?? null
      const computed = computeCostUsd(inputTokens, outputTokens, cacheReadTokens, served, provider)
      const costUsd = bookCostUsd(this.db, {
        agentId: this.agentId,
        computed,
        reported,
        served,
        provider,
      })
      this.lastCallId = insertLlmCall(
        this.db,
        this.llmCallRow({
          model: served,
          provider,
          generationId: facts.generationId ?? null,
          ...tokens,
          costUsd,
          estimatedCostUsd: computed.costUsd,
          reportedCostUsd: reported,
          latencyMs: performance.now() - start,
          finishReason: facts.finishReason ?? null,
          error: null,
          ...bill,
        }),
      )
      this.warnIfTruncated(facts.finishReason)
      return { value, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd } }
    } catch (err) {
      // Priced here rather than through `bookCostUsd`: a dead call was still billed, has no
      // reported cost to reconcile against, and an unattributed route would alert every time.
      const dead = NoObjectGeneratedError.isInstance(err) ? err : null
      const served = dead?.response?.modelId ?? facts.servedModel ?? modelName
      const provider =
        dead === null ? (facts.provider ?? null) : servedProvider(dead.response, undefined)
      const finishReason = dead?.finishReason ?? facts.finishReason ?? null
      const tokens = tokensOf(dead?.usage ?? facts.usage)
      const { inputTokens, outputTokens, cacheReadTokens } = tokens
      const deadCost = computeCostUsd(
        inputTokens,
        outputTokens,
        cacheReadTokens,
        served,
        provider,
      ).costUsd
      this.lastCallId = insertLlmCall(
        this.db,
        this.llmCallRow({
          model: served,
          provider,
          // The refusal carries the generation it came from, and `note` never ran to record it:
          // without this the 3 rows r13 booked at the ceiling had no id to ask OpenRouter about.
          generationId: dead?.response?.id ?? facts.generationId ?? null,
          ...tokens,
          costUsd: deadCost,
          estimatedCostUsd: deadCost,
          reportedCostUsd: null,
          latencyMs: performance.now() - start,
          finishReason,
          error: err instanceof Error ? err.message : String(err),
          ...bill,
        }),
      )
      this.warnIfTruncated(finishReason)
      if (finishReason === 'length' && answeredNothing(err, dead))
        throw new RunawayError(outputTokens, err)
      throw err
    }
  }

  private llmCallRow(call: Omit<LlmCallInsert, 'agentId' | 'caller' | 'ok'>): LlmCallInsert {
    return { agentId: this.agentId, caller: this.caller, ...call, ok: call.error === null }
  }

  /** Public so a test can prove what a live call sends without making one. */
  requestBody(reasoning: ReasoningSetting | null = this.reasoning): RequestBody {
    return defaultExtraBody(
      FALLBACK_MODELS,
      this.providerOrder,
      this.allowProviderFallbacks,
      reasoning ?? undefined,
      this.modelId,
      sessionIdFor(this.agentId),
    )
  }

  private resolveModel(reasoning: ReasoningSetting | null = this.reasoning): LanguageModel {
    // An injected model answers every ask, the fallback included: tests script it that way.
    if (this.opts.model !== undefined) return this.opts.model
    const fallback = reasoning !== this.reasoning
    const cached = fallback ? this.fallbackModel : this.model
    if (cached !== undefined) return cached
    const key = process.env.OPENROUTER_API_KEY
    const openrouter = createOpenRouter(key === undefined ? {} : { apiKey: key })
    const built = openrouter(this.modelId, {
      // Without this OpenRouter omits `usage.cost` and the ledger has no second opinion.
      usage: { include: true },
      extraBody: this.requestBody(reasoning),
    })
    if (fallback) this.fallbackModel = built
    else this.model = built
    return built
  }
}

// No text and no tool call: the SDK says so one way for the object path, and the tool path's
// own refusal carries whatever the model did write.
function answeredNothing(err: unknown, dead: NoObjectGeneratedError | null): boolean {
  if (NoOutputGeneratedError.isInstance(err)) return true
  if (dead === null) return false
  return (dead.text ?? '').trim().length === 0
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content }
      : { role: 'assistant' as const, content: m.content },
  )
}
