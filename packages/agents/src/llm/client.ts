import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type LanguageModelUsage, type ModelMessage } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type Database from 'better-sqlite3'
import type { z } from 'zod'
import { insertAlert, insertLlmCall, makeBudgetGuard, sumCostUsd, type BudgetGuard } from './callLog.js'
import {
  FALLBACK_MODELS, MIND_MODEL, PRICE_PER_M, PRICE_PER_M_BY_MODEL, PROVIDER_ORDER,
  reasoningFor, type ReasoningSetting,
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
  servedModel?: string
  provider?: string | null
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

// `provider.order` is a PREFERENCE; only `allow_fallbacks:false` makes it an allow-list. It
// was a hardcoded literal, so pinning a provider pinned nothing and the run got the pinned
// provider's answer rate AND whatever OpenRouter fell through to — which is why an empty-call
// rate that swung 14-51% across identical runs decided the last gate (C11 R20).
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
  const fromMeta = (meta as { openrouter?: { provider?: unknown } } | undefined)?.openrouter?.provider
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
  const fromBody = (response as { body?: { provider?: unknown } } | undefined)?.body?.provider
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null
}

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
  // How long one attempt may sit before it is abandoned. A stalled provider response used to
  // hang the caller for ever: an interrupted G11b night lost 614 s to one `semantic` call and
  // then failed anyway, with two more retries queued behind it (C11 T37b).
  requestTimeoutMs?: number
  budgetUsd?: number
  maxOutputTokens?: number
  // Pre-booked per call while it is in flight. ~3x the observed mean call.
  expectedCallCostUsd?: number
}

export const DEFAULT_EXPECTED_CALL_COST_USD = 0.005

// Six minutes. The slowest call that has ever legitimately answered is a nightly chronicle at
// 205 s, so this is ~75% headroom over it; the stall that forced the bound sat for 614 s.
export const DEFAULT_REQUEST_TIMEOUT_MS = 360_000

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
          maxOutputTokens: this.maxOutputTokens,
          abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
          output: Output.object({ schema: opts.schema }),
        })
        return {
          usage: r.usage, value: r.output, servedModel: r.response.modelId,
          provider: servedProvider(r.response, r.providerMetadata),
        }
      } catch (err) {
        // The shape was wrong; the content may not have been. GATE G11b day 3 threw away a
        // chronicle whose title and text were both complete and whole. The repair re-frames
        // the provider's own bytes and re-checks them against this caller's schema — it never
        // re-asks and never invents (C11 batch 16 fix 2).
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
        system: opts.system,
        messages: toModelMessages(opts.messages),
        maxRetries: 0,
        maxOutputTokens: this.maxOutputTokens,
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      })
      return {
        usage: r.usage, value: r.text, servedModel: r.response.modelId,
        provider: servedProvider(r.response, r.providerMetadata),
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
        const { usage: raw, value, servedModel, provider } = await exec(model)
        const served = servedModel ?? modelName
        const inputTokens = raw.inputTokens ?? 0
        const outputTokens = raw.outputTokens ?? 0
        const cacheReadTokens = raw.inputTokenDetails.cacheReadTokens ?? 0
        const reasoningTokens = raw.outputTokenDetails.reasoningTokens ?? 0
        const costUsd = computeCostUsd(inputTokens, outputTokens, cacheReadTokens, served)
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
          latencyMs: performance.now() - start,
          ok: true,
          error: null,
        })
        return { value, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd } }
      } catch (err) {
        lastError = err
        insertLlmCall(this.db, {
          agentId: this.agentId,
          caller: this.caller,
          model: modelName,
          // A failure carries no answer, so it carries no back end to name it by. The
          // per-provider empty-call rate is therefore a rate over the calls that landed.
          provider: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
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
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
    this.model = openrouter(MIND_MODEL, {
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

export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  model?: string,
): number {
  const prices = (model !== undefined ? PRICE_PER_M_BY_MODEL[model] : undefined) ?? PRICE_PER_M
  return (
    ((inputTokens - cacheReadTokens) * prices.input +
      cacheReadTokens * prices.cacheRead +
      outputTokens * prices.output) /
    1e6
  )
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content }
      : { role: 'assistant' as const, content: m.content },
  )
}
