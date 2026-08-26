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
import type { z } from 'zod'
import {
  insertAlert,
  insertLlmCall,
  makeBudgetGuard,
  sumCostUsd,
  type BudgetGuard,
} from './callLog.js'
import {
  FALLBACK_MODELS,
  MIND_MODEL,
  PROVIDER_ORDER,
  pricesFor,
  reasoningFor,
  type PriceSource,
  type ReasoningSetting,
} from './pins.js'
import { repairToSchema } from './repair.js'

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
  fallbackModels?: string[]
  providerOrder?: string[]
  // False turns `providerOrder` from a preference into an allow-list. Absent leaves the
  // routing exactly as it has always been.
  allowProviderFallbacks?: boolean
  // Absent falls back to the per-caller pin in `pins.ts`; `null` sends nothing at all.
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

const DEFAULT_EXPECTED_CALL_COST_USD = 0.005

// Six minutes: ~75% headroom over the slowest call that has ever legitimately answered.
const DEFAULT_REQUEST_TIMEOUT_MS = 360_000

export class LlmClient {
  private readonly db: Database.Database
  private readonly caller: string
  private readonly agentId: string | null
  private readonly fallbackModels: string[]
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
    this.fallbackModels = opts.fallbackModels ?? FALLBACK_MODELS
    this.providerOrder = opts.providerOrder ?? PROVIDER_ORDER
    this.allowProviderFallbacks = opts.allowProviderFallbacks ?? true
    this.reasoning = opts.reasoning === undefined ? reasoningFor(opts.caller) : opts.reasoning
    this.maxRetries = opts.maxRetries ?? 2
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.budgetUsd = opts.budgetUsd
    this.maxOutputTokens = opts.maxOutputTokens
    this.expectedCallCostUsd = opts.expectedCallCostUsd ?? DEFAULT_EXPECTED_CALL_COST_USD
    this.guard = makeBudgetGuard(opts.db, opts.caller)
    this.model = opts.model
  }

  async object<T>(opts: {
    system: string
    messages: LlmMessage[]
    schema: z.ZodType<T>
  }): Promise<{ value: T; usage: LlmUsage }> {
    return this.invoke(async (model) => {
      try {
        const r = await generateText({
          model,
          system: opts.system,
          messages: toModelMessages(opts.messages),
          maxRetries: 0,
          ...(this.maxOutputTokens === undefined ? {} : { maxOutputTokens: this.maxOutputTokens }),
          abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
          output: Output.object({ schema: opts.schema }),
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
        const repaired = repairToSchema(err.text ?? '', opts.schema)
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
    const { value, usage } = await this.invoke(async (model) => {
      const r = await generateText({
        model,
        ...(opts.system === undefined ? {} : { system: opts.system }),
        messages: toModelMessages(opts.messages),
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
        const inputTokens = raw.inputTokens ?? 0
        const outputTokens = raw.outputTokens ?? 0
        const cacheReadTokens = raw.inputTokenDetails.cacheReadTokens ?? 0
        const reasoningTokens = raw.outputTokenDetails.reasoningTokens ?? 0
        const computed = computeCostUsd(
          inputTokens,
          outputTokens,
          cacheReadTokens,
          served,
          provider,
        )
        const costUsd = this.book(computed, reported ?? null, served, provider ?? null)
        insertLlmCall(this.db, {
          agentId: this.agentId,
          caller: this.caller,
          model: served,
          provider: provider ?? null,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          reasoningTokens,
          costUsd,
          reportedCostUsd: reported ?? null,
          latencyMs: performance.now() - start,
          ok: true,
          error: null,
        })
        return { value, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd } }
      } catch (err) {
        lastError = err
        // A generation that came back with nothing was still billed, and it carries the tokens
        // to say so. Priced here rather than through `book`: there is no reported cost to
        // reconcile against, and an unattributed route would alert on every dead call.
        const dead = NoObjectGeneratedError.isInstance(err) ? err : null
        const served = dead?.response?.modelId ?? modelName
        const provider = dead === null ? null : servedProvider(dead.response, undefined)
        const raw = dead?.usage
        const inputTokens = raw?.inputTokens ?? 0
        const outputTokens = raw?.outputTokens ?? 0
        const cacheReadTokens = raw?.inputTokenDetails.cacheReadTokens ?? 0
        insertLlmCall(this.db, {
          agentId: this.agentId,
          caller: this.caller,
          model: served,
          // A failure that carries no answer carries no back end to name it by. The
          // per-provider empty-call rate is therefore a rate over the calls that landed.
          provider,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          reasoningTokens: raw?.outputTokenDetails.reasoningTokens ?? 0,
          costUsd: computeCostUsd(inputTokens, outputTokens, cacheReadTokens, served, provider)
            .costUsd,
          reportedCostUsd: null,
          latencyMs: performance.now() - start,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
        // An invalid generation is not a transient provider fault: retrying
        // the identical request wastes calls — surface it for a real repair.
        if (NoObjectGeneratedError.isInstance(err)) throw err
      }
    }
    throw lastError
  }

  private resolveModel(): LanguageModel {
    if (this.model !== undefined) return this.model
    const key = process.env.OPENROUTER_API_KEY
    const openrouter = createOpenRouter(key === undefined ? {} : { apiKey: key })
    this.model = openrouter(MIND_MODEL, {
      // Without this OpenRouter omits `usage.cost` and the ledger has no second opinion.
      usage: { include: true },
      extraBody: defaultExtraBody(
        this.fallbackModels,
        this.providerOrder,
        this.allowProviderFallbacks,
        this.reasoning ?? undefined,
      ),
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
