import { AgentEntered, AgentExited } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'

/**
 * The structure a child was born inside, read back out of the log — the fold gives a newborn its
 * mother's `insideId`, so where she was standing at the birth seq is where the child was born.
 * Live world state cannot answer this: by the time a crashed seeding is repaired she has walked
 * out, and the seed would be a different list than the birth would have written.
 * `''` when the child was born under the sky.
 */
export function homeAtBirth(store: EventStore, motherId: string, bornSeq: number): string {
  const lastOf = (type: string, of: (p: unknown) => string) =>
    store
      .readTypeFrom(0, type)
      .filter((ev) => ev.seq < bornSeq && of(ev.payload) === motherId)
      .at(-1)

  const entered = lastOf('agent_entered', (p) => AgentEntered.parse(p).agentId)
  if (entered === undefined) return ''
  const exited = lastOf('agent_exited', (p) => AgentExited.parse(p).agentId)
  if (exited !== undefined && exited.seq > entered.seq) return ''
  return AgentEntered.parse(entered.payload).structureId
}
