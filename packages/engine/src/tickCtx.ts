import type { SimConfig } from '@sj/shared'
import type { NeedChange } from './events.def.js'
import type { RngStreams } from './rng.js'
import type { WorldState } from './state.js'

// A leaf, so a system can name what it is handed without importing the hub that runs it.
export type TickCtx = {
  readonly config: SimConfig
  readonly rng: RngStreams
  // Filled by the decay laws and emptied by `flushNeedsSystem`, which SYSTEMS runs straight
  // after them: one `needs_changed` per body instead of one event per need.
  readonly needs: Map<string, NeedChange[]>
  state(): WorldState
  emit(type: string, payload: unknown): void
}

export type System = (ctx: TickCtx) => void
