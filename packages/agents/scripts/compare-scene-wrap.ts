import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { z } from 'zod'
import {
  LlmClient,
  configureSpendLimits,
  migrateLlmTables,
  sumCostUsd,
  sumReserved,
  MIND_MODEL,
  FALLBACK_MODELS,
} from '@sj/llm'
import { VERBS } from '@sj/engine'
import { sanitizeSpokenText } from '@sj/shared'
import { FOUNDER_MINDS } from '../src/live/founderMinds.js'
import { SceneTurnSchema, StrictSceneTurnSchema } from '../src/scene/scene.js'
import { fromClosed } from '../src/turn.js'
import { SCENE_ANSWER } from '../src/scene/sceneLlm.js'
import { RULES_OF_BEING, CAPABILITIES, SPEECH_RULES } from '../src/prompt/rulesOfBeing.js'

const [fixturePath, output] = process.argv.slice(2)
if (!fixturePath || !output || !process.env.OPENROUTER_API_KEY)
  throw new Error('Fixture, new output directory and provider credential required')
if (MIND_MODEL !== 'openai/gpt-5.6-luna' || FALLBACK_MODELS.length)
  throw new Error('Probe requires the reviewed Luna route without model fallbacks')
if (existsSync(output)) throw new Error('Use a new output directory')
const fixture = z
  .object({
    limitations: z.array(z.string()),
    publicLastLines: z.array(
      z.object({
        agentId: z.enum(['halim', 'dilara']),
        text: z.string(),
        tick: z.number().int().nonnegative(),
      }),
    ),
    physicalSnapshot: z.object({
      agent: z.object({
        id: z.literal('halim'),
        x: z.number().int(),
        y: z.number().int(),
        insideId: z.literal('structure_cottage_59_44'),
        alive: z.literal(true),
        asleep: z.literal(false),
        hp: z.literal(100),
        injuries: z.array(z.never()),
        activity: z.null(),
      }),
      room: z.object({
        id: z.literal('structure_cottage_59_44'),
        kind: z.literal('cottage'),
        hp: z.number().nonnegative(),
        maxHp: z.number().positive(),
      }),
      heldItems: z.array(z.never()),
    }),
    baselineFinalCue: z.string(),
    variantFinalCue: z.string(),
  })
  .parse(JSON.parse(readFileSync(fixturePath, 'utf8')))
