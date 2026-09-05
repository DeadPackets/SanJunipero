// `@sj/shared` is published as TypeScript source, so plain node cannot load it:
//     [SJ_MINDS_DIR=...] node --import tsx scripts/score.mjs
import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPromptForGlassLeak } from '@sj/shared'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = process.env.SJ_MINDS_DIR ?? join(root, 'rehearsals', 'minds')
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

// The valley road, off the world's own log. What art cost is already in `spend by caller` above,
// under `forge` — faces and objects come out of the one pocket.
const world = process.env.SJ_WORLD_DB ?? join(root, 'data', 'dev-world.db')
if (existsSync(world)) {
  db?.close()
  db = new Database(world, { readonly: true })
  console.log(`\n== ${world}`)
  console.log(
    'the road:',
    q(
      "SELECT type, COUNT(*) n FROM events WHERE type IN ('agent_arrived','agent_departed')" +
        ' GROUP BY type',
    ),
  )
  // Everyone who came, minus everyone who went, per sim-day — the population curve the cap bounds.
  console.log(
    'population change by sim-day:',
    q(
      "SELECT tick / 1440 day, SUM(CASE WHEN type IN ('agent_spawned','agent_born','agent_arrived')" +
        " THEN 1 ELSE -1 END) delta FROM events WHERE type IN ('agent_spawned','agent_born'," +
        "'agent_arrived','agent_died','agent_departed') GROUP BY day ORDER BY day",
    ),
  )
}
db?.close()
