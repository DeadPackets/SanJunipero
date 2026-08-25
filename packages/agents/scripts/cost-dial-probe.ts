// COST DIAL PROBE — the cheapest possible answer to "does the dial do anything".
//
// `llm/pins.ts` pins a reasoning model and `PROVIDER_ORDER=['Wafer']`; the OpenRouter catalogue
// says both the model and that endpoint accept `reasoning_effort`. Nothing in the codebase has
// ever sent one. Before any world run spends real money on a ladder, this asks the provider
// directly: for each rung, how many of the output tokens are reasoning, and who served it.
//
// One fixed structured ask, repeated per rung. No world, no minds, no memory.
import { generateText, Output } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { MIND_MODEL, PROVIDER_ORDER, FALLBACK_MODELS } from '../src/llm/pins.js'

const CAP_USD = 0.5
const REPS = Number(process.env.DIAL_REPS ?? 3)

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })

// A turn-shaped ask: pick one verb from a short list and say why in a few words.
const SYSTEM = [
  'You are Omar, 54, a wheelwright. It is 21:40 and the square is dark and cold.',
  'You are standing by the fire pit. You have 12 wood and 4 bread.',
  'Choose exactly one thing to do now.',
].join('\n')
const USER = 'You can: walk, build, stoke, kindle, talk, eat, sleep, wait. Choose one and give a short reason.'
const SCHEMA = z.object({ verb: z.string().min(1), reason: z.string().min(1) }).strict()

// The rungs. `reasoning:{enabled:false}` is OpenRouter's off switch; effort levels are its
// three named rungs. `null` is the control: exactly what the code sends today.
const RUNGS: Array<{ name: string; reasoning: unknown }> = [
  { name: 'unset (today)', reasoning: null },
  { name: 'off', reasoning: { enabled: false } },
  { name: 'minimal', reasoning: { effort: 'minimal' } },
  { name: 'low', reasoning: { effort: 'low' } },
  { name: 'medium', reasoning: { effort: 'medium' } },
  { name: 'high', reasoning: { effort: 'high' } },
]

let spent = 0
type Row = { rung: string; rep: number; provider: string; served: string; inTok: number; outTok: number; reasonTok: number; ok: boolean; note: string }
const rows: Row[] = []

for (const rung of RUNGS) {
  for (let rep = 0; rep < REPS; rep++) {
    const extraBody: Record<string, unknown> = {
      models: [MIND_MODEL, ...FALLBACK_MODELS],
      provider: { order: PROVIDER_ORDER, allow_fallbacks: true },
    }
    if (rung.reasoning !== null) extraBody['reasoning'] = rung.reasoning
    try {
      const r = await generateText({
        model: openrouter(MIND_MODEL, { extraBody }),
        system: SYSTEM,
        // A distinct suffix per rep so no rung is answered out of the prompt cache.
        messages: [{ role: 'user', content: `${USER} (ask ${rung.name} #${rep})` }],
        maxRetries: 0,
        output: Output.object({ schema: SCHEMA }),
      })
      const u = r.usage
      const inTok = u.inputTokens ?? 0
      const outTok = u.outputTokens ?? 0
      const reasonTok = u.outputTokenDetails?.reasoningTokens ?? 0
      spent += ((inTok * 0.28) + (outTok * 0.56)) / 1e6
      rows.push({
        rung: rung.name, rep, ok: true,
        provider: String((r.providerMetadata as any)?.openrouter?.provider ?? 'unknown'),
        served: String(r.response?.modelId ?? '?'),
        inTok, outTok, reasonTok,
        note: JSON.stringify(r.output).slice(0, 60),
      })
    } catch (err) {
      rows.push({
        rung: rung.name, rep, ok: false, provider: '-', served: '-',
        inTok: 0, outTok: 0, reasonTok: 0,
        note: (err instanceof Error ? err.message : String(err)).slice(0, 140),
      })
    }
    if (spent > CAP_USD) { console.error('DIAL PROBE CAP HIT'); break }
  }
}

for (const r of rows) {
  console.log(
    `${r.ok ? 'OK ' : 'ERR'} rung=${r.rung.padEnd(14)} rep=${r.rep} prov=${String(r.provider).padEnd(12)} served=${r.served} in=${r.inTok} out=${r.outTok} reasoning=${r.reasonTok} :: ${r.note}`,
  )
}
console.log(`\nspend at Wafer prices (0.28/0.56 per M) = $${spent.toFixed(6)}`)
