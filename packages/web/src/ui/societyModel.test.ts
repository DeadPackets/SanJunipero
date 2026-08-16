import { describe, expect, it } from 'vitest'
import { LINK_COLORS, toGraphData } from './societyModel.js'

const api = {
  nodes: [
    { id: 'builder', name: 'Mason', alive: true },
    { id: 'farmer', name: 'Wren', alive: true },
    { id: 'idler', name: 'Moss', alive: false },
  ],
  links: [
    { source: 'builder', target: 'farmer', kind: 'talk' as const, weight: 4 },
    { source: 'builder', target: 'idler', kind: 'attack' as const, weight: 1 },
  ],
}

describe('toGraphData', () => {
  const g = toGraphData(api)

  it('sizes nodes by degree and colors by alive/dead', () => {
    const builder = g.nodes.find((n) => n.id === 'builder')!
    const farmer = g.nodes.find((n) => n.id === 'farmer')!
    const idler = g.nodes.find((n) => n.id === 'idler')!
    expect(builder.size).toBe(6 + 2 * 2)
    expect(farmer.size).toBe(6 + 2 * 1)
    expect(builder.color).toBe('#93B573')
    expect(idler.color).toBe('#857D75')
  })

  it('widths links 1+log2(weight) and colors by kind', () => {
    const talk = g.links.find((l) => l.kind === 'talk')!
    const attack = g.links.find((l) => l.kind === 'attack')!
    expect(talk.width).toBe(3) // weight 4
    expect(talk.color).toBe(LINK_COLORS.talk)
    expect(attack.color).toBe('#E8785A')
    expect(attack.width).toBe(1)
  })

  it('halos only nodes named by an institutions array (none today)', () => {
    expect(g.nodes.every((n) => n.halo === false)) .toBe(true)
    const withInst = toGraphData({ ...api, institutions: [{ name: 'The Grange', members: ['farmer'] }] })
    expect(withInst.nodes.find((n) => n.id === 'farmer')!.halo).toBe(true)
    expect(withInst.nodes.find((n) => n.id === 'builder')!.halo).toBe(false)
  })
})
