import { describe, expect, it } from 'vitest'
import { GIST_MIN_CHARS, needsGist } from '../memory/gist.js'
import type { ScoredMemory } from '../memory/retrieve.js'
import type { MemoryRow } from '../memory/store.js'
import { fixtureBlocks } from '../testutil/fixtures.js'
import { assemblePrompt } from './assemble.js'
import { perceptionMemoryText, type PerceptionPacket } from './prose.js'

// A perception row was the whole `now` prose: 1,365 characters on average on r24, 89% of every
// mind's memory bytes, and a night call each to write a 45% copy beside it. The marks are the
// half nothing could paraphrase, so they are the half the row keeps.

const TIME = {
  tick: 8 * 60,
  year: 0,
  season: 'spring',
  dayOfSeason: 1,
  dayOfYear: 0,
  hour: 8,
  minute: 0,
  isNight: false,
}

const body = {
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  injuries: [],
  ill: false,
}

const item = (id: string, kind: string, qty: number, x: number, y: number) => ({
  id,
  kind,
  qty,
  loc: { t: 'tile' as const, x, y },
})

const structure = (id: string, kind: string, x: number, y: number, name?: string) => ({
  id,
  kind,
  x,
  y,
  w: 2,
  h: 2,
  burning: false,
  stage: 'complete' as const,
  ...(name === undefined ? {} : { name }),
})

function fixture(): PerceptionPacket {
  return {
    time: TIME,
    self: {
      body,
      x: 12,
      y: 7,
      asleep: false,
      collapsed: false,
      activity: null,
      inventory: [{ id: 'item_axe', kind: 'axe', qty: 1, loc: { t: 'agent', id: 'tamar' } }],
    },
    weather: { kind: 'sunny', temperatureC: 14 },
    visible: {
      agents: [
        {
          id: 'nadia',
          name: 'Nadia',
          x: 12,
          y: 8,
          activityVerb: null,
          collapsed: false,
          asleep: false,
        },
        {
          id: 'omar',
          name: 'Omar',
          x: 13,
          y: 7,
          activityVerb: null,
          collapsed: false,
          asleep: false,
        },
      ],
      structures: [
        structure('structure_barn', 'barn', 20, 20),
        structure('structure_well', 'well', 12, 9, 'the old well'),
        structure('structure_house', 'house', 14, 7),
      ],
      items: [
        item('item_bread_1', 'bread', 2, 12, 7),
        item('item_herb_2', 'herb', 3, 12, 8),
        item('item_plank_3', 'plank', 1, 19, 19),
      ],
      crops: [],
    },
    reach: { atHand: ['item_bread_1', 'item_herb_2'], noFooting: [] },
    heard: [],
    seen: [],
    feltEvents: [],
  } as unknown as PerceptionPacket
}

/** 12 faces, 20 things underfoot and 6 roofs: the busiest moment the valley has had. */
function busy(): PerceptionPacket {
  const packet = fixture()
  packet.visible.agents = Array.from({ length: 12 }, (_, i) => ({
    id: `agent_${i}`,
    name: `Person${i}`,
    x: 12,
    y: 7,
    activityVerb: null,
    collapsed: false,
    asleep: false,
  }))
  packet.visible.items = Array.from({ length: 20 }, (_, i) =>
    item(`item_wood_${i}`, 'wood', 3, 12, 7),
  )
  packet.visible.structures = Array.from({ length: 6 }, (_, i) =>
    structure(`structure_${i}`, 'longhouse', 12 + i, 7),
  )
  packet.reach = { atHand: packet.visible.items.map((i) => i.id), noFooting: [] }
  return packet
}

const row = (text: string): MemoryRow => ({
  id: 1,
  agentId: 'tamar',
  tick: TIME.tick,
  day: 0,
  kind: 'perception',
  text,
  gist: null,
  importance: 3,
  tags: { people: [], place: null, objects: [], topics: [] },
})

