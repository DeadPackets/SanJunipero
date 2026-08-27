import type { SimConfig } from '@sj/shared'
import type { EventStore, openDb } from '@sj/engine/store'
import type { TickHandler, TickLoop } from '@sj/engine'

/**
 * A port, not an import: `@sj/town` hands the bodies to whatever satisfies this, and only
 * `@sj/live` does. It is declared here because the observatory is the floor both halves stand
 * on. `attach` runs after the loop exists and before the first tick — each needs the other first.
 */
export type LiveCast = {
  attach(deps: {
    loop: TickLoop
    store: EventStore
    config: SimConfig
    /** The world db, in process. A live cast publishes what its minds actually thought into
     *  `observer_thoughts`, which is the same channel the scripted canned lines used. */
    db: ReturnType<typeof openDb>
    /** The scripted handler: the tick-1 town, the world systems, and nothing else when the
     *  cast is attached (`FoundersOpts.minds`). A live cast wraps it, never replaces it. */
    world: TickHandler
  }): TickHandler
  stop(): Promise<void>
}
