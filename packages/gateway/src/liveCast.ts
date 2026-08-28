import type Database from 'better-sqlite3'
import type { SimConfig } from '@sj/shared'
import type { EventStore, openDb } from '@sj/engine/store'
import type { TickHandler, TickLoop } from '@sj/engine'

/** One row of the ruling review queue, as the operator's page reads it. */
export type PendingRuling = {
  id: number
  ruleId: number
  recipeId: string
  tick: number
}

/** What an operator may do to a codified ruling. Structural, so the observatory never imports
 *  the arbiter — `ReviewStore` satisfies it. */
type RulingsAdmin = {
  pending(): PendingRuling[]
  approve(ruleId: number): void
  /** Reverts the rulebook row AND unregisters the verb the ruling minted. */
  revert(ruleId: number, reason: string, tick: number): void
}

/** The live half's ops surface: the call ledger, the caps the run is under, and the ruling
 *  queue. Absent on a scripted stream, which spends nothing and codifies nothing. */
export type LiveOps = {
  /** `_ops.db` — `llm_calls` and `alerts`, open for as long as the cast is. */
  opsDb: Database.Database
  caps: { dailyUsd: number; lifetimeUsd: number }
  rulings: RulingsAdmin | null
}

/** A port, not an import: `@sj/town` hands the bodies to whatever satisfies this and only
 *  `@sj/live` does. Declared here because the observatory is the floor both halves stand on. */
export type LiveCast = {
  /** Runs after the loop exists and before the first tick — each needs the other first. */
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
  /** Read by the operator's channel only; nothing here ever reaches a mind's prompt. Absent
   *  on a cast that buys nothing, which is every fake one. */
  ops?: LiveOps
  stop(): Promise<void>
}
