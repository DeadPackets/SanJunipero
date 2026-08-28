import { AgentEntered } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import type { SimEvent } from '@sj/shared'

// Walked backwards and stopped at the first hit, so a town that has been indoors for a year still
// only reads one payload. The rest are matched on the raw field, not parsed.
function lastBefore(
  store: EventStore,
  type: string,
  agentId: string,
  seq: number,
): SimEvent | null {
  const evs = store.readTypeFrom(0, type)
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i]!
    if (ev.seq >= seq) continue
    if ((ev.payload as { agentId?: string }).agentId === agentId) return ev
  }
  return null
}

/**
 * The structure a child was born inside, read back out of the log — the fold gives a newborn its
 * mother's `insideId`, so where she was standing at the birth seq is where the child was born.
 * Live world state cannot answer this: by the time a crashed seeding is repaired she has walked
 * out, and the seed would be a different list than the birth would have written.
 * `''` when the child was born under the sky.
 */
export function homeAtBirth(store: EventStore, motherId: string, bornSeq: number): string {
  const entered = lastBefore(store, 'agent_entered', motherId, bornSeq)
  if (entered === null) return ''
  const exited = lastBefore(store, 'agent_exited', motherId, bornSeq)
  if (exited !== null && exited.seq > entered.seq) return ''
  return AgentEntered.parse(entered.payload).structureId
}
