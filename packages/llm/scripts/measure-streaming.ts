import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { StrictTurnSchema } from '../../agents/src/turn.js'
import { RULES_OF_BEING, CAPABILITIES, SPEECH_RULES } from '../../agents/src/prompt/rulesOfBeing.js'
import {
  migrateLlmTables,
  configureSpendLimits,
  makeBudgetGuard,
  computeCostUsd,
  MIND_MODEL,
  sumCostUsd,
  sumReserved,
} from '@sj/llm'

const output = process.argv[2]
if (!output || !process.env.OPENROUTER_API_KEY)
  throw new Error('Output directory and provider credential required')
mkdirSync(output, { recursive: true })
const db = new Database(join(output, 'ops.db'))
migrateLlmTables(db)
configureSpendLimits(db, { lifetimeUsd: 2, rollingDayUsd: 2 })
const guard = makeBudgetGuard(db, 'streaming-probe')
const schema = z.toJSONSchema(StrictTurnSchema)
const prompts = [
  'You are Halim, an adult carpenter. It is morning. You are healthy and awake inside the public storehouse. You just finished stowing plank item_75 in structure_store. Your hands are empty. The plank is in storage. Your intention was to put the plank away; that is complete. You can see the open door. Choose what to do next. Do not repeat a completed transfer.',
  'You are Nadia, an adult grower. You are beside Amara outdoors by the well. Yesterday you promised to help harvest tomorrow. She has just asked whether you will still come. Your hands are empty. You feel rested and fed. You can speak, make a plan, decline or change your mind. Choose your response.',
  'You are Yusuf, an adult builder. You are inside your own house. It is evening. You are tired, your hunger is satisfied and your hearth is cold. There is no wood in your hands. You may sleep here. Choose what you do now.',
]
type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}
type Packet = {
  id?: string
  model?: string
  provider?: string
  error?: unknown
  usage?: Usage
  choices?: {
    finish_reason?: string | null
    message?: { content?: string }
    delta?: { content?: string; reasoning?: string }
  }[]
}
const results: unknown[] = []
for (let i = 0; i < prompts.length; i++) {
  for (const stream of i % 2 === 0 ? [false, true] : [true, false]) {
    const reservation = guard.reserve(0.25, 2, null)
    if (!('id' in reservation)) throw new Error('Probe budget exhausted')
    const started = performance.now()
    let firstTextMs: number | null = null
    let firstReasoningMs: number | null = null
    let content = ''
    let final: Packet = {}
    let usage: Usage | undefined
    let finish: string | null = null
    let settled = false
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MIND_MODEL,
          provider: { only: ['openai'], allow_fallbacks: false },
          reasoning: { effort: 'low' },
          max_tokens: 4096,
          stream,
          usage: { include: true },
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'resident_turn', strict: true, schema },
          },
          messages: [
            { role: 'system', content: `${RULES_OF_BEING}\n${CAPABILITIES}\n${SPEECH_RULES}` },
            { role: 'user', content: prompts[i] },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok) {
        if ([400, 401, 402, 403, 404, 429].includes(response.status)) guard.release(reservation.id)
        else guard.retainUncertain(reservation.id)
        settled = true
        throw new Error(`Provider HTTP ${response.status}`)
      }
      if (stream) {
        if (!response.body) throw new Error('Missing stream')
        const decoder = new TextDecoder()
        let buffer = ''
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let newline: number
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (!line.startsWith('data:') || line === 'data: [DONE]') continue
            const packet = JSON.parse(line.slice(5)) as Packet
            if (packet.error) throw new Error('Provider stream failed')
            final = { ...final, ...packet }
            usage = packet.usage ?? usage
            const choice = packet.choices?.[0]
            finish = choice?.finish_reason ?? finish
            if (choice?.delta?.reasoning && firstReasoningMs === null)
              firstReasoningMs = performance.now() - started
            if (choice?.delta?.content) {
              firstTextMs ??= performance.now() - started
              content += choice.delta.content
            }
          }
        }
      } else {
        final = (await response.json()) as Packet
        usage = final.usage
        content = final.choices?.[0]?.message?.content ?? ''
        finish = final.choices?.[0]?.finish_reason ?? null
        if (content) firstTextMs = performance.now() - started
      }
      const completeMs = performance.now() - started
      let valid = false
      try {
        valid = StrictTurnSchema.safeParse(JSON.parse(content)).success
      } catch {
        /* incomplete output */
      }
      if (!usage) throw new Error('No final usage; charge remains uncertain')
      const input = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
      const estimated = computeCostUsd(
        input,
        outputTokens,
        cached,
        final.model,
        final.provider,
      ).costUsd
      const reported = typeof usage.cost === 'number' ? usage.cost : null
      guard.reconcile(reservation.id, {
        caller: 'streaming-probe',
        agentId: null,
        model: final.model ?? MIND_MODEL,
        provider: final.provider ?? null,
        inputTokens: input,
        outputTokens,
        cacheReadTokens: cached,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        costUsd: reported ?? estimated,
        estimatedCostUsd: estimated,
        reportedCostUsd: reported,
        latencyMs: completeMs,
        ok: valid,
        error: valid ? null : 'invalid complete turn',
        generationId: final.id ?? null,
        finishReason: finish,
      })
      settled = true
      const result = {
        fixture: i,
        stream,
        firstTextMs,
        firstReasoningMs,
        completeMs,
        valid,
        input,
        outputTokens,
        reportedCostUsd: reported,
        finish,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    } catch (error) {
      if (!settled) guard.retainUncertain(reservation.id)
      results.push({
        fixture: i,
        stream,
        error: error instanceof Error ? error.message : 'probe failure',
      })
      console.log(JSON.stringify(results.at(-1)))
    }
    writeFileSync(
      join(output, 'results.json'),
      JSON.stringify(
        { model: MIND_MODEL, results, spent: sumCostUsd(db), reserved: sumReserved(db) },
        null,
        2,
      ),
    )
  }
}
db.close()
