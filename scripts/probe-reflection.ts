import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  Embedder,
  MIND_MODEL,
  FALLBACK_MODELS,
  PROVIDER_ORDER,
  LlmClient,
  configureSpendLimits,
  migrateLlmTables,
  sumCostUsd,
  sumReserved,
} from '../packages/llm/src/index.js'
import {
  FOUNDER_MINDS,
  MemoryStore,
  PersonalityStore,
  TieStore,
  openAgentDb,
} from '../packages/agents/src/index.js'
import { makeReflectionLlm, runSleepReflection } from '../packages/agents/src/reflection.js'

const [runDirectory, outputDirectory, agentId = 'halim', dayText = '0'] = process.argv.slice(2)
if (!runDirectory || !outputDirectory || !process.env.OPENROUTER_API_KEY)
  throw new Error(
    'Usage: OPENROUTER_API_KEY=… node --import tsx scripts/probe-reflection.ts RUN_DIRECTORY NEW_OUTPUT_DIRECTORY [agentId] [zeroBasedDay]',
  )
if (
  MIND_MODEL !== 'openai/gpt-5.6-luna' ||
  FALLBACK_MODELS.length !== 0 ||
  PROVIDER_ORDER.join(',') !== 'OpenAI'
)
  throw new Error('Probe requires the validated Luna/OpenAI route with no fallback model')
const day = Number(dayText)
if (!Number.isSafeInteger(day) || day < 0) throw new Error('day must be a nonnegative integer')
const founder = FOUNDER_MINDS.find((person) => person.id === agentId)
if (!founder) throw new Error('Choose an existing founder for this bounded probe')
const sourcePath = join(resolve(runDirectory), 'minds', `${agentId}.db`)
const output = resolve(outputDirectory)
mkdirSync(output, { recursive: false })
const copyPath = join(output, `${agentId}.db`)
const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
try {
  await source.backup(copyPath)
} finally {
  source.close()
}
const db = openAgentDb(copyPath)
const ops = new Database(join(output, '_ops.db'))
migrateLlmTables(ops)
configureSpendLimits(ops, { lifetimeUsd: 2, rollingDayUsd: 2 })
const client = new LlmClient({
  db: ops,
  caller: 'reflection',
  providerOrder: ['OpenAI'],
  allowProviderFallbacks: false,
  agentId,
  maxRetries: 0,
  requestTimeoutMs: 45_000,
  maxQueueWaitMs: 5_000,
})
let forceExit: ReturnType<typeof setTimeout> | undefined
const timer = setTimeout(() => {
  client.abort()
  forceExit = setTimeout(() => {
    try {
      writeFileSync(
        join(output, 'deadline.json'),
        JSON.stringify(
          {
            reason:
              'Reflection did not settle within 20 seconds after the 180-second abort deadline',
            spendUsd: sumCostUsd(ops),
            reservedUsd: sumReserved(ops),
          },
          null,
          2,
        ),
      )
    } finally {
      process.exit(1)
    }
  }, 20_000)
}, 180_000)
const alerts: { kind: string; detail: string }[] = []
const phases: string[] = []
try {
  const embedder = await Embedder.create()
  client.signal.throwIfAborted()
  const mem = new MemoryStore(db, agentId, embedder)
  const personality = new PersonalityStore(db, agentId)
  const ties = new TieStore(db, agentId)
  const sourceMemoryCount = mem.memoriesOfDay(day).length
  const before = { goals: personality.current().doc.current.goals, ties: ties.all() }
  const real = makeReflectionLlm(client)
  const llm = new Proxy(real, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        phases.push(String(property))
        return Reflect.apply(value, target, args) as unknown
      }
    },
  })
  let result: unknown
  let error: string | null = null
  try {
    result = await runSleepReflection({
      mem,
      personality,
      llm,
      day,
      selfName: founder.identity.name,
      ties: {
        store: ties,
        cast: FOUNDER_MINDS.map((person) => ({ id: person.id, name: person.identity.name })),
        tick: (day + 1) * 1440,
      },
      alert: (kind, detail) => alerts.push({ kind, detail }),
    })
  } catch (err) {
    error = String(err)
  }
  const report = {
    sourcePath,
    copyPath,
    agentId,
    day,
    capUsd: 2,
    deadlineMs: 180_000,
    abortGraceMs: 20_000,
    sourceMemoryCount,
    phases,
    result,
    error,
    alerts,
    before,
    after: { goals: personality.current().doc.current.goals, ties: ties.all() },
    calls: ops
      .prepare(
        'SELECT caller,model,provider,ok,input_tokens,output_tokens,cost_usd,latency_ms,error FROM llm_calls ORDER BY id',
      )
      .all(),
    spendUsd: sumCostUsd(ops),
    reservations: ops
      .prepare(
        'SELECT status,COUNT(*) AS n,SUM(amount_usd) AS usd FROM llm_reservations GROUP BY status',
      )
      .all(),
    limits: [
      'Only naturally reached reflection phases were exercised.',
      'Retained/resolved commitments are private resident beliefs.',
      'The source mind database was opened readonly; only its copy was changed.',
      'The deadline starts after copying and opening databases. Abort is followed by a 20-second process-exit grace; unresolved billing stays reserved.',
    ],
  }
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({
      report: join(output, 'report.json'),
      phases,
      result,
      error,
      spendUsd: report.spendUsd,
    }),
  )
  if (error !== null || (result as { fallback?: boolean } | undefined)?.fallback)
    process.exitCode = 1
} finally {
  clearTimeout(timer)
  clearTimeout(forceExit)
  client.abort()
  db.close()
  ops.close()
}
