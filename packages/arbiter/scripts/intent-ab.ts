// Does giving the god the mind's own words change the verdict? Two arms over the SAME intents,
// each with its own empty `_arbiter.db` so neither can read the other's precedent:
//   A  `flattenIntent` — the verb as an underscored token, no thought at all.
//   B  `humanizeIntent` plus `AgentCtx.saying` — the sentence the mind actually wrote.
// Counted per arm: intents reaching a CLASSED verdict rather than `FALLBACK_IMPOSSIBLE`, and
// how many attempts would CODIFY.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Embedder, LlmClient, migrateLlmTables } from '@sj/agents'
import { openDb } from '@sj/engine'
import { CodexStore, GENESIS_CODEX, makeArbiter, openArbiterDb } from '../src/index.js'
import { FALLBACK_IMPOSSIBLE } from '../src/adjudicate.js'

const CAP_USD = 1.5
const OUT = process.env['SJ_OUT'] ?? '/tmp/intent-ab.json'
// Each arm opens its own EMPTY `_arbiter.db`, so an arm is self-contained and can be run and
// scored on its own. `SJ_ARM=after` re-runs one half instead of re-spending on both — which is
// what the first attempt needed after a watchdog killed it with the before arm complete.
const ARM = process.env['SJ_ARM'] ?? null
const MODELS_DIR =
  process.env['SJ_MODELS_DIR'] ?? fileURLToPath(new URL('../../../data/models/', import.meta.url))

const VOCABULARY = {
  itemKinds: [
    'wood',
    'stone',
    'rope',
    'cloth',
    'fiber',
    'hide',
    'clay',
    'axe',
    'hoe',
    'knife',
    'seed_pouch',
    'waterskin',
    'bucket',
    'torch',
    'garment',
    'plank',
    'bread',
    'wheat',
    'fish',
    'venison',
    'rabbit_meat',
    'berries',
    'mushroom',
    'herb',
    'stew',
  ],
  structureKinds: ['house', 'storehouse', 'shed', 'wagon', 'well', 'fire_pit', 'bridge', 'grave'],
} as const

// Seven invented verbs a mind reached for, each with the thought behind it — an act the engine
// has no verb for. Fixed order and cast, so the two arms differ in exactly one thing.
const SEED: Array<{ verb: string; params: Record<string, unknown>; thought: string }> = [
  {
    verb: 'smoke_fish',
    params: { over: 'green wood' },
    thought: 'Four fish. They will spoil unless I smoke them.',
  },
  {
    verb: 'dry_fish',
    params: { on: 'the flat rocks' },
    thought:
      'The catch will not see the week out. Sun and wind might hold it if the flies keep off.',
  },
  {
    verb: 'salt_meat',
    params: { with: 'river salt' },
    thought: 'The venison turns fast in this heat. Salt keeps it, if I can gather enough of it.',
  },
  {
    verb: 'raise_marker',
    params: { at: 'the river fork' },
    thought: 'Where the two waters meet ought to be marked, so a stranger coming down knows it.',
  },
  {
    verb: 'weave_basket',
    params: { from: 'reeds' },
    thought: 'I drop half the berries on the walk back. I want something to carry them in.',
  },
  {
    verb: 'bank_fire',
    params: { with: 'river clay' },
    thought:
      'The fire dies every night and I start it again cold. If I pack the coals they may hold till dawn.',
  },
  {
    verb: 'tan_hide',
    params: { with: 'oak bark' },
    thought: 'The hide stiffens and cracks after a week. There must be a way to keep it soft.',
  },
]

const AGENT = {
  agentId: 'amara',
  name: 'Amara',
  skills: { cooking: 2, foraging: 3, building: 1 },
  inventory: [
    { kind: 'fish', qty: 4 },
    { kind: 'wood', qty: 6 },
    { kind: 'hide', qty: 1 },
  ],
  position: { x: 12, y: 9 },
  visible: {
    structures: [
      { kind: 'storehouse', x: 13, y: 9 },
      { kind: 'fire_pit', x: 11, y: 10 },
    ],
    ground: ['grass', 'dirt', 'water'],
  },
}

// The two renderings under test, side by side so the difference is one line each.
const flattenIntent = (verb: string, params: Record<string, unknown>): string =>
  [
    verb,
    ...Object.keys(params)
      .sort()
      .map((k) => String(params[k])),
  ].join(' ')
