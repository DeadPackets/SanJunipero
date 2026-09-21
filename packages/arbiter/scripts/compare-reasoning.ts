import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { z } from 'zod'
import {
  LlmClient,
  MIND_MODEL,
  configureSpendLimits,
  migrateLlmTables,
  sumCostUsd,
  sumReserved,
  type LlmClientOpts,
} from '@sj/llm'
import { callSettingsFor } from '../../llm/src/pins.js'
import { VERBS } from '@sj/engine'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import {
  assembleAdjudicationPrompt,
  CANON,
  GENESIS_CODEX,
  readRuling,
  recipeSanityRefusal,
  StrictVerdictSchema,
  VerdictSchema,
  type AgentCtx,
  type Verdict,
} from '../src/index.js'

const FixtureSchema = z
  .object({ tick: z.number().int(), intent_text: z.string(), verdict_json: z.string() })
  .strict()
const RecordedFixtures = z.array(FixtureSchema).length(3)
const known = GENESIS_CODEX.filter((entry) => entry.known !== false).map((entry) => entry.id)
const frontier = GENESIS_CODEX.filter(
  (entry) =>
    entry.known === false && entry.prerequisiteId !== null && known.includes(entry.prerequisiteId),
).map((entry) => entry.id)
const materials = { itemKinds: ['wood', 'plank'], structureKinds: ['house', 'bridge'] }
const settings = callSettingsFor('arbiter')

type PreparedCase = {
  tick: number
  kind: 'wood' | 'bridge'
  intent: string
  context: AgentCtx
  assumptions: string[]
  observed: Verdict
  prompt: ReturnType<typeof assembleAdjudicationPrompt>
  promptSha256: string
}

export function prepareCases(input: unknown): PreparedCase[] {
  return RecordedFixtures.parse(input).map((fixture) => {
    if (![783, 606, 469].includes(fixture.tick))
      throw new Error('Only the three recorded F1 cases are admitted')
    const kind = fixture.tick === 606 ? 'bridge' : 'wood'
    const context: AgentCtx = {
      agentId: kind === 'bridge' ? 'halim' : 'amara',
      name: kind === 'bridge' ? 'Halim' : 'Amara',
      skills: {},
      inventory:
        kind === 'bridge'
          ? [{ id: 'fixture_plank', kind: 'plank', qty: 1 }]
          : [{ id: 'fixture_wood', kind: 'wood', qty: 10 }],
      position: { x: 1, y: 1 },
      people: [],
      visible: {
        structures: [
          {
            id: kind === 'bridge' ? 'fixture_bridge' : 'fixture_house',
            kind: kind === 'bridge' ? 'bridge' : 'house',
            x: 2,
            y: 1,
          },
        ],
        ground: ['grass'],
      },
    }
    const prompt = assembleAdjudicationPrompt({
      canon: `${CANON}\n\nThe town currently knows: ${known.join(', ')}`,
      frontier,
      agent: context,
      precedent: [],
      learned: [],
      materials,
      intent: fixture.intent_text,
    })
    return {
      tick: fixture.tick,
      kind,
      intent: fixture.intent_text,
      context,
      assumptions: [
        'Original full AgentCtx was not recorded; these are reconstructed local contexts, not production replay.',
        'Inventory counts and nearby building kinds come from the recorded request/ruling; IDs, coordinates and grass are fixture-only.',
        'Skills, other people, learned rules and precedents are unknown and omitted; materials are restricted to wood/plank and house/bridge.',
        ...(kind === 'bridge'
          ? [
              'Claimed bridge damage is unverified; no hit-point change or repair capability is assumed.',
            ]
          : []),
      ],
      observed: VerdictSchema.parse(JSON.parse(fixture.verdict_json)),
      prompt,
      promptSha256: createHash('sha256').update(JSON.stringify(prompt)).digest('hex'),
    }
  })
}

