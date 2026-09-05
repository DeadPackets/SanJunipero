import type Database from 'better-sqlite3'

/** `WorldState.terrain` rides in the snapshot, so a resumed world keeps its real map while
 *  everything derived from the environment is drawn for another one — and nothing errors. */
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
  const r = db.prepare('SELECT map, rings, seed FROM world_meta WHERE id = 1').get() as
    | WorldMeta
    | undefined
  return r ?? null
}

export function writeWorldMeta(db: Database.Database, meta: WorldMeta): void {
  db.prepare(
    'INSERT INTO world_meta (id, map, rings, seed) VALUES (1, ?, ?, ?)' +
      ' ON CONFLICT(id) DO UPDATE SET map=excluded.map, rings=excluded.rings, seed=excluded.seed',
  ).run(meta.map, meta.rings, meta.seed)
}

const FRESH_HINT = 'start a new town instead with SJ_FRESH=1'

/** A log with events and no identity row is not a first boot: stamping it makes whatever the
 *  environment says today the baseline every later boot agrees with, and it cannot be undone. */
export function unstampedWorldRefusal(asked: WorldMeta): string {
  return [
    'world on disk has a history but no identity, so this boot cannot tell which town it is.',
    `        It would have called it map ${asked.map}, rings ${asked.rings}, seed ${asked.seed},`,
    '        and every later boot would then agree with that, right or wrong.',
    '        If that is the town, stamp it yourself:',
    `        INSERT INTO world_meta (id, map, rings, seed)` +
      ` VALUES (1, '${asked.map}', ${asked.rings}, '${asked.seed}');`,
    `        Otherwise ${FRESH_HINT}.`,
  ].join('\n')
}

/** Throws when the town on disk is not the town this boot asked for. Names both sides, because
 *  "map mismatch" without the two values is a bug report the operator has to write. */
export function assertSameWorld(stored: WorldMeta, asked: WorldMeta): void {
  const differs: string[] = []
  if (stored.map !== asked.map) differs.push(`map ${stored.map} → ${asked.map}`)
  if (stored.rings !== asked.rings) differs.push(`rings ${stored.rings} → ${asked.rings}`)
  if (stored.seed !== asked.seed) differs.push(`seed ${stored.seed} → ${asked.seed}`)
  if (differs.length === 0) return
  throw new Error(
    `world on disk is a different town than this boot asked for (${differs.join(', ')}); ` +
      `resume it as it is, or ${FRESH_HINT}`,
  )
}
