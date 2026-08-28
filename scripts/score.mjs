// Reads a rehearsal's databases. Prints spend per caller, chapters, dreams, births, alerts, and
// runs the glass scan over every mind-facing artifact the run produced. Reads only, writes nothing.
//     node --env-file=.env scripts/score.mjs        (or SJ_MINDS_DIR=... node scripts/score.mjs)
import Database from 'better-sqlite3'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPromptForGlassLeak } from '@sj/shared'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = process.env.SJ_MINDS_DIR ?? join(root, 'rehearsals', 'minds')
const files = readdirSync(dir).filter((f) => f.endsWith('.db'))
console.log('dbs:', files.join(' '))

const q = (f, sql) => {
  try {
    return new Database(join(dir, f), { readonly: true }).prepare(sql).all()
  } catch (e) {
    return [`(${f}: ${e.message})`]
  }
}

for (const f of files) {
  const t = q(f, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name ?? r)
  console.log(`\n== ${f}: ${t.join(', ')}`)
  if (t.includes('llm_calls')) {
    console.log(
      'spend by caller:',
      q(
        f,
        'SELECT caller, COUNT(*) n, ROUND(SUM(cost_usd),4) usd, SUM(ok=0) failed FROM llm_calls GROUP BY caller',
      ),
    )
    console.log('alerts:', q(f, 'SELECT kind, COUNT(*) n FROM alerts GROUP BY kind'))
  }
  if (t.includes('chapters'))
    console.log('chapters:', q(f, 'SELECT day, title, length(text) len FROM chapters'))
  if (t.includes('publications'))
    console.log('publications:', q(f, 'SELECT kind, COUNT(*) n FROM publications GROUP BY kind'))
  if (t.includes('memories')) {
    const leaks = []
    for (const r of q(f, 'SELECT kind, text FROM memories')) {
      const l = scanPromptForGlassLeak(r.text ?? '')
      if (l.length) leaks.push({ kind: r.kind, l })
    }
    console.log(
      'memories:',
      q(f, 'SELECT kind, COUNT(*) n FROM memories GROUP BY kind'),
      'glass leaks:',
      leaks.length,
      leaks.slice(0, 3),
    )
  }
  if (t.includes('rulings'))
    console.log('rulings:', q(f, 'SELECT kind, COUNT(*) n FROM rulings GROUP BY kind'))
}
