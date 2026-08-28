/**
 * What actually PASSED between people, from `/api/society`: the read fold counts every word
 * within earshot, every gift, every lesson and every blow. The Bonds lens' other view draws
 * how close two people are; this one draws what they did to each other, and how often.
 */
import { NODE_ALIVE, NODE_DEAD, type BondNode, type PeopleIndex } from './bondModel2.js'
import type { LegendRow } from './relationGraph.js'

export const TRAFFIC_KINDS = ['talk', 'give', 'teach', 'attack'] as const
export type TrafficKind = (typeof TRAFFIC_KINDS)[number]

export type SocietyResponse = {
  nodes: readonly { id: string; name: string; alive: boolean }[]
  links: readonly { source: string; target: string; kind: string; weight: number }[]
}
export const EMPTY_SOCIETY: SocietyResponse = { nodes: [], links: [] }

export function societyFrom(body: unknown): SocietyResponse | null {
  const b = body as Partial<SocietyResponse> | null
  return Array.isArray(b?.links) && Array.isArray(b.nodes)
    ? { nodes: b.nodes, links: b.links }
    : null
}

/** Colour and MARK both, so two kinds are told apart with the colour taken away. All four are
 *  MASTER_PALETTE tokens clearing 3:1 on the lens's night ground. */
export const TRAFFIC_STROKE: Readonly<
  Record<TrafficKind, { color: string; dash: readonly number[] | null; strokeCount: 1 | 2 }>
> = {
  talk: { color: '#7FB0C9', dash: null, strokeCount: 1 }, // water
  give: { color: '#93B573', dash: null, strokeCount: 2 }, // sage
  teach: { color: '#F2C879', dash: [6, 3], strokeCount: 1 }, // honey
  attack: { color: '#E8785A', dash: [2, 3], strokeCount: 2 }, // ember
}

/** What each kind is called where a viewer reads it. Never the verb id. */
const TRAFFIC_WORD: Readonly<Record<TrafficKind, string>> = {
  talk: 'Spoke with',
  give: 'Gave to',
  teach: 'Taught',
  attack: 'Struck',
}

/** The heaviest traffic sits nearest. Bounded both ends so one chatty pair cannot collapse the
 *  rest of the town onto a point. */
export const TRAFFIC_NEAR = 40
export const TRAFFIC_FAR = 200

export function trafficDistance(weight: number, heaviest: number): number {
  if (heaviest <= 1) return TRAFFIC_NEAR
  const share = (Math.min(weight, heaviest) - 1) / (heaviest - 1)
  return Math.round(TRAFFIC_FAR - share * (TRAFFIC_FAR - TRAFFIC_NEAR))
}

export type TrafficLink = {
  id: string
  source: string
  target: string
  kind: TrafficKind
  weight: number
  distance: number
  dash: readonly number[] | null
  strokeCount: 1 | 2
  color: string
  /** the tooltip and the spoken label */
  words: string
}

const isKind = (k: string): k is TrafficKind => (TRAFFIC_KINDS as readonly string[]).includes(k)
const times = (n: number): string => (n === 1 ? 'once' : `${n} times`)

/**
 * Every living person is a node, so somebody nobody has spoken to is visible as the island they
 * are. A link nobody has a word for — a kind this viewer does not know — is dropped rather than
 * drawn in a colour that means nothing.
 */
export function trafficGraph(
  api: SocietyResponse,
  people: PeopleIndex,
): { nodes: BondNode[]; links: TrafficLink[] } {
  const nameOf = (id: string): string => people[id]?.name ?? id
  const kept = api.links.filter((l) => isKind(l.kind) && l.weight > 0)
  const heaviest = kept.reduce((m, l) => Math.max(m, l.weight), 1)
  const degree = new Map<string, number>()

  const links: TrafficLink[] = kept.map((l) => {
    const kind = l.kind as TrafficKind
    const stroke = TRAFFIC_STROKE[kind]
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
    return {
      id: `${l.source} ${l.target} ${kind}`,
      source: l.source,
      target: l.target,
      kind,
      weight: l.weight,
      distance: trafficDistance(l.weight, heaviest),
      dash: stroke.dash,
      strokeCount: stroke.strokeCount,
      color: stroke.color,
      words: `${nameOf(l.source)} ${TRAFFIC_WORD[kind].toLowerCase()} ${nameOf(l.target)} — ${times(l.weight)}`,
    }
  })

  const nodes: BondNode[] = Object.keys(people)
    .sort()
    .map((id) => ({
      id,
      name: nameOf(id),
      size: 6 + 2 * (degree.get(id) ?? 0),
      color: people[id]?.alive === false ? NODE_DEAD : NODE_ALIVE,
      alive: people[id]?.alive !== false,
    }))
  return { nodes, links }
}

