// One bounded batch: classify speech + thoughts with the repo's LlmClient (caller 'semantic' -> deepseek, reasoning off).
import Database from 'better-sqlite3'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { z } from 'zod'
import { LlmClient, migrateLlmTables, sumCostUsd } from '@sj/llm'

const BASE = '/tmp/claude-1001/-home-ubuntu-workspace-SanJunipero/17e53c4c-8688-42fe-bd93-a48d187bfbab/scratchpad/vision'
const BUDGET = 0.3
const rows = JSON.parse(readFileSync(`${BASE}/rows.json`, 'utf8')) as {
  speech: Record<string, [number, string, string, string, boolean, boolean, boolean][]>
  thoughts: Record<string, [number, string, string, string, boolean, boolean][]>
}
type Item = { key: string; kind: 'speech' | 'thought'; who: string; text: string }
const items: Item[] = []
for (const [w, rs] of Object.entries(rows.speech)) rs.forEach((r, i) => items.push({ key: `${w}:s:${i}`, kind: 'speech', who: r[1], text: r[2] }))
// thoughts: all of w3/r3a/r3b, every 3rd of w2 (1065) to stay bounded
for (const [w, rs] of Object.entries(rows.thoughts)) rs.forEach((r, i) => { if (w !== 'w2' || i % 3 === 0) items.push({ key: `${w}:t:${i}`, kind: 'thought', who: r[1], text: r[2] }) })
console.log('items', items.length)

const outPath = `${BASE}/classified.json`
const done: Record<string, unknown> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {}
const todo = items.filter((it) => !(it.key in done))
console.log('todo', todo.length)

const db = new Database(`${BASE}/classify-llm.db`)
migrateLlmTables(db)
const client = new LlmClient({ db, caller: 'semantic', budgetUsd: BUDGET, maxRetries: 2, providerOrder: ['DeepInfra', 'Inceptron'], allowProviderFallbacks: true, requestTimeoutMs: 60_000 })

const Row = z.object({
  i: z.number(),
  cls: z.enum(['task', 'people', 'wonder']),
  survival: z.boolean(),
  question: z.boolean(),
  wantBeyond: z.boolean(),
})
const Schema = z.object({ rows: z.array(Row) })

const SYSTEM = `You classify lines from a village simulation. Each line is either something a villager SAID aloud or THOUGHT privately.
For each numbered line return:
- cls: "task" = chores, logistics, inventory, plans, work, weather-as-work, counting, where to walk, what to fetch; "people" = mainly about another person or the relationship — feelings toward them, banter, greeting, care, grievance, teasing, gratitude, missing them; "wonder" = about the world, self, meaning, memory, the past, beauty, death, curiosity, a wish or a story, an idea.
- survival: true if the line's main concern is the speaker's own hunger, thirst, cold, exhaustion, sleep, injury or the fear of dying.
- question: true if it asks another person something and expects an answer.
- wantBeyond: true if it expresses a want, wish, hope, curiosity or intention that is NOT about food, water, wood, warmth, sleep or work (e.g. wanting to talk with someone, to see the sea, to be remembered, to make something for its own sake).
Return one row per input line, with the same i.`

const BATCH = 40
let spent = 0
for (let b = 0; b < todo.length; b += BATCH) {
  const batch = todo.slice(b, b + BATCH)
  const user = batch.map((it, i) => `${i}. [${it.kind} by ${it.who}] ${it.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')
  try {
    const { value } = await client.object({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: Schema })
    for (const r of value.rows) {
      const it = batch[r.i]
      if (it) done[it.key] = { cls: r.cls, survival: r.survival, question: r.question, wantBeyond: r.wantBeyond }
    }
    writeFileSync(outPath, JSON.stringify(done))
    spent = sumCostUsd(db, 'semantic')
    console.log(`batch ${b / BATCH + 1}/${Math.ceil(todo.length / BATCH)} ok, classified ${Object.keys(done).length}, spent $${spent.toFixed(4)}`)
  } catch (e) {
    console.log(`batch ${b / BATCH + 1} failed: ${(e as Error).message.slice(0, 120)}`)
    if ((e as Error).name === 'BudgetExceededError') break
  }
  if (spent > BUDGET) break
}
console.log('final spend', sumCostUsd(db, 'semantic'))