export function semanticOutcome(fixture: PreparedCase, verdict: Verdict) {
  const items = new Set(fixture.context.inventory.map((item) => item.id))
  const structures = new Set(fixture.context.visible?.structures.map((structure) => structure.id))
  const params = verdict.kind === 'map' ? verdict.params : null
  const referencesValid =
    params === null ||
    ((params.itemId === null || items.has(params.itemId)) &&
      (params.structureId === null || structures.has(params.structureId)) &&
      params.targetId === null)
  const mappedVerbExists = verdict.kind === 'map' ? VERBS[verdict.verb] !== undefined : null
  const routineStockTransfer =
    fixture.kind === 'wood' &&
    verdict.kind === 'map' &&
    referencesValid &&
    params?.itemId === 'fixture_wood' &&
    (verdict.verb === 'drop' || (verdict.verb === 'stow' && params.structureId === 'fixture_house'))
  const effects =
    verdict.kind === 'attempt'
      ? verdict.recipe.outcomeTable.filter((row) => row.success).flatMap((row) => row.effects)
      : []
  const heldKinds = new Set(fixture.context.inventory.map((item) => item.kind))
  const spawnsHeldMaterial = effects.some(
    (effect) => effect.op === 'spawn_item' && heldKinds.has(effect.kind),
  )
  const cosmeticRepair =
    fixture.kind === 'bridge' &&
    effects.some((effect) => effect.op === 'mark' && effect.on === 'structure') &&
    effects.every((effect) => ['mark', 'gain_skill', 'none', 'witness'].includes(effect.op))
  const sanityRefusal =
    verdict.kind === 'attempt'
      ? recipeSanityRefusal(verdict.recipe, {
          itemKinds: new Set(materials.itemKinds),
          structureKinds: new Set(materials.structureKinds),
          tileKinds: new Set(['grass']),
        })
      : null
  const canonWithinReach =
    verdict.kind === 'attempt'
      ? verdict.recipe.canon.every((id) => known.includes(id) || frontier.includes(id))
      : null
  const framingLeak =
    verdict.kind === 'attempt' &&
    [
      verdict.summary,
      verdict.recipe.name,
      ...verdict.recipe.outcomeTable.map((row) => row.label),
    ].some((text) => FORBIDDEN_FRAMING.test(text))
  const outcome =
    fixture.kind === 'wood'
      ? routineStockTransfer
        ? 'existing-stock-transfer'
        : spawnsHeldMaterial
          ? 'replacement-stock-invention'
          : verdict.kind === 'attempt'
            ? 'unnecessary-invention'
            : 'unresolved-routine'
      : cosmeticRepair
        ? 'cosmetic-repair-only'
        : verdict.kind === 'impossible'
          ? 'repair-refused'
          : 'unresolved-physical-repair'
  return {
    outcome,
    routineStockTransfer,
    spawnsHeldMaterial,
    changesBridgePhysics: fixture.kind === 'bridge' ? false : null,
    mappedVerbExists,
    referencesValid,
    sanityRefusal,
    canonWithinReach,
    framingLeak,
  }
}

type ComparisonResult = {
  tick: number
  variant: 'current' | 'low'
  reasoning: LlmClientOpts['reasoning']
  promptSha256: string
  latencyMs: number
  costUsd: number
  schemaValid: boolean
  decodeRepaired: boolean
  verdict: Verdict | null
  semantic: ReturnType<typeof semanticOutcome> | null
  changedFromObserved: boolean | null
  calls: unknown[]
  error: string | null
}

