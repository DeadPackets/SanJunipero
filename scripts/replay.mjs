// Replays archived turns through the CURRENT prompt assembly and turn schema, so a checked-out
// fix is what gets measured. SPENDS REAL MONEY unless --dry.
//     node --env-file=.env --import tsx scripts/replay.mjs \
//       --minds rehearsals/minds --filter hunger-scene --n 20 --rounds 3 [--settings turn] [--dry]
//
// `--arm` picks what the scene block carries: `raw` is every retrieved memory in full, `gist`
// replaces the long ones with a gist generated here, `wants` adds the pinned wants block on top.
// The three arms share one set of turns, so they are paired rather than merely comparable.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  actWithoutItsDetail,
  appendMoment,
  assemblePrompt,
  DEFAULT_MIND_CONFIG,
  FOUNDER_MINDS,
  gistMemories,
  isBlankAnswer,
  JOURNAL_LINES,
  makeReflectionLlm,
  MemoryStore,
  nightOf,
  openAgentDb,
  PersonalityStore,
  RULES_OF_BEING,
  retrieveAmbient,
  TurnSchema,
  worldDay,
} from '@sj/agents'
import {
  deadCallCounts,
  Embedder,
  LlmClient,
  MIND_MODEL,
  migrateLlmTables,
  PROVIDER_ORDER,
  sumCostUsd,
  sumDeadCalls,
} from '@sj/llm'
import { simTimeFromTick } from '@sj/shared'
import Database from 'better-sqlite3'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CONCURRENCY = 4

// A perception memory IS the rendered moment, byte for byte — but only the prose half survives
// when nobody spoke, so every preset drops the turns that carry another mouth's line.
const NO_HEARD = "json_array_length(json_extract(m.tags, '$.topics')) = 0"
const PRESETS = {
  'hunger-scene': "m.text LIKE '%Your satchel holds%You could eat it now.%'",
  // The world refused what this turn began: a refusal memory before the mind's next moment.
  refused: `EXISTS (SELECT 1 FROM memories a WHERE a.agent_id = m.agent_id AND a.kind = 'action'
      AND a.tick > m.tick AND a.tick < COALESCE((SELECT MIN(p.tick) FROM memories p
        WHERE p.agent_id = m.agent_id AND p.kind = 'perception' AND p.tick > m.tick), 1e9))`,
  'with-people': "json_array_length(json_extract(m.tags, '$.people')) > 0",
}

function usage(why) {
  console.error(
    `replay: ${why}\n  --minds <dir> --filter <${Object.keys(PRESETS).join('|')}|SQL>` +
      `\n  --arm <${ARMS.join('|')}> --n --rounds --settings --cap --out --dry`,
  )
  process.exit(1)
}

const ARMS = ['raw', 'gist', 'wants']
const args = {
  filter: 'hunger-scene',
  n: 20,
  rounds: 3,
  settings: 'turn',
  cap: 0.5,
  arm: 'raw',
  dry: false,
}
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (flag === '--dry') args.dry = true
  else if (flag === '--minds') args.minds = process.argv[++i]
  else if (flag === '--filter') args.filter = process.argv[++i]
  else if (flag === '--out') args.out = process.argv[++i]
  else if (flag === '--settings') args.settings = process.argv[++i]
  else if (flag === '--arm') args.arm = process.argv[++i]
  else if (flag === '--n') args.n = Number(process.argv[++i])
  else if (flag === '--rounds') args.rounds = Number(process.argv[++i])
  else if (flag === '--cap') args.cap = Number(process.argv[++i])
  else usage(`unknown flag ${flag}`)
}
if (args.minds === undefined) usage('--minds is required')
if (!Number.isInteger(args.n) || args.n < 1) usage('--n must be a positive integer')
if (!Number.isInteger(args.rounds) || args.rounds < 1) usage('--rounds must be a positive integer')
if (!ARMS.includes(args.arm)) usage(`--arm must be one of ${ARMS.join(', ')}`)

const where = PRESETS[args.filter] ?? args.filter
const outDir = args.out ?? join(ROOT, 'replays', new Date().toISOString().replace(/[:.]/g, '-'))

// Retrieval logs its own misses, so the archive is never opened for writing.
const work = mkdtempSync(join(tmpdir(), 'sj-replay-'))
const minds = readdirSync(args.minds)
  .filter((f) => f.endsWith('.db') && !f.startsWith('_') && f !== 'dev-world.db')
  .map((f) => f.slice(0, -3))
  .filter((id) => FOUNDER_MINDS.some((m) => m.id === id))
if (minds.length === 0) usage(`no founder mind db in ${args.minds}`)
for (const id of minds) cpSync(join(args.minds, `${id}.db`), join(work, `${id}.db`))

/** Evenly spread over the whole archive, so `n` turns are not `n` consecutive minutes. */
const spread = (rows, take) =>
  rows.length <= take
    ? rows
    : Array.from({ length: take }, (_, i) => rows[Math.floor((i * rows.length) / take)])

