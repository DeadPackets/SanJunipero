// LIVE — narrator call mechanics: structured ChapterSummary output, prefix cache on the
// byte-stable NARRATOR_CANON, caller accounting. Hard cap $5.00, expected spend < $0.05.
import { openDb } from '@sj/engine/store'
import { LlmClient, migrateLlmTables, type LlmUsage } from '@sj/llm'
import { z } from 'zod'
import { NARRATOR_CANON } from '../src/canon.js'

const db = openDb(':memory:')
migrateLlmTables(db)
const llm = new LlmClient({ db, caller: 'narrator', budgetUsd: 5.0 })

const ChapterSummaryProbe = z
  .object({
    title: z.string().min(1),
    text: z.string().min(1),
    citations: z.array(z.number().int().nonnegative()).max(40),
  })
  .strict()

let spent = 0
function book(usage: LlmUsage, label: string): number {
  spent += usage.costUsd
  console.log(
    `[${label}] in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cost=$${usage.costUsd.toFixed(6)} total=$${spent.toFixed(4)}`,
  )
  if (spent > 5.0) {
    console.error('BUDGET CAP EXCEEDED')
    process.exit(1)
  }
  return usage.cacheReadTokens
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- Check 1: structured citations ----
{
  const { value, usage } = await llm.object({
    system: NARRATOR_CANON,
    messages: [
      {
        role: 'user',
        content:
          'Day 1 held three events: [1] Tamar spoke, [2] Omar built a wall, [3] rain fell. Write the day chapter citing only these numbers.',
      },
    ],
    schema: ChapterSummaryProbe,
  })
  if (value.title.length === 0 || value.text.length === 0)
    fail(`check1 empty prose: ${JSON.stringify(value)}`)
  if (!Array.isArray(value.citations) || value.citations.length === 0)
    fail(`check1 no citations: ${JSON.stringify(value)}`)
  if (!value.citations.every((c) => [1, 2, 3].includes(c)))
    fail(`check1 citations outside {1,2,3}: ${JSON.stringify(value.citations)}`)
  book(usage, 'structured')
  console.log('CHECK 1 PASS: structured citations =', JSON.stringify(value.citations))
}

// ---- Check 2: prefix cache on the byte-stable CANON ----
{
  const call = (userMsg: string) =>
    llm.text({ system: NARRATOR_CANON, messages: [{ role: 'user', content: userMsg }] })
  const r1 = await call('In one sentence, name the settlement.')
  book(r1.usage, 'cache-warm')
  let r2 = await call('In one sentence, name the river feature.')
  let cacheRead = book(r2.usage, 'cache-read')
  if (cacheRead === 0) {
    console.log('[cache] cacheReadTokens=0, retrying once after 5s...')
    await sleep(5000)
    r2 = await call('In one sentence, describe the season.')
    cacheRead = book(r2.usage, 'cache-read-retry')
  }
  if (cacheRead === 0) fail('check2 cacheReadTokens still 0 after retry')
  console.log(`CHECK 2 PASS: prefix cache observed, cacheReadTokens=${cacheRead}`)
}

// ---- Check 3: caller accounting ----
{
  const total = llm.totalCostUsd()
  if (!(total > 0)) fail(`check3 totalCostUsd not > 0: ${total}`)
  const row = db.prepare("SELECT COUNT(*) AS n FROM llm_calls WHERE caller = 'narrator'").get() as {
    n: number
  }
  if (row.n < 2) fail(`check3 llm_calls rows for caller 'narrator' < 2: ${row.n}`)
  console.log(`CHECK 3 PASS: caller accounting, rows=${row.n}, totalCostUsd=$${total.toFixed(6)}`)
}

console.log(`ALL 3 CHECKS PASS — total spend $${spent.toFixed(4)} of $5.00 cap`)
