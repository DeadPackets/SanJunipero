import type { ChronicleEntry } from '@sj/shared'
import type { VisitCursor } from './storage.js'

export function sinceVisit(
  entries: readonly ChronicleEntry[],
  cursor: VisitCursor,
  liveSeq: number,
  runId: string | null,
): ChronicleEntry[] | null {
  if (runId === null || cursor.runId !== runId) return null
  if (cursor.seq !== null)
    return cursor.seq > liveSeq ? null : entries.filter((e) => e.seq > cursor.seq!)
  return cursor.tick === null ? null : entries.filter((e) => e.tick > cursor.tick!)
}