const humanizeIntent = (verb: string, params: Record<string, unknown>): string =>
  [
    verb.replace(/_/g, ' '),
    ...Object.keys(params)
      .sort()
      .map((k) => String(params[k])),
  ].join(' ')

type Result = {
  intent: string
  kind: string
  class?: string
  recipe?: string
  fallback: boolean
  codified: boolean
}

async function runArm(
  arm: 'before' | 'after',
  llm: LlmClient,
  embedder: { embed(t: string): Promise<Float32Array> },
): Promise<Result[]> {
  const dir = mkdtempSync(join(tmpdir(), `intent-ab-${arm}-`))
  const db = openArbiterDb(join(dir, '_arbiter.db'))
  const codex = new CodexStore(db)
  for (const entry of GENESIS_CODEX) codex.insert(entry)
  const arbiter = makeArbiter({ db, llm, embedder, tick: () => 1000, vocabulary: VOCABULARY })

  const out: Result[] = []
  for (const s of SEED) {
    const intent =
      arm === 'before' ? flattenIntent(s.verb, s.params) : humanizeIntent(s.verb, s.params)
    const ctx = arm === 'before' ? AGENT : { ...AGENT, saying: s.thought }
    const v = await arbiter.adjudicate(intent, ctx)
    const fallback = v.kind === 'impossible' && v.reason === FALLBACK_IMPOSSIBLE.reason
    let codified = false
    if (v.kind === 'attempt') {
      // The only honest measure of "would codify": run the same call the runtime runs.
      try {
        arbiter.codify(v.recipe as never, { agentId: AGENT.agentId, intent })
        codified = true
      } catch {
        codified = false
      }
    }
    out.push({
      intent,
      kind: v.kind,
      ...(v.kind === 'impossible' ? { class: v.class } : {}),
      ...(v.kind === 'attempt' ? { recipe: v.recipe.id } : {}),
      fallback,
      codified,
    })
    const tail =
      v.kind === 'impossible'
        ? `${v.class} — ${v.reason}`
        : v.kind === 'attempt'
          ? v.recipe.id
          : v.verb
    console.log(
      `  [${arm}] ${intent.padEnd(34)} ${v.kind.padEnd(10)} ${fallback ? 'FALLBACK ' : ''}${tail}`,
    )
  }
  db.close()
  return out
}

async function main(): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']) {
    console.error('needs OPENROUTER_API_KEY — run with node --env-file=<repo>/.env')
    process.exit(1)
  }
  const ledger = openDb(':memory:')
  migrateLlmTables(ledger)
  const llm = new LlmClient({ db: ledger, caller: 'arbiter', budgetUsd: CAP_USD })
  const embedder = await Embedder.create(MODELS_DIR)

  console.log(`SEED: ${SEED.length} invented verbs, fixed order, one cast\n`)
  const before = ARM === 'after' ? [] : await runArm('before', llm, embedder)
  const beforeUsd = llm.totalCostUsd()
  console.log('')
  const after = ARM === 'before' ? [] : await runArm('after', llm, embedder)

  const tally = (rs: Result[]) => ({
    classed: rs.filter((r) => !r.fallback).length,
    fallback: rs.filter((r) => r.fallback).length,
    attempt: rs.filter((r) => r.kind === 'attempt').length,
    map: rs.filter((r) => r.kind === 'map').length,
    codified: rs.filter((r) => r.codified).length,
  })
  const b = tally(before)
  const a = tally(after)
  console.log(`\n            classed  fallback  attempt  map  codified   (of ${SEED.length})`)
  console.log(
    `  BEFORE      ${b.classed}        ${b.fallback}        ${b.attempt}       ${b.map}     ${b.codified}`,
  )
  console.log(
    `  AFTER       ${a.classed}        ${a.fallback}        ${a.attempt}       ${a.map}     ${a.codified}`,
  )
  console.log(
    `\nbefore arm $${beforeUsd.toFixed(6)}  ·  after arm $${(llm.totalCostUsd() - beforeUsd).toFixed(6)}` +
      `  ·  total $${llm.totalCostUsd().toFixed(6)}`,
  )
  writeFileSync(
    OUT,
    JSON.stringify({ seed: SEED, before, after, tally: { before: b, after: a } }, null, 2),
  )
  console.log(`-> ${OUT}`)
}

void main()
