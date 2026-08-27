import { describe, expect, it } from 'vitest'
import {
  TRAFFIC_FAR,
  TRAFFIC_KINDS,
  TRAFFIC_NEAR,
  TRAFFIC_STROKE,
  societyFrom,
  trafficDistance,
  trafficGraph,
  trafficLegend,
} from './societyGraph.js'
import { NODE_DEAD, type PeopleIndex } from './bondModel2.js'

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