/** One axis, four rows: each carries the mark it means, so the key is a key and not a paragraph. */
export function trafficLegend(): LegendRow[] {
  return TRAFFIC_KINDS.map((kind) => ({
    axis: 'kind',
    key: kind,
    swatch: TRAFFIC_STROKE[kind].color,
    words: TRAFFIC_WORD[kind],
    dash: TRAFFIC_STROKE[kind].dash,
    strokeCount: TRAFFIC_STROKE[kind].strokeCount,
  }))
}

// ── what people have FORMED, drawn as a ring round the people in it ───────────────────────
//
// The narrator names groups, roles and rules and says who is in each (`/api/dispatches`
// institutions). On the picture that is a halo: you can see a thing exists before you can
// read what it is called.

/** The ring a person who is no longer living wears. Named here so the institution rings can be
 *  proved not to borrow it. */
export const GONE_RING = '#F4E289'

export const INSTITUTION_KINDS = ['group', 'role', 'rule'] as const
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number]

/** Colour AND line both, so two kinds of belonging are told apart with the colour taken away.
 *  All three are MASTER_PALETTE tokens, and none is a colour already drawn ON a node — the
 *  two fills or the ring a person who is no longer living wears. */
export const INSTITUTION_RING: Readonly<
  Record<InstitutionKind, { color: string; dash: readonly number[] | null; words: string }>
> = {
  group: { color: '#7FB0C9', dash: null, words: 'Belongs to a group' }, // water
  role: { color: '#C47876', dash: [5, 3], words: 'Keeps a role' }, // rose
  rule: { color: '#F6E8D5', dash: [1, 3], words: 'Holds to a rule' }, // parchment
}

export type Institution = {
  kind: string
  name: string
  memberIds: readonly string[]
}

/** What one person wears: one ring per KIND of thing they belong to, outermost last, and the
 *  names behind them for the label. Never one ring per membership — a person in four groups
 *  would be a bullseye nobody can read. */
export type Halo = { kinds: InstitutionKind[]; names: string[] }

const isInstitutionKind = (k: string): k is InstitutionKind =>
  (INSTITUTION_KINDS as readonly string[]).includes(k)

/** Rings in one order, whatever order the record arrived in. */
export function halosOf(list: readonly Institution[]): Map<string, Halo> {
  const order = (k: InstitutionKind): number => INSTITUTION_KINDS.indexOf(k)
  const sorted = list
    .filter((i) => isInstitutionKind(i.kind))
    .sort(
      (a, b) =>
        order(a.kind as InstitutionKind) - order(b.kind as InstitutionKind) ||
        a.name.localeCompare(b.name),
    )
  const out = new Map<string, Halo>()
  for (const inst of sorted) {
    const kind = inst.kind as InstitutionKind
    for (const id of inst.memberIds) {
      const halo = out.get(id) ?? { kinds: [], names: [] }
      if (!halo.kinds.includes(kind)) halo.kinds.push(kind)
      if (!halo.names.includes(inst.name)) halo.names.push(inst.name)
      out.set(id, halo)
    }
  }
  return out
}

/** Only the kinds this town has actually formed: a key row for a thing nobody founded
 *  explains a mark that is not on the picture. */
export function institutionLegend(halos: ReadonlyMap<string, Halo>): InstitutionKind[] {
  const seen = new Set<InstitutionKind>()
  for (const halo of halos.values()) for (const k of halo.kinds) seen.add(k)
  return INSTITUTION_KINDS.filter((k) => seen.has(k))
}
