import type { LineageLike } from '../ui/bondModel2.js'

export type Household = {
  /** the parent ids, sorted, joined by a tab — stable across a re-read of the same lineage */
  key: string
  parents: string[]
  children: { id: string; tick: number }[]
}

/** Who came from whom, gathered into the households the births imply. Children of the same set
 *  of parents are one household; a child with one recorded parent makes a household of one. */
export function households(lineage: LineageLike): Household[] {
  const parentsOf = new Map<string, { parents: string[]; tick: number }>()
  for (const e of lineage.parentOf) {
    const seen = parentsOf.get(e.childId)
    if (seen === undefined) parentsOf.set(e.childId, { parents: [e.parentId], tick: e.tick })
    else seen.parents.push(e.parentId)
  }

  const homes = new Map<string, Household>()
  for (const [childId, { parents, tick }] of parentsOf) {
    const sorted = [...parents].sort()
    const key = sorted.join('\t')
    const home = homes.get(key) ?? { key, parents: sorted, children: [] }
    home.children.push({ id: childId, tick })
    homes.set(key, home)
  }

  for (const home of homes.values()) home.children.sort((a, b) => a.tick - b.tick)
  return [...homes.values()].sort((a, b) => a.children[0]!.tick - b.children[0]!.tick)
}
