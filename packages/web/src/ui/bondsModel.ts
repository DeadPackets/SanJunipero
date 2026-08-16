import type { Bond, BondKind, BondsResponse } from '@sj/shared'

// One palette hex per kind — six ties, six colours, no two alike, so the legend can be read
// at a glance and a link never depends on its neighbours to be identified.
export const BOND_COLORS: Record<BondKind, string> = {
  partner: '#E8785A',
  kin: '#8A6FA8',
  friend: '#7FB0C9',
  rival: '#9E5A5C',
  owe: '#F2C879',
  work: '#93B573',
}

// The legend's word for each tie. Observation, never rank.
export const BOND_KIND_LABEL: Record<BondKind, string> = {
  partner: 'Kept house',
  kin: 'Kin',
  friend: 'Friends',
  rival: 'At odds',
  owe: 'Owes a kindness',
  work: 'Worked together',
}

// The middle of the tooltip sentence: "Alice — kept house with — Bob".
export const BOND_KIND_PHRASE: Record<BondKind, string> = {
  partner: 'kept house with',
  kin: 'kin of',
  friend: 'friend of',
  rival: 'at odds with',
  owe: 'owes a kindness to',
  work: 'worked alongside',
}

export const NODE_ALIVE = '#93B573'
export const NODE_DEAD = '#857D75'

export type Person = { name: string; alive: boolean }
export type PeopleIndex = Readonly<Record<string, Person>>

export type BondNode = { id: string; name: string; size: number; color: string; alive: boolean }
export type BondLink = {
  id: string; source: string; target: string; kind: BondKind
  color: string; width: number; strength: number; bond: Bond
}

const nameOf = (people: PeopleIndex, id: string): string => people[id]?.name ?? id

export function toBondGraph(api: BondsResponse, people: PeopleIndex): { nodes: BondNode[]; links: BondLink[] } {
  const degree = new Map<string, number>()
  for (const b of api.bonds) {
    degree.set(b.aId, (degree.get(b.aId) ?? 0) + 1)
    degree.set(b.bId, (degree.get(b.bId) ?? 0) + 1)
  }
  const nodes: BondNode[] = [...degree.keys()].sort().map((id) => ({
    id,
    name: nameOf(people, id),
    size: 6 + 2 * (degree.get(id) ?? 0),
    color: people[id]?.alive === false ? NODE_DEAD : NODE_ALIVE,
    alive: people[id]?.alive !== false,
  }))
  const links: BondLink[] = api.bonds.map((b) => ({
    id: b.id,
    source: b.aId,
    target: b.bId,
    kind: b.kind,
    color: BOND_COLORS[b.kind],
    // log2(1) is 0 and log2(0) is -Infinity; a tie that exists is always at least a hairline.
    width: b.strength >= 1 ? 1 + Math.log2(b.strength) : 1,
    strength: b.strength,
    bond: b,
  }))
  return { nodes, links }
}

export function bondTooltip(bond: Bond, people: PeopleIndex): string {
  return `${nameOf(people, bond.aId)} — ${BOND_KIND_PHRASE[bond.kind]} — ${nameOf(people, bond.bId)}`
}

// The denominator for the detail panel's strength bar. Never zero.
export function maxBondStrength(api: BondsResponse): number {
  let max = 1
  for (const b of api.bonds) if (b.strength > max) max = b.strength
  return max
}
