// CLI: ingest the approved production art into a forge codex DB (idempotent).
// Usage: pnpm --filter @sj/gateway ingest:art [-- --db data/dev-world.db]
// Against a LIVE dev world this hot-swaps the art into connected viewers.
import { openForgeDb } from '@sj/forge'
import { DEV_DB_PATH } from '../src/devWorld.js'
import { ingestProductionArt } from '../src/ingestArt.js'

const dbFlag = process.argv.indexOf('--db')
const dbPath = dbFlag !== -1 ? process.argv[dbFlag + 1]! : DEV_DB_PATH

const db = openForgeDb(dbPath)
try {
  const entries = ingestProductionArt(db)
  for (const e of entries) console.log(`${e.action.padEnd(10)} ${e.kind} (${e.id})`)
  const n = entries.filter((e) => e.action === 'registered').length
  console.log(`ingest: ${n} registered, ${entries.length - n} unchanged → ${dbPath}`)
} finally {
  db.close()
}
