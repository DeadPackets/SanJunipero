import { AgentEntered } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import type { SimEvent } from '@sj/shared'

// Backwards, stopping at the first hit: only one payload is parsed however long the log is.
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

/** The structure a child was born inside, read from the log: live state cannot answer it, since
 *  a repaired seeding runs after the mother walked out. `''` when born under the sky. */
export function homeAtBirth(store: EventStore, motherId: string, bornSeq: number): string {
  const entered = lastBefore(store, 'agent_entered', motherId, bornSeq)
  if (entered === null) return ''
  const exited = lastBefore(store, 'agent_exited', motherId, bornSeq)
  if (exited !== null && exited.seq > entered.seq) return ''
  return AgentEntered.parse(entered.payload).structureId
}
