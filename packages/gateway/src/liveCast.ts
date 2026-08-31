import type Database from 'better-sqlite3'
import type { SimConfig } from '@sj/shared'
import type { EventStore, openDb } from '@sj/engine/store'
import type { TickHandler, TickLoop } from '@sj/engine'

export type PendingRuling = {
  id: number
  ruleId: number
  recipeId: string
  tick: number
}

/** Structural, so the observatory never imports the arbiter — `ReviewStore` satisfies it. */
type RulingsAdmin = {
  pending(): PendingRuling[]
  approve(ruleId: number): void
  /** Reverts the rulebook row AND unregisters the verb the ruling minted. */
  revert(ruleId: number, reason: string, tick: number): void
}

export type LiveOps = {
  /** `_ops.db` — `llm_calls` and `alerts`, open for as long as the cast is. */
  opsDb: Database.Database
  caps: { dailyUsd: number; lifetimeUsd: number }
  rulings: RulingsAdmin | null
  /** One row on the ops surface, for a host that must not import the ledger's own package. */
  alert(kind: string, detail: string): void
}

/** A port, not an import: `@sj/town` hands the bodies to whatever satisfies this and only
 *  `@sj/live` does. Declared here because the observatory is the floor both halves stand on. */
export type LiveCast = {
  /** Runs after the loop exists and before the first tick — each needs the other first. */
  attach(deps: {
    loop: TickLoop
    store: EventStore
    config: SimConfig
    /** In process: a cast publishes what its minds thought into `observer_thoughts`. */
    db: ReturnType<typeof openDb>
    /** The scripted handler. A live cast wraps it, never replaces it. */
    world: TickHandler
  }): TickHandler
  /** Read by the operator's channel only; nothing here ever reaches a mind's prompt. `null` is
   *  a cast that buys nothing — every fake one. */
  ops: LiveOps | null
  stop(): Promise<void>
}