// The day log the runtime would have been holding, rebuilt with the runtime's own appender
// over this day's moments, from the dawn the mind last woke out of.
function dayLogAt(moments, tick) {
  let log = []
  let prev = new Set()
  let wasNight = false
  for (const m of moments) {
    if (m.tick > tick) break
    const isNight = simTimeFromTick(m.tick).isNight
    if (wasNight && !isNight) {
      log = []
      prev = new Set()
    }
    wasNight = isNight
    prev = appendMoment(log, prev, m.text)
  }
  return log
}

async function blocksAt(pool, row, wants) {
  const { mind, mem, personality } = pool
  const doc = personality.docBefore(nightOf(row.tick))
  const cues = JSON.parse(row.tags)
  const day = worldDay(row.tick)
  const ledgers = cues.people
    .map((name) => ({ name, ledger: mem.getLedger(name) }))
    .filter((e) => e.ledger !== null && e.ledger.updatedDay <= day)
    .map((e) => ({ name: e.name, doc: e.ledger.doc }))
  return assemblePrompt({
    rulesOfBeing: RULES_OF_BEING,
    identity: mind.identity,
    personality: {
      doc: wants.length === 0 ? doc : { ...doc, current: { ...doc.current, goals: wants } },
      autobiography: mem.autobiography(day),
    },
    journal: mem
      .journalEntries()
      .filter((e) => e.tick <= row.tick)
      .slice(-JOURNAL_LINES)
      .map((e) => ({ day: worldDay(e.tick), text: e.text })),
    scene: {
      ledgers,
      memories: await retrieveAmbient(mem, cues, row.tick, DEFAULT_MIND_CONFIG.ambientK),
    },
    dayLog: dayLogAt(pool.moments, row.tick),
    recalled: null,
    now: { prose: row.text },
  })
}

const embedder = await Embedder.create(process.env.SJ_MODELS_DIR ?? join(ROOT, 'data', 'models'))
const pools = minds
  .map((id) => {
    const db = openAgentDb(join(work, `${id}.db`))
    // One scan for the filter: some presets are a correlated EXISTS and cost seconds per mind.
    const rows = db
      .prepare(
        `SELECT m.tick, m.text, m.tags, ${NO_HEARD} AS quiet FROM memories m
         WHERE m.agent_id = ? AND m.kind = 'perception' AND (${where}) ORDER BY m.tick`,
      )
      .all(id)
    return {
      mind: FOUNDER_MINDS.find((m) => m.id === id),
      mem: new MemoryStore(db, id, embedder),
      personality: new PersonalityStore(db, id),
      moments: db
        .prepare(
          "SELECT tick, text FROM memories WHERE agent_id = ? AND kind = 'perception' ORDER BY tick, id",
        )
        .all(id),
      matched: rows.filter((r) => r.quiet === 1),
      heard: rows.filter((r) => r.quiet === 0).length,
    }
  })
  .filter((p) => p.matched.length > 0)
if (pools.length === 0) usage(`the filter matched no turn in ${args.minds}`)

// Every mind that saw the scene is drawn from, so one long-lived mind cannot own the sample.
const quota = Math.ceil(args.n / pools.length)
const sample = []
for (const p of pools) for (const row of spread(p.matched, quota)) sample.push({ p, row })
const turns = sample.slice(0, args.n)
const heardSkipped = pools.reduce((n, p) => n + p.heard, 0)

mkdirSync(outDir, { recursive: true })
const ops = new Database(join(outDir, 'ops.db'))
migrateLlmTables(ops)
const client = (caller) =>
  new LlmClient({ db: ops, caller, providerOrder: PROVIDER_ORDER, budgetUsd: args.cap })

// A refused prep call leaves that turn without a gist or without its wants; it must not end
// the run, or a throttled provider costs the whole arm.
const standingFrom = async (scenes) => {
  try {
    return (await nightLlm.summarizeDay(scenes)).standing
  } catch {
    return []
  }
}

// Arm prep, and the only place an arm spends outside the turn itself. Gists go into the working
// copy of the mind db, so the second assembly below renders them without knowing an arm exists.
const prep = { gists: 0, ungisted: 0, standing: new Map() }
const nightLlm = makeReflectionLlm(client('reflection'))
if (args.arm !== 'raw' && !args.dry) {
  for (const { p, row } of turns) {
    const ambient = await retrieveAmbient(
      p.mem,
      JSON.parse(row.tags),
      row.tick,
      DEFAULT_MIND_CONFIG.ambientK,
    )
    try {
      prep.gists += await gistMemories(p.mem, nightLlm, ambient)
    } catch {
      prep.ungisted += 1
    }
  }
}
if (args.arm === 'wants' && !args.dry) {
  for (const { p, row } of turns) {
    const day = worldDay(row.tick)
    const key = `${p.mind.id}:${day}`
    if (prep.standing.has(key)) continue
    // The scenes the mind's own night wrote, one day back: the same input the shipped
    // `summarizeDay` reads, so the wants block is generated the way the runtime generates it.
    const scenes = p.mem
      .summaryNodes('scene')
      .filter((n) => n.day < day)
      .slice(-8)
      .map((n) => ({ title: n.title, text: n.text }))
    prep.standing.set(key, scenes.length === 0 ? [] : await standingFrom(scenes))
  }
}

