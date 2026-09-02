import { openDb } from '@sj/engine/store'
import { LlmClient, migrateLlmTables, MIND_MODEL } from '@sj/llm'
import { z } from 'zod'
import { ClosedIntentParams } from '@sj/shared'

// The never-changing canon block, repeated to ~1.5k tokens so DeepSeek's
// prefix cache stays warm across adjudications (byte-stable across calls).
const CANON = (
  'The town of San Junipero sits where two branches of a river meet, in a wide valley of field and forest. ' +
  'There is no factory within reach, no yard that pours metal, and nothing arrives from outside. ' +
  'People have fire, current from a generator, wood, fiber, stone, what the sheds hold, and the river. '
).repeat(29)

// Operator-facing adjudication instruction (Task 4's "system = CANON + instruction"
// shape). Without it the bare lore prompt makes the model default to 'impossible'.
const SYSTEM =
  CANON +
  '\n\n' +
  'You are the physics arbiter of San Junipero. An agent proposes an action. Reply with one verdict: ' +
  '"map" only if the town already performs this exact action as a routine; ' +
  '"attempt" if the action is new but the agent can physically try it with the town\'s fire, current, wood, fiber, stone, the stock and scrap its sheds already hold, and the river — whether it succeeds is decided later, never by you; ' +
  '"impossible" only if the action cannot even be started because it needs something the town wholly lacks.'

const CAP_USD = 5.0
const db = openDb(':memory:')
migrateLlmTables(db)
const llm = new LlmClient({ db, caller: 'probe', budgetUsd: CAP_USD })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function budget(): void {
  const total = llm.totalCostUsd()
  if (total > CAP_USD) {
    console.error(`BUDGET CAP EXCEEDED: $${total.toFixed(4)} > $${CAP_USD.toFixed(2)}`)
    process.exit(1)
  }
}

const VerdictProbe = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('map'), verb: z.string(), params: ClosedIntentParams })
    .strict()
    .describe('The town already performs this exact action as a routine verb.'),
  z
    .object({
      kind: z.literal('attempt'),
      recipeId: z
        .string()
        .describe(
          'a short stable slug for this recipe, lowercase with underscores, e.g. "extract_salt_by_boiling"',
        ),
      summary: z.string(),
    })
    .strict()
    .describe("A new action the agent can physically attempt with the town's materials."),
  z
    .object({ kind: z.literal('impossible'), reason: z.string() })
    .strict()
    .describe('The action cannot even be attempted.'),
])

console.log(
  `[probe] model=${MIND_MODEL} budget=$${CAP_USD.toFixed(2)} caller=probe systemChars=${SYSTEM.length}`,
)

// ---- Check 1: structured verdict ----
{
  const r = await llm.object({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: 'Agent intent: "I try to extract salt by boiling river water." Return a verdict.',
      },
    ],
    schema: VerdictProbe,
  })
  budget()
  const v = r.value
  if (v.kind !== 'attempt') fail(`check1 kind=${v.kind}, expected attempt: ${JSON.stringify(v)}`)
  if (!v.summary || v.summary.trim().length === 0)
    fail(`check1 summary empty: ${JSON.stringify(v)}`)
  console.log(`CHECK 1 PASS: kind=${v.kind} summary=${JSON.stringify(v.summary)}`)
  console.log(
    `  in=${r.usage.inputTokens} out=${r.usage.outputTokens} cacheRead=${r.usage.cacheReadTokens} cost=$${r.usage.costUsd.toFixed(6)}`,
  )
}

// ---- Check 2: canon prefix cache ----
{
  const call = (userMsg: string) =>
    llm.object({
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      schema: VerdictProbe,
    })
  await call('Agent intent: "I pack the pump bearing with grease from the shed." Return a verdict.')
  budget()
  let r2 = await call('Agent intent: "I weave a basket from river fiber." Return a verdict.')
  let cin = r2.usage.cacheReadTokens
  if (cin === 0) {
    console.log('[cache] cacheReadTokens=0, retrying once after 5s...')
    await sleep(5000)
    r2 = await call('Agent intent: "I carve a spoon from wood." Return a verdict.')
    cin = r2.usage.cacheReadTokens
  }
  budget()
  if (cin <= 0) fail('check2 cacheReadTokens still 0 after retry')
  console.log(
    `CHECK 2 PASS: cacheReadTokens=${cin} (in=${r2.usage.inputTokens} out=${r2.usage.outputTokens} cost=$${r2.usage.costUsd.toFixed(6)})`,
  )
}

// ---- Check 3: rephrase consistency (evidence) ----
{
  const a = await llm.object({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: 'Agent intent: "I boil river water to get salt." Return a verdict.',
      },
    ],
    schema: VerdictProbe,
  })
  const b = await llm.object({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: 'Agent intent: "I extract salt from the river by boiling." Return a verdict.',
      },
    ],
    schema: VerdictProbe,
  })
  budget()
  if (a.value.kind !== 'attempt')
    fail(`check3a kind=${a.value.kind}, expected attempt: ${JSON.stringify(a.value)}`)
  if (b.value.kind !== 'attempt')
    fail(`check3b kind=${b.value.kind}, expected attempt: ${JSON.stringify(b.value)}`)
  console.log('CHECK 3 PASS (evidence): rephrase consistency')
  console.log(
    `  recipeId(a)=${JSON.stringify(a.value.recipeId)}  recipeId(b)=${JSON.stringify(b.value.recipeId)}`,
  )
  console.log(`  summary(a)=${JSON.stringify(a.value.summary)}`)
  console.log(`  summary(b)=${JSON.stringify(b.value.summary)}`)
}

const total = llm.totalCostUsd()
console.log(`ALL 3 CHECKS PASS. total spend=$${total.toFixed(4)} (cap $${CAP_USD.toFixed(2)})`)
