import type Database from 'better-sqlite3'

/**
 * ★ WHO THIS TOWN IS, SO A RESUME CANNOT QUIETLY BOOT A DIFFERENT ONE.
 *
 * `WorldState.terrain` rides in the snapshot, so a resumed world keeps its real map whatever
 * the environment says. That is the trap: bring a `SJ_RINGS=3` town back up with `SJ_RINGS=1`
 * and the world simulates 152 tiles while everything derived from the environment — the
 * platted structures, the scrub fallback terrain — is drawn for 76. Nothing errors. The viewer
 * and the world are simply looking at different maps.
 *
 * One row, three fields, compared on every resume. Divergence is the only way resume can hurt
 * someone, and it is the only thing this table exists to stop.
 */
export type WorldMeta = { map: string; rings: number; seed: string }

export function ensureWorldMetaTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      map TEXT NOT NULL, rings INTEGER NOT NULL, seed TEXT NOT NULL
    );
  `)
}

export function readWorldMeta(db: Database.Database): WorldMeta | null {
  const r = db.prepare('SELECT map, rings, seed FROM world_meta WHERE id = 1').get() as WorldMeta | undefined
  return r ?? null
}

export function writeWorldMeta(db: Database.Database, meta: WorldMeta): void {
  db.prepare(
    'INSERT INTO world_meta (id, map, rings, seed) VALUES (1, ?, ?, ?)'
    + ' ON CONFLICT(id) DO UPDATE SET map=excluded.map, rings=excluded.rings, seed=excluded.seed',
  ).run(meta.map, meta.rings, meta.seed)
}

/** The one instruction that gets an operator past a refused boot. */
export const FRESH_HINT = 'start a new town instead with SJ_FRESH=1'

/**
 * Throws when the town on disk is not the town this boot was asked for. Names both sides,
 * because "map mismatch" without the two values is a bug report the operator has to write.
 */
export function assertSameWorld(stored: WorldMeta, asked: WorldMeta): void {
  const differs: string[] = []
  if (stored.map !== asked.map) differs.push(`map ${stored.map} → ${asked.map}`)
  if (stored.rings !== asked.rings) differs.push(`rings ${stored.rings} → ${asked.rings}`)
  if (stored.seed !== asked.seed) differs.push(`seed ${stored.seed} → ${asked.seed}`)
  if (differs.length === 0) return
  throw new Error(
    `world on disk is a different town than this boot asked for (${differs.join(', ')}); `
    + `resume it as it is, or ${FRESH_HINT}`,
  )
}
