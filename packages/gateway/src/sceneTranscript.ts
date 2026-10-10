import type Database from 'better-sqlite3'
import { ServerTranscript } from '@sj/shared'

export function transcriptAt(
  db: Database.Database,
  sceneId: string,
  atTick: number,
): ServerTranscript {
  const rows = db
    .prepare(`
    SELECT seq, tick, json_extract(payload, '$.agentId') AS agentId,
      json_extract(payload, '$.text') AS text
    FROM events WHERE type = 'scene_line' AND tick <= ?
      AND json_extract(payload, '$.id') = ? ORDER BY seq DESC LIMIT 101
  `)
    .all(atTick, sceneId) as ServerTranscript['lines']
  return ServerTranscript.parse({
    t: 'transcript',
    sceneId,
    atTick,
    catchup: true,
    truncated: rows.length > 100,
    lines: rows.slice(0, 100).reverse(),
  })
}
