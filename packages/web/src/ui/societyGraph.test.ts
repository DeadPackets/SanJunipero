import { describe, expect, it } from 'vitest'
import {
  INSTITUTION_KINDS,
  INSTITUTION_RING,
  TRAFFIC_FAR,
  TRAFFIC_KINDS,
  TRAFFIC_NEAR,
  GONE_RING,
  TRAFFIC_STROKE,
  halosOf,
  institutionLegend,
  societyFrom,
  trafficDistance,
  trafficGraph,
  trafficLegend,
} from './societyGraph.js'
import { NODE_ALIVE, NODE_DEAD, type PeopleIndex } from './bondModel2.js'

const PEOPLE: PeopleIndex = {
  amara: { name: 'Amara', alive: true },
  omar: { name: 'Omar', alive: true },
  yusuf: { name: 'Yusuf', alive: false },
}

const API = {
  nodes: [],
  links: [
    { source: 'amara', target: 'omar', kind: 'talk', weight: 12 },
    { source: 'omar', target: 'amara', kind: 'give', weight: 1 },
    { source: 'amara', target: 'yusuf', kind: 'ritual', weight: 4 }, // a kind this viewer has no word for
    { source: 'omar', target: 'yusuf', kind: 'attack', weight: 0 },
  ],
}

describe('societyFrom', () => {
  it('takes a body with both lists, and refuses anything else', () => {
    expect(societyFrom({ nodes: [], links: [] })).toEqual({ nodes: [], links: [] })
    expect(societyFrom({ nodes: [] })).toBeNull()
    expect(societyFrom(null)).toBeNull()
  })
})

describe('trafficGraph', () => {
  const graph = trafficGraph(API, PEOPLE)

  it('draws only what it has a word for, and only what actually happened', () => {
    expect(graph.links.map((l) => l.kind)).toEqual(['talk', 'give'])
  })

  it('says what passed in the town’s words, never the verb id', () => {
    expect(graph.links[0]?.words).toBe('Amara spoke with Omar — 12 times')
    expect(graph.links[1]?.words).toBe('Omar gave to Amara — once')
  })

  it('keeps every living person on the page, so an island reads as one', () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(['amara', 'omar', 'yusuf'])
    expect(graph.nodes.find((n) => n.id === 'yusuf')?.color).toBe(NODE_DEAD)
    expect(graph.nodes.find((n) => n.id === 'yusuf')?.size).toBe(6) // nothing passed through them
  })

  it('puts the heaviest traffic nearest, and holds the far end where nothing is', () => {
    expect(graph.links[0]?.distance).toBe(TRAFFIC_NEAR)
    expect(graph.links[1]?.distance).toBe(TRAFFIC_FAR)
    expect(trafficDistance(1, 1)).toBe(TRAFFIC_NEAR)
  })
})

describe('the traffic key', () => {
  it('tells every pair apart with the colour taken away', () => {
    const marks = TRAFFIC_KINDS.map(
      (k) => `${TRAFFIC_STROKE[k].dash?.join(',') ?? '-'}:${TRAFFIC_STROKE[k].strokeCount}`,
    )
    expect(new Set(marks).size).toBe(TRAFFIC_KINDS.length)
  })

  it('carries the mark it means, on one axis', () => {
    const rows = trafficLegend()
    expect(rows.map((r) => r.axis)).toEqual(TRAFFIC_KINDS.map(() => 'kind'))
    expect(rows.map((r) => r.words)).toEqual(['Spoke with', 'Gave to', 'Taught', 'Struck'])
  })
})

describe('halosOf — the ring a person wears for what they belong to', () => {
  const list = [
    { kind: 'role', name: 'the fisher', memberIds: ['omar'] },
    { kind: 'group', name: 'the morning watch', memberIds: ['omar', 'nadia'] },
    { kind: 'group', name: 'the well diggers', memberIds: ['omar'] },
    { kind: 'rule', name: 'nobody eats first', memberIds: ['nadia'] },
  ]

  it('gives every member of a thing a ring for its kind', () => {
    const halos = halosOf(list)
    expect(halos.get('omar')?.kinds).toEqual(['group', 'role'])
    expect(halos.get('nadia')?.kinds).toEqual(['group', 'rule'])
  })

  it('★ is one ring per KIND, never one per membership — omar is in two groups', () => {
    expect(halosOf(list).get('omar')?.kinds.filter((k) => k === 'group')).toHaveLength(1)
    expect(halosOf(list).get('omar')?.names).toEqual([
      'the morning watch',
      'the well diggers',
      'the fisher',
    ])
  })

  it('rings in one order, whatever order the record arrived in', () => {
    const shuffled = [list[3]!, list[0]!, list[2]!, list[1]!]
    expect(halosOf(shuffled).get('omar')?.kinds).toEqual(halosOf(list).get('omar')?.kinds)
  })

  it('draws no ring for a kind it has no mark for, and none for nobody', () => {
    expect(halosOf([{ kind: 'cabal', name: 'x', memberIds: ['omar'] }]).size).toBe(0)
    expect(halosOf([]).size).toBe(0)
  })

  it('every kind carries a colour AND a line, so the key survives the colour going', () => {
    const dashes = INSTITUTION_KINDS.map((k) => INSTITUTION_RING[k].dash?.join(',') ?? 'solid')
    expect(new Set(dashes).size).toBe(INSTITUTION_KINDS.length)
    expect(new Set(INSTITUTION_KINDS.map((k) => INSTITUTION_RING[k].color)).size).toBe(
      INSTITUTION_KINDS.length,
    )
  })

  it('keys only the kinds this town actually formed', () => {
    expect(institutionLegend(halosOf(list))).toEqual(['group', 'role', 'rule'])
    expect(institutionLegend(halosOf([list[3]!]))).toEqual(['rule'])
    expect(institutionLegend(halosOf([]))).toEqual([])
  })

  it('★ never borrows a colour already drawn on a node — the two fills, or the dead ring', () => {
    const onTheNode = new Set([NODE_ALIVE, NODE_DEAD, GONE_RING])
    for (const k of INSTITUTION_KINDS)
      expect(onTheNode.has(INSTITUTION_RING[k].color), k).toBe(false)
  })
})
