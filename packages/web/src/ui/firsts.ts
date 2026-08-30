import type { MilestoneRead } from '@sj/shared/narratorSchema'

// The chronicle's own words for each rung of the firsts ledger. The ledger stores a number;
// a number is not a thing the town would say, so nothing below prints one.
const TIER_HEAD: Readonly<Record<string, string>> = {
  '3': 'What the town made',
  '2.5': 'What a mind worked out',
  '2': 'What first became a pattern',
  '1': 'What first happened',
}
const OTHER_HEAD = 'What else was first'

type FirstsGroup = { tier: number; head: string; rows: MilestoneRead[] }

/** Highest tier first, and inside a heading the firsts run in the order they happened. A tier
 *  these words do not cover keeps a heading of its own rather than vanishing off the page. */
export function firstsByTier(rows: readonly MilestoneRead[]): FirstsGroup[] {
  const byTier = new Map<number, MilestoneRead[]>()
  for (const row of rows) {
    const seen = byTier.get(row.tier)
    if (seen === undefined) byTier.set(row.tier, [row])
    else seen.push(row)
  }
  return [...byTier]
    .sort((a, b) => b[0] - a[0])
    .map(([tier, list]) => ({
      tier,
      head: TIER_HEAD[String(tier)] ?? OTHER_HEAD,
      rows: list.sort((a, b) => a.tick - b.tick),
    }))
}