const { agent, room } = fixture.physicalSnapshot
const names = { halim: 'Halim', dilara: 'Dilara' }
const identity = FOUNDER_MINDS.find((mind) => mind.id === agent.id)!.identity
const system = [
  RULES_OF_BEING,
  CAPABILITIES,
  SPEECH_RULES,
  SCENE_ANSWER,
  `Your identity: ${JSON.stringify(identity)}`,
].join('\n\n')
const common = [
  `You are inside the cottage (${room.id}) at (${agent.x}, ${agent.y}). You are awake, healthy, and not doing a physical action. Dilara is talking with you. No inspection finding has been recorded.`,
  `Your hands are empty. The cottage's recorded health is ${room.hp}/${room.maxHp}. Your previous plan is unknown; null preserves it. Only Halim and Dilara are in this conversation.`,
  'What has been said, oldest first (quoted dialogue):',
  ...fixture.publicLastLines.map(
    (line) => `${names[line.agentId]}: ${JSON.stringify(sanitizeSpokenText(line.text))}`,
  ),
  "It is Halim's turn. No invitation or tabled proposal is pending. About 22 words is normal for you.",
].join('\n')
const limitations = [
  ...fixture.limitations,
  'Reduced reconstructed prompt: not the production personality, ties, recent speech or sceneBlock assembly.',
  'Both arms use low reasoning and a 7500-token cap; this is not a production scene latency benchmark.',
  'Reference checks use the supplied cottage, two participants and empty inventory. Full physical validation/execution is not performed.',
  'Inspection or completed-work claims in the full answer need human review against the recorded lack of inspection evidence.',
]
mkdirSync(output, { recursive: true })
writeFileSync(
  join(output, 'requests.json'),
  JSON.stringify(
    {
      system,
      common,
      fixture,
      limitations,
      ceilingUsd: 2,
      pairs: 3,
      model: MIND_MODEL,
      providerOrder: ['openai'],
      maxRetries: 0,
      maxOutputTokens: 7500,
    },
    null,
    2,
  ),
)
const db = new Database(join(output, 'ops.db'))
const results: unknown[] = []
try {
  migrateLlmTables(db)
  configureSpendLimits(db, { lifetimeUsd: 2, rollingDayUsd: 2 })
  for (let pair = 0; pair < 3; pair++) {
    for (const variant of pair % 2 ? ['revised', 'baseline'] : ['baseline', 'revised']) {
      const client = new LlmClient({
        db,
        caller: 'scene.wrap-probe',
        agentId: 'halim',
        providerOrder: ['openai'],
        allowProviderFallbacks: false,
        maxRetries: 0,
        reasoning: { effort: 'low' },
        maxOutputTokens: 7500,
        requestTimeoutMs: 90_000,
        maxQueueWaitMs: 5000,
      })
      const before = sumCostUsd(db)
      const beforeCallId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM llm_calls').get() as { id: number }
      ).id
      const beforeAlertId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM alerts').get() as { id: number }
      ).id
      const start = performance.now()
      let answer: z.infer<typeof StrictSceneTurnSchema> | null = null
      let error: string | null = null
      try {
        answer = (
          await client.object({
            system,
            messages: [
              {
                role: 'user',
                content: `${common}\n${variant === 'baseline' ? fixture.baselineFinalCue : fixture.variantFinalCue}`,
              },
            ],
            schema: StrictSceneTurnSchema,
          })
        ).value
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      } finally {
        client.abort()
      }
      const referenceErrors: string[] = []
      if (answer !== null) {
        if (answer.to !== null && !['halim', 'dilara'].includes(answer.to.trim().toLowerCase()))
          referenceErrors.push('to names someone outside the two participants')
        if (answer.reconvene !== null) referenceErrors.push('reconvene names an absent proposal')
        for (const [index, step] of (answer.plan ?? []).entries()) {
          for (const key of ['itemId', 'cropId', 'nodeId', 'faunaId'] as const)
            if (step.params[key] !== null)
              referenceErrors.push(`plan[${index}].${key} is not supplied by the fixture`)
          if (step.params.structureId !== null && step.params.structureId !== room.id)
            referenceErrors.push(`plan[${index}].structureId is not the supplied cottage`)
          if (step.params.targetId !== null && !['halim', 'dilara'].includes(step.params.targetId))
            referenceErrors.push(`plan[${index}].targetId is not a supplied participant`)
        }
      }
      const repaired =
        db
          .prepare("SELECT id FROM alerts WHERE id > ? AND kind = 'decode_repaired' LIMIT 1")
          .get(beforeAlertId) !== undefined
      const calls = db
        .prepare(`SELECT id, model, provider, input_tokens, output_tokens,
        reasoning_tokens, cost_usd, ok, error, finish_reason FROM llm_calls WHERE id > ? ORDER BY id`)
        .all(beforeCallId)
      const result = {
        pair,
        variant,
        latencyMs: Math.round(performance.now() - start),
        costUsd: sumCostUsd(db) - before,
        schemaValid: answer !== null,
        decodeRepaired: repaired,
        runtimeShapeValid:
          answer === null ? false : SceneTurnSchema.safeParse(fromClosed(answer)).success,
        answer,
        leave: answer?.leave ?? null,
        speech: answer?.speech ?? null,
        plan: answer?.plan ?? null,
        knownPhysicalVerbs: answer?.plan?.every((step) => VERBS[step.verb] !== undefined) ?? null,
        referencesValid: answer === null ? null : referenceErrors.length === 0,
        referenceErrors,
        calls,
        error,
      }
      results.push(result)
      writeFileSync(
        join(output, 'results.json'),
        JSON.stringify(
          { results, spentUsd: sumCostUsd(db), reservedUsd: sumReserved(db), limitations },
          null,
          2,
        ),
      )
      console.log(JSON.stringify(result))
    }
  }
} finally {
  db.close()
}
