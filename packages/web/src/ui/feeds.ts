import { BondsResponseSchema, type BondsResponse } from '@sj/shared'
import { type LineageLike } from './bondModel2.js'
import { dispatchesFrom } from './dispatches.js'
import { endpoint } from './useEndpoint.js'

// The bonds are history, not a tick reading — a slow beat keeps the picture honest without
// putting a fetch on the world's clock.
export const BONDS_REFETCH_MS = 30_000

const parseBonds = (body: unknown): BondsResponse | null => {
  const parsed = BondsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

const parseLineage = (body: unknown): LineageLike | null => {
  const lineage = body as LineageLike | null
  return Array.isArray(lineage?.parentOf) ? lineage : null
}

/** One read of the ties for the whole page: the Bonds lens and the roster used to poll this on
 *  a clock each, for one dataset that changes about once a tick. */
export const bondsFeed = endpoint('/api/bonds', parseBonds, BONDS_REFETCH_MS)

/** Who came from whom, read once: a town gains a parent only when a child is born, and a
 *  childless town answers with a typed empty. */
export const lineageFeed = endpoint('/api/lineage', parseLineage)

/** The narrator publishes once a sim-day, which is once a real hour, so a minute is generous. */
const DISPATCHES_REFETCH_MS = 60_000

/** The town's paper, its captions, its weeks and its written lives, read once for the whole
 *  page: the Chronicle's paper tab and every open Inspector are looking at the same six lists. */
export const dispatchesFeed = endpoint('/api/dispatches', dispatchesFrom, DISPATCHES_REFETCH_MS)
