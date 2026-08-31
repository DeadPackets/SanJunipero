import {
  generateText,
  NoObjectGeneratedError,
  Output,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { assertNoGlassLeak } from '@sj/shared'
import {
  insertAlert,
  insertLlmCall,
  insertTurnOutcome,
  makeBudgetGuard,
  sumCostUsd,
  type BudgetGuard,
  type LlmCallInsert,
} from './callLog.js'
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

export type { ReasoningSetting }

export type LlmUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

export type LlmMessage = { role: 'user' | 'assistant'; content: string }

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

// `provider.order` is only an allow-list with `allow_fallbacks:false`, the default here: 8 of the
// 30 endpoints serving MIND_MODEL cannot do structured output, so a hop to one is a hard failure.
export function defaultExtraBody(
  fallbackModels: string[] = FALLBACK_MODELS,
  providerOrder: string[] = PROVIDER_ORDER,
  allowFallbacks = false,
  reasoning?: ReasoningSetting,
): {
  models: string[]
  provider: { order: string[]; allow_fallbacks: boolean }
  reasoning?: ReasoningSetting
} {
  return {
    models: [MIND_MODEL, ...fallbackModels],
    provider: { order: providerOrder, allow_fallbacks: allowFallbacks },
    ...(reasoning === undefined ? {} : { reasoning }),
  }
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
  budgetUsd?: number
  maxOutputTokens?: number
  // Pre-booked per call while it is in flight. ~3x the observed mean call.
  expectedCallCostUsd?: number
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

export class LlmClient {
  private readonly db: Database.Database
  private readonly caller: string
  private readonly agentId: string | null
  private readonly providerOrder: string[]
  private readonly allowProviderFallbacks: boolean
  private readonly reasoning: ReasoningSetting | null
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly budgetUsd: number | undefined
  private readonly maxOutputTokens: number | undefined
  private readonly expectedCallCostUsd: number
  private readonly guard: BudgetGuard
  private readonly opts: LlmClientOpts
  private model: LanguageModel | undefined

  constructor(opts: LlmClientOpts) {
    this.opts = { ...opts }
    this.db = opts.db
    this.caller = opts.caller
    this.agentId = opts.agentId ?? null
    this.providerOrder = opts.providerOrder ?? PROVIDER_ORDER
    this.allowProviderFallbacks = opts.allowProviderFallbacks ?? false
    const pinned = callSettingsFor(opts.caller)
    this.reasoning = opts.reasoning === undefined ? (pinned.reasoning ?? null) : opts.reasoning
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    this.requestTimeoutMs = opts.requestTimeoutMs ?? requestTimeoutMsFor(opts.caller)
    this.budgetUsd = opts.budgetUsd
    this.maxOutputTokens = opts.maxOutputTokens ?? pinned.maxOutputTokens
    this.expectedCallCostUsd = opts.expectedCallCostUsd ?? DEFAULT_EXPECTED_CALL_COST_USD
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
  }): Promise<{ value: T; usage: LlmUsage }> {
    const system = this.seal(opts.system)
    const messages = this.sealAll(opts.messages)
    try {
      return await this.generateObject(system, messages, opts.schema)
    } catch (err) {
      const bad = opts.repairOnce === true ? malformedObjectText(err) : undefined
      if (bad === undefined) throw err
      const why = opts.schema.safeParse(jsonOrNothing(bad)).error
      return await this.generateObject(
        system,
        [
          ...messages,
          { role: 'assistant', content: bad.length > 0 ? bad : '…' },
          {
            role: 'user',
            content: `Your answer was rejected. Fix it:\n${why === undefined ? bad : z.prettifyError(why)}`,
          },
        ],
        opts.schema,
      )
    }
  }

  private async generateObject<T>(
    system: string,
    messages: LlmMessage[],
    schema: z.ZodType<T>,
  ): Promise<{ value: T; usage: LlmUsage }> {
    return this.invoke(async (model, note) => {
      try {
        const r = await generateText({
          model,
          system,
          messages: toModelMessages(messages),
          maxRetries: 0,
          ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
          abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
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
    })
  }

  async text(opts: {
    system?: string
    messages: LlmMessage[]
  }): Promise<{ text: string; usage: LlmUsage }> {
    const system = opts.system === undefined ? undefined : this.seal(opts.system)
    const messages = this.sealAll(opts.messages)
    const { value, usage } = await this.invoke(async (model, note) => {
      const r = await generateText({
        model,
        ...(system === undefined ? {} : { system }),
        messages: toModelMessages(messages),
        maxRetries: 0,
        ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      })
      note(stepFacts(r))
      return r.text
    })
    return { text: value, usage }
  }

  /** The same ledger, budget and routing under another caller name, so one call inside a pass
   *  can carry its own pinned settings and its own by-caller line. */
  forCaller(caller: string): LlmClient {
    return new LlmClient({ ...this.opts, caller })
  }

  totalCostUsd(): number {
    return sumCostUsd(this.db, this.caller)
  }

  alert(kind: string, detail: string): void {
    insertAlert(this.db, { agentId: this.agentId, kind, detail })
  }

  /** Books what the last answer produced against the back end that served it. A well-formed
   *  turn that does nothing is the one failure the ledger cannot see from the call row alone. */
  noteTurnOutcome(outcome: { acted: boolean; spoke: boolean }): void {
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

  // The one door every provider-bound prompt passes through, whichever of the six callers
  // assembled it: an ops-plane word is cut out here and the row says which caller leaked it.
  private seal(text: string): string {
    return assertNoGlassLeak(text, this.caller, (leaks, where) => {
      this.alert('glass_leak', `${where}: ${leaks.join(', ')} — redacted before the call`)
    })
  }

  private sealAll(messages: readonly LlmMessage[]): LlmMessage[] {
    return messages.map((m) => ({ ...m, content: this.seal(m.content) }))
  }

  private async invoke<T>(
    exec: (model: LanguageModel, note: Note) => Promise<T>,
  ): Promise<{ value: T; usage: LlmUsage }> {
    if (this.budgetUsd !== undefined && this.totalCostUsd() >= this.budgetUsd) {
      throw new BudgetExceededError(
        `LLM budget exceeded for caller '${this.caller}': spent $${this.totalCostUsd().toFixed(6)} of $${this.budgetUsd.toFixed(6)}`,
      )
    }
    // Pre-book what this call is expected to cost, so concurrent callers cannot
    // all read the same headroom and all spend it.
    const reservation = this.guard.reserve(this.expectedCallCostUsd, this.budgetUsd ?? null)
    if (reservation === null) {
      throw new BudgetExceededError(
        `LLM budget exceeded for caller '${this.caller}': spent $${this.totalCostUsd().toFixed(6)} plus $${this.guard.sumReserved().toFixed(6)} in flight of $${(this.budgetUsd ?? 0).toFixed(6)}`,
      )
    }
    try {
      return await this.invokeReserved(exec)
    } finally {
      this.guard.release(reservation)
    }
  }

  private async invokeReserved<T>(
    exec: (model: LanguageModel, note: Note) => Promise<T>,
  ): Promise<{ value: T; usage: LlmUsage }> {
    const model = this.resolveModel()
    const modelName = typeof model === 'string' ? model : model.modelId
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
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
        const computed = computeCostUsd(
          inputTokens,
          outputTokens,
          cacheReadTokens,
          served,
          provider,
        )
        const costUsd = bookCostUsd(this.db, {
          agentId: this.agentId,
          computed,
          reported,
          served,
          provider,
        })
        insertLlmCall(
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
          }),
        )
        this.warnIfTruncated(facts.finishReason)
        return { value, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd } }
      } catch (err) {
        lastError = err
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
        insertLlmCall(
          this.db,
          this.llmCallRow({
            model: served,
            provider,
            generationId: facts.generationId ?? null,
            ...tokens,
            costUsd: deadCost,
            estimatedCostUsd: deadCost,
            reportedCostUsd: null,
            latencyMs: performance.now() - start,
            finishReason,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        this.warnIfTruncated(finishReason)
        // An invalid generation is not a transient provider fault: retrying
        // the identical request wastes calls — surface it for a real repair.
        if (NoObjectGeneratedError.isInstance(err)) throw err
      }
    }
    this.alert(
      'llm_call_failed',
      `${this.caller}: ${this.maxRetries + 1} attempt(s) failed, the last bounded at ` +
        `${(this.requestTimeoutMs / 1000).toFixed(0)}s — ` +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    )
    throw lastError
  }

  private llmCallRow(call: Omit<LlmCallInsert, 'agentId' | 'caller' | 'ok'>): LlmCallInsert {
    return { agentId: this.agentId, caller: this.caller, ...call, ok: call.error === null }
  }

  /** Public so a test can prove what a live call sends without making one. */
  requestBody(): ReturnType<typeof defaultExtraBody> {
    return defaultExtraBody(
      FALLBACK_MODELS,
      this.providerOrder,
      this.allowProviderFallbacks,
      this.reasoning ?? undefined,
    )
  }

  private resolveModel(): LanguageModel {
    if (this.model !== undefined) return this.model
    const key = process.env.OPENROUTER_API_KEY
    const openrouter = createOpenRouter(key === undefined ? {} : { apiKey: key })
    this.model = openrouter(MIND_MODEL, {
      // Without this OpenRouter omits `usage.cost` and the ledger has no second opinion.
      usage: { include: true },
      extraBody: this.requestBody(),
    })
    return this.model
  }
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content }
      : { role: 'assistant' as const, content: m.content },
  )
}
