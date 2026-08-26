import { describe, expect, it } from 'vitest'
import { BOND_KINDS, bondFrom, type Bond, type BondsResponse } from '@sj/shared'
import {
  BOND_COLORS,
  BOND_KIND_LABEL,
  NODE_ALIVE,
  NODE_DEAD,
  bondTooltip,
  maxBondStrength,
  toBondGraph,
} from './bondsModel.js'
import { GAMIFICATION_BAN } from './townStats.js'

const bond = (_id: string, aId: string, bId: string, kind: Bond['kind'], strength: number): Bond =>
  bondFrom(
    aId,
    bId,
    Array.from({ length: strength }, (_, i) => ({ tick: 10 + i, kind })),
    100,
  )

const api: BondsResponse = {
  asOfTick: 100,
  bonds: [
    bond('alice|bob', 'alice', 'bob', 'partner', 4),
    bond('alice|mira', 'alice', 'mira', 'kin', 1),
    bond('bob|cara', 'bob', 'cara', 'friend', 2),
  ],
}

const people = {
  alice: { name: 'Alice', alive: true },
  bob: { name: 'Bob', alive: true },
  mira: { name: 'Mira', alive: true },
  cara: { name: 'Cara', alive: false },
}

describe('toBondGraph', () => {
  const graph = toBondGraph(api, people)

  it('draws one node per person the bonds touch', () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['alice', 'bob', 'cara', 'mira'])
  })

  it('sizes a node by how many ties it carries', () => {
    const by = new Map(graph.nodes.map((n) => [n.id, n]))
    expect(by.get('alice')?.size).toBe(10) // two bonds → 6 + 2·2
    expect(by.get('mira')?.size).toBe(8) // one bond  → 6 + 2·1
  })

  it('marks who is still walking and who is remembered', () => {
    const by = new Map(graph.nodes.map((n) => [n.id, n]))
    expect(by.get('alice')?.color).toBe(NODE_ALIVE)
    expect(by.get('cara')?.color).toBe(NODE_DEAD)
  })

  it('names a person by id until the town has told us otherwise', () => {
    const bare = toBondGraph(api, {})
    expect(bare.nodes.map((n) => n.name).sort()).toEqual(['alice', 'bob', 'cara', 'mira'])
  })

  it('colours a link by what the tie is', () => {
    const by = new Map(graph.links.map((l) => [l.id, l]))
    expect(by.get('alice|bob')?.color).toBe(BOND_COLORS.partner)
    expect(by.get('alice|mira')?.color).toBe(BOND_COLORS.kin)
    expect(by.get('bob|cara')?.color).toBe(BOND_COLORS.friend)
  })

  it('widens a link by how much has passed between the two', () => {
    const by = new Map(graph.links.map((l) => [l.id, l]))
    expect(by.get('alice|bob')?.width).toBe(3) // strength 4 → 1 + log2(4)
    expect(by.get('bob|cara')?.width).toBe(2) // strength 2 → 1 + log2(2)
    expect(by.get('alice|mira')?.width).toBe(1) // strength 1 → 1 + log2(1)
  })

  it('never lets a strength of zero collapse a link out of sight', () => {
    const zero = toBondGraph({ asOfTick: 1, bonds: [bond('a|b', 'a', 'b', 'work', 0)] }, {})
    expect(zero.links[0]?.width).toBe(1)
  })

  it('carries the whole bond on the link, so a click needs no second lookup', () => {
    expect(graph.links[0]?.bond.recent).toHaveLength(4)
    expect(graph.links[0]?.bond.strength).toBe(4)
  })

  it('draws nothing from a town that has tied no one', () => {
    expect(toBondGraph({ bonds: [], asOfTick: 0 }, people)).toEqual({ nodes: [], links: [] })
  })
})

describe('the bond vocabulary', () => {
  it('gives every kind a colour and a word', () => {
    for (const kind of BOND_KINDS) {
      expect(BOND_COLORS[kind], kind).toMatch(/^#[0-9A-F]{6}$/)
      expect(BOND_KIND_LABEL[kind].length, kind).toBeGreaterThan(0)
    }
  })

  it('gives each kind its own colour, so the legend is readable', () => {
    expect(new Set(Object.values(BOND_COLORS)).size).toBe(BOND_KINDS.length)
  })

  it('speaks of the town, never of a score', () => {
    for (const label of Object.values(BOND_KIND_LABEL))
      expect(label, label).not.toMatch(GAMIFICATION_BAN)
  })
})

describe('bondTooltip', () => {
  it('says who, what and who', () => {
    expect(bondTooltip(api.bonds[0]!, people)).toBe('Alice — kept house with — Bob')
    expect(bondTooltip(api.bonds[2]!, people)).toBe('Bob — friend of — Cara')
  })

  it('falls back to ids rather than to nobody', () => {
    expect(bondTooltip(api.bonds[0]!, {})).toBe('alice — kept house with — bob')
  })
})

describe('maxBondStrength', () => {
  it('finds the deepest tie in the town, for the bar to measure against', () => {
    expect(maxBondStrength(api)).toBe(4)
  })

  it('never returns zero, so an empty bar cannot divide by nothing', () => {
    expect(maxBondStrength({ bonds: [], asOfTick: 0 })).toBe(1)
  })
})