const prompts = []
for (const { p, row } of turns) {
  const standing = prep.standing.get(`${p.mind.id}:${worldDay(row.tick)}`) ?? []
  prompts.push({ mind: p.mind.id, tick: row.tick, assembled: await blocksAt(p, row, standing) })
}

const compacting = prompts.filter((p) => p.assembled.needsCompaction).length
console.log(
  `replay: ${prompts.length} turns from ${pools.map((p) => p.mind.id).join(', ')} — ${args.filter}` +
    ` (${heardSkipped} skipped for heard speech, ${compacting} over the compaction bar)` +
    `\nreplay: arm '${args.arm}' — ${prep.gists} gists written, ${prep.ungisted} turns left raw, ` +
    `${[...prep.standing.values()].filter((l) => l.length > 0).length} wants blocks pinned` +
    '\nreplay: the makeables and standing-walls lines are absent — they read world state no' +
    ' mind db holds, so a build-verb rate measured here is a floor, not the shipped one.',
)

if (args.dry) {
  const one = prompts[0]
  console.log(`\n=== ${one.mind} @ tick ${one.tick}, ~${one.assembled.estTokens} tokens ===`)
  console.log(`--- system ---\n${one.assembled.system}`)
  for (const m of one.assembled.messages) console.log(`--- user ---\n${m.content}`)
  process.exit(0)
}

const llm = client(args.settings)

const answers = []
const queue = prompts.flatMap((p) => Array.from({ length: args.rounds }, (_, r) => ({ ...p, r })))
let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let i = next++; i < queue.length; i = next++) {
      const job = queue[i]
      try {
        const { value } = await llm.object({
          schema: TurnSchema,
          system: job.assembled.system,
          messages: job.assembled.messages,
        })
        answers.push({ mind: job.mind, tick: job.tick, round: job.r, turn: value })
      } catch (err) {
        answers.push({ mind: job.mind, tick: job.tick, round: job.r, error: String(err) })
      }
    }
  }),
)

const acts = answers
  .filter((a) => a.turn?.action != null && 'verb' in a.turn.action)
  .map((a) => ({
    verb: a.turn.action.verb,
    params: a.turn.action.params,
    blank: actWithoutItsDetail(a.turn),
  }))
// The acts that ask for something: everything an empty answer could have been an answer to.
const asking = acts.filter(
  (a) => a.blank !== null || Object.values(a.params).some((v) => !isBlankAnswer(v)),
)
const empty = asking.filter((a) => a.blank !== null)
const byVerb = new Map()
for (const a of asking) {
  const [n, e] = byVerb.get(a.verb) ?? [0, 0]
  byVerb.set(a.verb, [n + 1, e + (a.blank === null ? 0 : 1)])
}
const spoke = answers.filter((a) => a.turn !== undefined && !isBlankAnswer(a.turn.speech))
const dead = sumDeadCalls(deadCallCounts(ops))
const tokens = ops
  .prepare(`SELECT AVG(input_tokens) i, AVG(output_tokens) o FROM llm_calls
     WHERE ok = 1 AND caller = ?`)
  .get(args.settings)
const spent = sumCostUsd(ops, args.settings)
const prepSpent = ['reflection', 'reflection.gist'].reduce((n, c) => n + sumCostUsd(ops, c), 0)
const answered = answers.filter((a) => a.turn !== undefined).length
const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)

writeFileSync(join(outDir, 'answers.jsonl'), answers.map((a) => JSON.stringify(a)).join('\n'))
console.log(`
model        ${MIND_MODEL} via ${PROVIDER_ORDER.join(', ')}, settings '${args.settings}', arm '${args.arm}'
calls        ${queue.length} — ${answered} answered, ${queue.length - answered} dead
act rate     ${pct(acts.length, answered)} (${acts.length} acts, ${asking.length} asking for something)
param filled ${pct(asking.length - empty.length, asking.length)} (${asking.length - empty.length}/${asking.length})
speech rate  ${pct(spoke.length, answered)} (${spoke.length} spoke)
by verb      ${[...byVerb].map(([v, [n, e]]) => `${v} ${e}/${n}`).join(', ') || '—'}
dead calls   empty ${dead.emptyOutput}, unparseable ${dead.unparseable}, other ${dead.otherFailures}
mean tokens  ${Math.round(tokens.i ?? 0)} in, ${Math.round(tokens.o ?? 0)} out
spent        $${spent.toFixed(5)} on turns, $${prepSpent.toFixed(5)} on arm prep, cap $${args.cap.toFixed(2)}
out          ${outDir}`)
