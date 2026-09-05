// `@sj/shared` is published as TypeScript source, so plain node cannot load it:
//     [SJ_MINDS_DIR=...] node --import tsx scripts/score.mjs
import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPromptForGlassLeak } from '@sj/shared'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = process.env.SJ_MINDS_DIR ?? join(root, 'rehearsals', 'minds')
const worldPath = process.env.SJ_WORLD_DB ?? join(root, 'data', 'dev-world.db')
const files = readdirSync(dir).filter((f) => f.endsWith('.db'))
console.log('dbs:', files.join(' '))

let db = null
const q = (sql) => {
  try {
    return db.prepare(sql).all()
  } catch (e) {
    return [`(${e.message})`]
  }
}

for (const f of files) {
  db?.close()
  db = new Database(join(dir, f), { readonly: true })
  const t = q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name ?? r)
  console.log(`\n== ${f}: ${t.join(', ')}`)
  if (t.includes('llm_calls')) {
    console.log(
      'spend by caller:',
      q(
        'SELECT caller, COUNT(*) n, ROUND(SUM(cost_usd),4) usd, SUM(ok=0) failed FROM llm_calls GROUP BY caller',
      ),
    )
    // The semantic pass is pinned to no reasoning (llm/pins.ts): a non-zero total means it slipped.
    console.log(
      'semantic:',
      q(
        "SELECT COUNT(*) n, SUM(ok=0) failed, SUM(reasoning_tokens) reasoning FROM llm_calls WHERE caller='semantic'",
      ),
    )
    console.log('alerts:', q('SELECT kind, COUNT(*) n FROM alerts GROUP BY kind'))
  }
  if (t.includes('chapters'))
    console.log('chapters:', q('SELECT day, title, length(text) len FROM chapters'))
  if (t.includes('publications'))
    console.log('publications:', q('SELECT kind, COUNT(*) n FROM publications GROUP BY kind'))
  if (t.includes('memories')) {
    const leaks = []
    for (const r of q('SELECT kind, text FROM memories')) {
      const l = scanPromptForGlassLeak(r.text ?? '')
      if (l.length) leaks.push({ kind: r.kind, l })
    }
    console.log(
      'memories:',
      q('SELECT kind, COUNT(*) n FROM memories GROUP BY kind'),
      'glass leaks:',
      leaks.length,
      leaks.slice(0, 3),
    )
  }
  // `rulings` keeps the whole verdict as JSON; its kind is inside, not a column.
  if (t.includes('rulings'))
    console.log(
      'rulings:',
      q("SELECT json_extract(verdict_json,'$.kind') kind, COUNT(*) n FROM rulings GROUP BY kind"),
    )
  if (t.includes('constructs')) console.log('constructs:', q('SELECT * FROM constructs'))
  if (t.includes('milestones'))
    console.log('milestones:', q('SELECT day, tier, label FROM milestones ORDER BY day'))
}
db?.close()

// The town's own log: who came up the road, who went down it, and how many people the valley
// held while they did. Task 14's counts — everything here is read, nothing is folded.
if (existsSync(worldPath)) {
  const world = new Database(worldPath, { readonly: true })
  const rows = (type) =>
    world
      .prepare('SELECT seq, tick, payload FROM events WHERE type = ? ORDER BY seq')
      .all(type)
      .map((r) => ({ seq: r.seq, tick: r.tick, p: JSON.parse(r.payload) }))
  const day = (tick) => Math.floor(tick / 1440)

  console.log(`\n== ${worldPath}`)
  const arrivals = rows('agent_arrived')
  // A traveller is authored and carries an authored id; anything minted came off the road.
  const minted = arrivals.filter((a) => /^agent_\d+$/.test(a.p.id))
  console.log(
    'arrivals:',
    arrivals.length,
    `(traveller ${arrivals.length - minted.length}, stranger ${minted.length})`,
    arrivals.map((a) => `${a.p.name} d${day(a.tick)}`),
  )

  const departures = rows('agent_departed')
  console.log(
    'departures:',
    departures.length,
    departures.map((d) => `${d.p.agentId} d${day(d.tick)}`),
  )
  console.log(
    'departures with no cause standing: see the `departure_without_cause` alert count above',
  )

  // Bodies alive and still in the valley at the turn of each sim-day.
  const comings = [...rows('agent_spawned'), ...rows('agent_born'), ...arrivals]
  const goings = [...rows('agent_died'), ...departures]
  const lastDay = day(world.prepare('SELECT COALESCE(MAX(tick), 0) t FROM events').get().t)
  const population = []
  for (let d = 0; d <= lastDay; d++) {
    const at = d * 1440
    const here =
      comings.filter((e) => e.tick <= at).length - goings.filter((e) => e.tick <= at).length
    population.push(`d${d}:${here}`)
  }
  console.log('population at 00:00:', population.join(' '))

  // How long a walker stood about before anybody sat down with them.
  const tellings = rows('scene_opened').filter((s) => s.p.kind === 'telling')
  console.log(
    'arrival → first telling, in ticks:',
    arrivals.map((a) => {
      const met = tellings.find(
        (s) => s.tick >= a.tick && (s.p.participants ?? []).includes(a.p.id),
      )
      return `${a.p.id}:${met === undefined ? 'never' : met.tick - a.tick}`
    }),
  )

  // A completion with no conception behind it, at the cap, is the engine refusing a child.
  const cap = rows('config_changed')
    .filter((c) => c.p.path === 'population.maxMinds')
    .at(-1)
  const bedded = world
    .prepare(
      "SELECT COUNT(*) n FROM events WHERE type = 'action_completed' AND json_extract(payload,'$.verb') = 'lie_with'",
    )
    .get().n
  console.log(
    'ceiling:',
    cap === undefined ? '(never announced)' : cap.p.value,
    '| lie_with completions:',
    bedded,
    '| conceptions:',
    rows('agent_conceived').length,
    '| births:',
    rows('agent_born').length,
  )
  world.close()
} else {
  console.log(`\n== no world log at ${worldPath} (set SJ_WORLD_DB)`)
}