describe('perceptionMemoryText: the moment, remembered short', () => {
  it('says when, where, who, what is in reach, what is near and what is in hand, and nothing else', () => {
    expect(perceptionMemoryText(fixture())).toBe(
      'It is Monday, day 1, day, early spring, at (12, 7). With Nadia, Omar. ' +
        'Within reach: 2 bread (item_bread_1), 3 herb (item_herb_2). ' +
        'Near: a house (structure_house), the old well (structure_well), a barn (structure_barn). ' +
        'In hand: axe ×1 (item_axe).',
    )
  })

  it('says the roof it was under, when the body was under one', () => {
    const packet = fixture()
    packet.self.inside = { id: 'structure_house', kind: 'house' }
    expect(perceptionMemoryText(packet)).toContain(
      'It is Monday, day 1, day, early spring, inside the house (structure_house).',
    )
  })

  it('is byte-identical for the same packet', () => {
    const packet = fixture()
    expect(perceptionMemoryText(packet)).toBe(perceptionMemoryText(packet))
    expect(perceptionMemoryText(fixture())).toBe(perceptionMemoryText(fixture()))
  })

  it('drops the weather, the light and the ground, which nothing ever read back', () => {
    const said = perceptionMemoryText(fixture())
    expect(said).not.toContain('The sun is out')
    expect(said).not.toContain('The air is')
    expect(said).not.toContain('close enough to touch')
  })

  it('keeps every mark it can reach, and says how many it left out', () => {
    const packet = busy()
    const said = perceptionMemoryText(packet)
    for (const i of packet.visible.items.slice(0, 8)) expect(said).toContain(i.id)
    expect(said).toContain('and 12 more')
  })

  it('keeps both reach marks of a scene that has only two, with no tail', () => {
    const said = perceptionMemoryText(fixture())
    expect(said).toContain('item_bread_1')
    expect(said).toContain('item_herb_2')
    expect(said).not.toContain('more')
    // Out of reach is out of the row: it was never a thing these hands could act on.
    expect(said).not.toContain('item_plank_3')
  })

  it('fits under the gist floor even on the busiest moment, so no night call is ever asked for', () => {
    const said = perceptionMemoryText(busy())
    expect(said.length).toBeLessThan(GIST_MIN_CHARS)
    expect(needsGist(row(said))).toBe(false)
  })

  it('reaches the scene block with every mark still on it', () => {
    const said = perceptionMemoryText(fixture())
    const remembered: ScoredMemory = {
      ...row(said),
      score: 1,
      parts: { tag: 1, bm25: 1, cosine: 1, recency: 1, importance: 0.3 },
    }
    const prompt = assemblePrompt(fixtureBlocks({ scene: { ledgers: [], memories: [remembered] } }))
    const scene = prompt.messages.map((m) => m.content).join('\n')
    expect(scene).toContain(`What you remember:\n${said}`)
    for (const mark of ['item_bread_1', 'item_herb_2', 'structure_well', 'item_axe'])
      expect(scene).toContain(mark)
  })

  it('keeps two overheard lines and no more, each cut short, so a passing word is not lost', () => {
    const packet = fixture()
    const long = 'x'.repeat(200)
    packet.heard = [
      { speakerId: 'nadia', name: 'Nadia', text: 'Has anyone seen Kamal today?', distance: 3 },
      { speakerId: 'omar', name: 'Omar', text: long, distance: 4 },
      { speakerId: 'halim', name: 'Halim', text: 'Four fish, no more.', distance: 5 },
    ]
    const text = perceptionMemoryText(packet)
    expect(text).toContain('Heard: Nadia said "Has anyone seen Kamal today?". Omar said "')
    expect(text).toContain(`"${'x'.repeat(120)}"`)
    expect(text).not.toContain('x'.repeat(121))
    expect(text).not.toContain('Halim said')
    expect(perceptionMemoryText(fixture())).not.toContain('Heard:')
  })

  it('names at most three roofs, nearest first', () => {
    const said = perceptionMemoryText(busy())
    const near = said.slice(said.indexOf('Near: '))
    expect(near).toContain('a longhouse (structure_0), a longhouse (structure_1)')
    expect(near).not.toContain('structure_3')
  })
})
