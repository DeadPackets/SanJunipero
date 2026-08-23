import { discoveryHeadline, tickToMoment, type AssetRecord, type DiscoveryRecord } from '@sj/shared'

export const DISCOVERY_REFETCH_MS = 20_000
const MINUTES_PER_DAY = 1440

/** One leaf of the record: a discovery, plus the art for the first thing it makes when the
 *  forge has produced any. Pure — no fetch, no DOM. */
export type Leaf = {
  record: DiscoveryRecord
  /** `null` until the forge has art for `record.makes[0]`; the leaf reads without it. */
  assetId: string | null
  /** "Day 12, 00:00" — the moment, in the town's own clock, the same stamp the chronicle uses. */
  when: string
  /** discoveryHeadline, for the leaf's accessible name. */
  headline: string
}

// Ready beats placeholder for the same kind: the forge retries silently, and a leaf that has
// been given real art must never fall back to the grey square it started with.
function artFor(kind: string | undefined, assets: readonly AssetRecord[]): string | null {
  if (kind === undefined) return null
  const mine = assets.filter((a) => a.kind === kind)
  return (mine.find((a) => a.status === 'ready') ?? mine[0])?.id ?? null
}

export function leavesOf(
  discoveries: readonly DiscoveryRecord[],
  assets: readonly AssetRecord[],
): Leaf[] {
  return discoveries.map((record) => {
    const m = tickToMoment(record.tick)
    return {
      record,
      assetId: artFor(record.makes[0], assets),
      when: `Day ${m.day}, ${m.time}`,
      headline: discoveryHeadline(record),
    }
  })
}

const COUNTED = ['nobody', 'one person', 'two people', 'three people', 'four people', 'five people']
const people = (n: number): string => COUNTED[n] ?? `${n} people`

// An observation, never a score. The town is not winning anything.
export function recordSummary(leaves: readonly Leaf[], throughTick: number): string {
  if (leaves.length === 0) return 'The town has not worked anything out yet.'
  const n = Math.max(1, Math.floor(throughTick / MINUTES_PER_DAY))
  const days = n === 1 ? '1 day' : `${n} days`
  const minds = new Set(leaves.map((l) => l.record.byId)).size
  const thing = leaves.length === 1 ? '1 thing' : `${leaves.length} things`
  return `In ${days}, ${people(minds)} worked out ${thing}.`
}
