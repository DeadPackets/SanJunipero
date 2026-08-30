import {
  generateText,
  NoObjectGeneratedError,
  Output,
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
  makeBudgetGuard,
  sumCostUsd,
  type BudgetGuard,
  type LlmCallInsert,
} from './callLog.js'
import {
  FALLBACK_MODELS,
  MIND_MODEL,
  PROVIDER_ORDER,
  callSettingsFor,
  pricesFor,
  type PriceSource,
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

type ExecResult<T> = {
  usage: LanguageModelUsage
  value: T
  servedModel?: string | undefined
  provider?: string | null
  // What OpenRouter says it actually charged, when it says so at all.
  reportedCostUsd?: number | null
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

// `provider.order` is a preference; only `allow_fallbacks:false` makes it an allow-list.
// The default stays `true`: this exposes the switch, it does not throw one.
export function defaultExtraBody(
  fallbackModels: string[] = FALLBACK_MODELS,
  providerOrder: string[] = PROVIDER_ORDER,
  allowFallbacks = true,
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

// Which back end answered. OpenRouter says so in its own metadata and again in the raw body;
// neither is guaranteed, and a call nobody can attribute is recorded as one.
export function servedProvider(response: unknown, meta: unknown): string | null {
  const fromMeta = (meta as { openrouter?: { provider?: unknown } } | undefined)?.openrouter
    ?.provider
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
  const fromBody = (response as { body?: { provider?: unknown } } | undefined)?.body?.provider
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null
}

// What the bill says, reported under `usage.cost` once `usage: { include: true }` is set on
// the request. The only number here that cannot go stale.
function reportedCostUsd(meta: unknown): number | null {
  const cost = (meta as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter
    ?.usage?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

// How far the table may sit from the bill before it is a defect rather than rounding. Sub-cent
// calls round hard, so a divergence has to clear BOTH bars.
const COST_DIVERGENCE_FRACTION = 0.2
const COST_DIVERGENCE_FLOOR_USD = 5e-6

export type LlmClientOpts = {
  model?: LanguageModel
  db: Database.Database
  caller: string
  agentId?: string
  providerOrder?: string[]
  // False turns `providerOrder` from a preference into an allow-list. Absent leaves the
  // routing exactly as it has always been.
  allowProviderFallbacks?: boolean
  // Both of these fall back to the caller's row in `pins.ts` when absent; `reasoning: null`
  // sends nothing at all.
  reasoning?: ReasoningSetting | null
  maxRetries?: number
  // How long one attempt may sit before it is abandoned; without it a stalled response hangs
  // the caller for ever, with the retries queued behind it.
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
function callTokens(raw: LanguageModelUsage | undefined): CallTokens {
  return {
    inputTokens: raw?.inputTokens ?? 0,
    outputTokens: raw?.outputTokens ?? 0,
    cacheReadTokens: raw?.inputTokenDetails.cacheReadTokens ?? 0,
    reasoningTokens: raw?.outputTokenDetails.reasoningTokens ?? 0,
  }
}

const DEFAULT_EXPECTED_CALL_COST_USD = 0.005

// Six minutes: ~75% headroom over the slowest call that has ever legitimately answered.
const DEFAULT_REQUEST_TIMEOUT_MS = 360_000

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
  private model: LanguageModel | undefined

  constructor(opts: LlmClientOpts) {
    this.db = opts.db
    this.caller = opts.caller
    this.agentId = opts.agentId ?? null
    this.providerOrder = opts.providerOrder ?? PROVIDER_ORDER
    this.allowProviderFallbacks = opts.allowProviderFallbacks ?? true
    const pinned = callSettingsFor(opts.caller)
    this.reasoning = opts.reasoning === undefined ? (pinned.reasoning ?? null) : opts.reasoning
    this.maxRetries = opts.maxRetries ?? 2
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.budgetUsd = opts.budgetUsd
    this.maxOutputTokens = opts.maxOutputTokens ?? pinned.maxOutputTokens
    this.expectedCallCostUsd = opts.expectedCallCostUsd ?? DEFAULT_EXPECTED_CALL_COST_USD
    this.guard = makeBudgetGuard(opts.db, opts.caller)
    this.model = opts.model
  }

  // `repairOnce` adds the second rung to the repair below: when the provider's own bytes
  // cannot be re-framed into the schema, they go back as its own turn with what the schema
  // said was wrong, and the answer is asked for once more. Off by default — a caller that
  // wants a wrong answer corrected has to say so.
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
    return this.invoke(async (model) => {
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
        return {
          usage: r.usage,
          value: r.output,
          servedModel: r.finalStep.response.modelId,
          provider: servedProvider(r.finalStep.response, r.finalStep.providerMetadata),
          reportedCostUsd: reportedCostUsd(r.finalStep.providerMetadata),
        }
      } catch (err) {
        // Re-frames the provider's own bytes against this caller's schema; never re-asks,
        // never invents.
        if (!NoObjectGeneratedError.isInstance(err)) throw err
        const repaired = repairToSchema(err.text ?? '', schema)
        if (repaired === undefined) throw err
        this.alert('decode_repaired', `${this.caller}: ${repaired.how}`)
        return {
          usage: err.usage ?? EMPTY_USAGE,
          value: repaired.value,
          servedModel: err.response?.modelId,
          provider: servedProvider(err.response, undefined),
        }
      }
    })
  }

  async text(opts: {
    system?: string
    messages: LlmMessage[]
  }): Promise<{ text: string; usage: LlmUsage }> {
    const system = opts.system === undefined ? undefined : this.seal(opts.system)
    const messages = this.sealAll(opts.messages)
    const { value, usage } = await this.invoke(async (model) => {
      const r = await generateText({
        model,
        ...(system === undefined ? {} : { system }),
        messages: toModelMessages(messages),
        maxRetries: 0,
        ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      })
      return {
        usage: r.usage,
        value: r.text,
        servedModel: r.finalStep.response.modelId,
        provider: servedProvider(r.finalStep.response, r.finalStep.providerMetadata),
        reportedCostUsd: reportedCostUsd(r.finalStep.providerMetadata),
      }
    })
    return { text: value, usage }
  }

  totalCostUsd(): number {
    return sumCostUsd(this.db, this.caller)
  }

  alert(kind: string, detail: string): void {
    insertAlert(this.db, { agentId: this.agentId, kind, detail })
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

  // The provider's own charge wins when offered: it is the bill. The table stays as the second
  // opinion — a single source of truth cannot reconcile against itself — and as the fallback.
  private book(
    computed: ComputedCost,
    reported: number | null,
    served: string,
    provider: string | null,
  ): number {
    // A back end or model nobody has priced must never book cheap: it books at the worst rate
    // any endpoint charges for this model, and it says so.
    if (computed.source === 'ceiling') {
      this.alert(
        'llm_price_unpriced_route',
        `${served} served by ${provider ?? 'an unnamed back end'} has no price row; ` +
          `booked at the ceiling ($${computed.costUsd.toFixed(6)})`,
      )
    }
    if (reported === null) return computed.costUsd
    const gap = Math.abs(reported - computed.costUsd)
    const scale = Math.max(reported, computed.costUsd)
    if (gap > COST_DIVERGENCE_FLOOR_USD && scale > 0 && gap / scale > COST_DIVERGENCE_FRACTION) {
      // The alert that catches a mispriced pin on the first call rather than the six hundredth.
      this.alert(
        'llm_price_divergence',
        `${provider ?? 'unattributed'} charged $${reported.toFixed(6)} for ${served} but the ` +
          `pinned table computed $${computed.costUsd.toFixed(6)} ` +
          `(${((gap / scale) * 100).toFixed(0)}% out, prices from ${computed.source}) — the pin is stale`,
      )
    }
    return reported
  }

  private async invoke<T>(
    exec: (model: LanguageModel) => Promise<ExecResult<T>>,
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
    exec: (model: LanguageModel) => Promise<ExecResult<T>>,
  ): Promise<{ value: T; usage: LlmUsage }> {
    const model = this.resolveModel()
    const modelName = typeof model === 'string' ? model : model.modelId
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const start = performance.now()
      try {
        const {
          usage: raw,
          value,
          servedModel,
          provider,
          reportedCostUsd: reported,
        } = await exec(model)
        const served = servedModel ?? modelName
        const tokens = callTokens(raw)
        const { inputTokens, outputTokens, cacheReadTokens } = tokens
        const computed = computeCostUsd(
          inputTokens,
          outputTokens,
          cacheReadTokens,
          served,
          provider,
        )
        const costUsd = this.book(computed, reported ?? null, served, provider ?? null)
        insertLlmCall(
          this.db,
          this.llmCallRow({
            model: served,
            provider: provider ?? null,
            tokens,
            costUsd,
            estimatedCostUsd: computed.costUsd,
            reportedCostUsd: reported ?? null,
            latencyMs: performance.now() - start,
            error: null,
          }),
        )
        return { value, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd } }
      } catch (err) {
        lastError = err
        // A generation that came back with nothing was still billed, and it carries the tokens
        // to say so. Priced here rather than through `book`: there is no reported cost to
        // reconcile against, and an unattributed route would alert on every dead call.
        const dead = NoObjectGeneratedError.isInstance(err) ? err : null
        const served = dead?.response?.modelId ?? modelName
        // A failure that carries no answer carries no back end to name it by. The
        // per-provider empty-call rate is therefore a rate over the calls that landed.
        const provider = dead === null ? null : servedProvider(dead.response, undefined)
        const tokens = callTokens(dead?.usage)
        const deadCost = computeCostUsd(
          tokens.inputTokens,
          tokens.outputTokens,
          tokens.cacheReadTokens,
          served,
          provider,
        ).costUsd
        insertLlmCall(
          this.db,
          this.llmCallRow({
            model: served,
            provider,
            tokens,
            costUsd: deadCost,
            estimatedCostUsd: deadCost,
            reportedCostUsd: null,
            latencyMs: performance.now() - start,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        // An invalid generation is not a transient provider fault: retrying
        // the identical request wastes calls — surface it for a real repair.
        if (NoObjectGeneratedError.isInstance(err)) throw err
      }
    }
    throw lastError
  }

  private llmCallRow(
    call: Omit<LlmCallInsert, 'agentId' | 'caller' | 'ok' | keyof CallTokens> & {
      tokens: CallTokens
    },
  ): LlmCallInsert {
    const { tokens, ...rest } = call
    return {
      agentId: this.agentId,
      caller: this.caller,
      ...tokens,
      ...rest,
      ok: call.error === null,
    }
  }

  /** The routing and reasoning body this client's calls carry. Readable so a test can prove
   *  what a live call sends without making one. */
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

export type ComputedCost = { costUsd: number; source: PriceSource }

// The table's estimate, and which row it came from. `source: 'ceiling'` means nobody priced this
// route and the caller must be loud rather than book it cheap.
export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  model?: string,
  provider?: string | null,
): ComputedCost {
  const { prices, source } = pricesFor(model, provider)
  const costUsd =
    ((inputTokens - cacheReadTokens) * prices.input +
      cacheReadTokens * prices.cacheRead +
      outputTokens * prices.output) /
    1e6
  return { costUsd, source }
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content }
      : { role: 'assistant' as const, content: m.content },
  )
}
