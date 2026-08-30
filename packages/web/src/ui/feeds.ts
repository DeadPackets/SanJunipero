import {
  BondsResponseSchema,
  ChronicleResponseSchema,
  type BondsResponse,
  type ChronicleEntry,
} from '@sj/shared'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
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

/** The curated feed is history, not a stream: it is read on a slow beat rather than rebuilt
 *  every tick, so a 2.5 s world never re-renders the sheet underneath the reader's pointer. */
const CHRONICLE_REFETCH_MS = 20_000

const parseChronicle = (body: unknown): ChronicleEntry[] | null => {
  const parsed = ChronicleResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.entries : null
}

/** The town's own record, read once for the whole page: the Chronicle's Today tab and the
 *  broadcast frame's ticker are looking at the same list. */
export const chronicleFeed = endpoint('/api/chronicle', parseChronicle, CHRONICLE_REFETCH_MS)

const FIRSTS_REFETCH_MS = 30_000

const parseFirsts = (body: unknown): MilestoneRead[] | null =>
  Array.isArray(body) ? (body as MilestoneRead[]) : null

/** The firsts ledger the narrator keeps (`@sj/shared`'s `MilestoneRead`), read once for the
 *  whole page: the Chronicle's Firsts tab and the day strip's marks share these rows, on a
 *  slow beat, because a first is a thing that already happened. */
export const milestonesFeed = endpoint('/api/milestones', parseFirsts, FIRSTS_REFETCH_MS)
