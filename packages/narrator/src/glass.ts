import Database from 'better-sqlite3'

export { NARRATOR_TABLES, openNarratorDb } from './schema.js'

// Two rules, one door each: the narrator may not own a world table, and nothing it names may
// reach a mind. Neither enforcement point is declared here — both are re-exported.
export {
  assertQuotedName,
  CONSTRUCT_VOCABULARY,
  scanPromptForGlassLeak,
  UNNAMED_CONSTRUCT_COPY,
} from '@sj/shared'

// Every world+agent table the narrator must not own (asserted absent from narrator.db).
export const WORLD_TABLES = [
  'events',
  'snapshots',
  'rng_state',
  'rulebook',
  'rulings',
  'rulings_fts',
  'rulings_vec',
  'ruling_reviews',
  'codex',
  'assets',
  'jobs',
  'memories',
  'memory_tags',
  'memories_fts',
  'memory_vec',
  'facts',
  'ledgers',
  'summary_nodes',
  'journal',
  'autobiography',
  'recall_misses',
  'personality_versions',
] as const

// Deliberately NOT engine openDb: readonly is the only genuine "no write grant"
// primitive better-sqlite3 exposes, and openDb would attempt DDL on open.
export function openNarratorWorld(townPath: string): Database.Database {
  return new Database(townPath, { readonly: true })
}
