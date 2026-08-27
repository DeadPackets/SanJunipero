import { type EventStore } from '@sj/engine/store'
import { AgentBorn } from '@sj/engine'
import type { z } from 'zod'
import type { EngineBridge } from '../runtime/bridge.js'

export type AgentBornPayload = z.infer<typeof AgentBorn>

// A birth is the one world event that needs a mind built for it. The watch is a
// tail of the log, not a hook in the engine: the world does not know minds exist.
export function watchBirths(
  bridge: EngineBridge,
  store: EventStore,
  spawn: (born: AgentBornPayload) => void,
): () => void {
  let seq = store.lastSeq()
  let stopped = false
  bridge.onTick(() => {
    if (stopped) return
    const fresh = store.readTypeFrom(seq, 'agent_born')
    // Past the last birth SEEN, not the last event written: a later birth still has a higher seq.
    seq = fresh.at(-1)?.seq ?? seq
    for (const ev of fresh) spawn(AgentBorn.parse(ev.payload))
  })
  return () => {
    stopped = true
  }
}