export async function runComparison(
  cases: PreparedCase[],
  db: Database.Database,
  createClient: (opts: LlmClientOpts) => LlmClient = (opts) => new LlmClient(opts),
  onResult?: (results: ComparisonResult[]) => void,
): Promise<ComparisonResult[]> {
  if (cases.length !== 3) throw new Error('Exactly three recorded cases required')
  if (settings.model !== undefined && settings.model !== MIND_MODEL)
    throw new Error('Arbiter model differs from default; review comparison routing')
  migrateLlmTables(db)
  configureSpendLimits(db, { lifetimeUsd: 2, rollingDayUsd: 2 })
  const results: ComparisonResult[] = []
  for (const [index, fixture] of cases.entries()) {
    const variants = index % 2 === 0 ? (['current', 'low'] as const) : (['low', 'current'] as const)
    for (const variant of variants) {
      const reasoning =
        variant === 'current' ? (settings.reasoning ?? null) : { effort: 'low' as const }
      // Separate caller prevents the live arbiter's runaway fallback from silently buying a second pass.
      const client = createClient({
        db,
        caller: 'arbiter.compare',
        agentId: fixture.context.agentId,
        reasoning,
        maxOutputTokens: settings.maxOutputTokens ?? 20_000,
        providerOrder: ['openai'],
        allowProviderFallbacks: false,
        maxRetries: 0,
        requestTimeoutMs: 90_000,
        maxQueueWaitMs: 5_000,
      })
      const before = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM llm_calls').get() as {
        id: number
      }
      const alertBefore = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM alerts').get() as {
        id: number
      }
      const costBefore = sumCostUsd(db)
      const started = performance.now()
      let verdict: Verdict | null = null
      let error: string | null = null
      try {
        const answer = await client.object({ ...fixture.prompt, schema: StrictVerdictSchema })
        verdict = readRuling(answer.value)
      } catch (caught) {
        error = caught instanceof Error ? caught.message.slice(0, 1000) : 'Comparison failed'
      }
      const result: ComparisonResult = {
        tick: fixture.tick,
        variant,
        reasoning,
        promptSha256: fixture.promptSha256,
        latencyMs: Math.round((performance.now() - started) * 100) / 100,
        costUsd: sumCostUsd(db) - costBefore,
        schemaValid: verdict !== null,
        decodeRepaired:
          db
            .prepare("SELECT 1 FROM alerts WHERE id > ? AND kind = 'decode_repaired' LIMIT 1")
            .get(alertBefore.id) !== undefined,
        verdict,
        semantic: verdict === null ? null : semanticOutcome(fixture, verdict),
        changedFromObserved:
          verdict === null ? null : JSON.stringify(verdict) !== JSON.stringify(fixture.observed),
        calls: db
          .prepare(
            'SELECT id, model, provider, input_tokens, output_tokens, reasoning_tokens, cost_usd, reported_cost_usd, estimated_cost_usd, finish_reason, ok FROM llm_calls WHERE id > ? ORDER BY id',
          )
          .all(before.id),
        error,
      }
      results.push(result)
      onResult?.(results)
      client.abort()
    }
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [fixturePath, output, flag] = process.argv.slice(2)
  if (!fixturePath || !output || (flag !== undefined && flag !== '--run'))
    throw new Error(
      'Usage: compare-reasoning.ts FIXTURES_JSON OUTPUT_DIR [--run]; default prepares only',
    )
  if (existsSync(join(output, 'ops.db')) || existsSync(join(output, 'results.json')))
    throw new Error('Use an output directory with no previous paid comparison')
  const cases = prepareCases(JSON.parse(readFileSync(fixturePath, 'utf8')))
  mkdirSync(output, { recursive: true })
  writeFileSync(
    join(output, 'requests.json'),
    JSON.stringify(
      {
        model: MIND_MODEL,
        currentReasoning: settings.reasoning,
        comparedReasoning: { effort: 'low' },
        maxLogicalRequests: 6,
        maxOutputTokens: settings.maxOutputTokens,
        timeoutMs: 90_000,
        capUsd: 2,
        providerOrder: ['openai'],
        schema: z.toJSONSchema(StrictVerdictSchema),
        measurement:
          'One schema pass per variant, with no cache lookup, codification, semantic retry, or model-setting change. Local decoding repair is recorded.',
        bridgeLimit:
          'The current effect schema has no physical structure-repair operation; a repaired marker does not restore a bridge.',
        cases: cases.map((fixture) => ({
          ...fixture,
          observedSemantic: semanticOutcome(fixture, fixture.observed),
        })),
      },
      null,
      2,
    ),
  )
  if (flag === '--run') {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('Provider credential required for --run')
    const db = new Database(join(output, 'ops.db'))
    try {
      await runComparison(cases, db, undefined, (results) => {
        writeFileSync(
          join(output, 'results.json'),
          JSON.stringify(
            {
              model: MIND_MODEL,
              results,
              spentUsd: sumCostUsd(db),
              reservedUsd: sumReserved(db),
              defaultSettingsChanged: false,
            },
            null,
            2,
          ),
        )
        const last = results.at(-1)
        console.log(
          JSON.stringify({
            tick: last?.tick,
            variant: last?.variant,
            latencyMs: last?.latencyMs,
            schemaValid: last?.schemaValid,
            semantic: last?.semantic,
            costUsd: last?.costUsd,
          }),
        )
      })
    } finally {
      db.close()
    }
  } else console.log(`Prepared six requests at ${join(output, 'requests.json')}; paid requests: 0`)
}
