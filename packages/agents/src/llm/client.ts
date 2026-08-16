import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type LanguageModelUsage, type ModelMessage } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type Database from 'better-sqlite3'
import type { z } from 'zod'
import { insertAlert, insertLlmCall, sumCostUsd } from './callLog.js'
import { FALLBACK_MODELS, MIND_MODEL, PRICE_PER_M, PRICE_PER_M_BY_MODEL, PROVIDER_ORDER } from './pins.js'

export type LlmUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

export type LlmMessage = { role: 'user' | 'assistant'; content: string }

export class BudgetExceededError extends Error {}

export function defaultExtraBody(
  fallbackModels: string[] = FALLBACK_MODELS,
  providerOrder: string[] = PROVIDER_ORDER,
): { models: string[]; provider: { order: string[]; allow_fallbacks: boolean } } {
  return {
    models: [MIND_MODEL, ...fallbackModels],
    provider: { order: providerOrder, allow_fallbacks: true },
  }
}

export type LlmClientOpts = {
  model?: LanguageModel
  db: Database.Database
  caller: string
  agentId?: string
  fallbackModels?: string[]
  providerOrder?: string[]
  maxRetries?: number
  budgetUsd?: number
  maxOutputTokens?: number
}

export class LlmClient {
  private readonly db: Database.Database
  private readonly caller: string
  private readonly agentId: string | null
  private readonly fallbackModels: string[]
  private readonly providerOrder: string[]
  private readonly maxRetries: number
  private readonly budgetUsd: number | undefined
  private readonly maxOutputTokens: number | undefined
  private model: LanguageModel | undefined

  constructor(opts: LlmClientOpts) {
    this.db = opts.db
    this.caller = opts.caller
    this.agentId = opts.agentId ?? null
    this.fallbackModels = opts.fallbackModels ?? FALLBACK_MODELS
    this.providerOrder = opts.providerOrder ?? PROVIDER_ORDER
    this.maxRetries = opts.maxRetries ?? 2
    this.budgetUsd = opts.budgetUsd
    this.maxOutputTokens = opts.maxOutputTokens
    this.model = opts.model
  }

  async object<T>(opts: {
    system: string
    messages: LlmMessage[]
    schema: z.ZodType<T>
  }): Promise<{ value: T; usage: LlmUsage }> {
    return this.invoke(async (model) => {
      const r = await generateText({
        model,
        system: opts.system,
        messages: toModelMessages(opts.messages),
        maxRetries: 0,
        maxOutputTokens: this.maxOutputTokens,
        output: Output.object({ schema: opts.schema }),
      })
      return { usage: r.usage, value: r.output, servedModel: r.response.modelId }
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
      })
      return { usage: r.usage, value: r.text, servedModel: r.response.modelId }
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
    exec: (model: LanguageModel) => Promise<{ usage: LanguageModelUsage; value: T; servedModel?: string }>,
  ): Promise<{ value: T; usage: LlmUsage }> {
    if (this.budgetUsd !== undefined && this.totalCostUsd() >= this.budgetUsd) {
      throw new BudgetExceededError(
        `LLM budget exceeded for caller '${this.caller}': spent $${this.totalCostUsd().toFixed(6)} of $${this.budgetUsd.toFixed(6)}`,
      )
    }
    const model = this.resolveModel()
    const modelName = typeof model === 'string' ? model : model.modelId
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const start = performance.now()
      try {
        const { usage: raw, value, servedModel } = await exec(model)
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
      extraBody: defaultExtraBody(this.fallbackModels, this.providerOrder),
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
