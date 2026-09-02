import { describe, expect, it } from 'vitest'
import { DAYS_PER_YEAR, FOUNDER_IDS, makeCityTemplate } from '@sj/shared'
import type { Structure, TileId, WorldState } from '@sj/engine/state'
import { GAMIFICATION_BAN } from './townStats.js'
import { AT_RADIUS_TILES, TERRAIN_WORDS, placeOf, structureWords } from './place.js'

const TILE: Record<string, TileId> = {
  grass: 0,
  dirt: 1,
  water: 2,
  forest: 3,
  rock: 4,
  sand: 5,
  farmland: 6,
  road: 7,
}
const TILE_IDS: TileId[] = [0, 1, 2, 3, 4, 5, 6, 7]

const N = 48
const flat = (t: TileId = 0): TileId[][] =>
  Array.from({ length: N }, () => Array.from({ length: N }, () => t))

function world(
  over: {
    terrain?: TileId[][]
    structures?: Structure[]
    agents?: Partial<{ id: string; name: string; x: number; y: number; insideId: string }>[]
  } = {},
): WorldState {
  const structures: Record<string, Structure> = {}
  for (const s of over.structures ?? []) structures[s.id] = s
  const agents: Record<string, unknown> = {}
  for (const a of over.agents ?? []) {
    agents[a.id!] = {
      id: a.id,
      name: a.name ?? a.id,
      x: a.x ?? 0,
      y: a.y ?? 0,
      alive: true,
      asleep: false,
      needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
      hp: 100,
      injuries: [],
      ill: false,
      ageDays: 30 * DAYS_PER_YEAR,
      skills: {},
      activity: null,
      collapsedSinceTick: null,
      zeroHungerSinceTick: null,
      ...(a.insideId === undefined ? {} : { insideId: a.insideId }),
    }
  }
  return {
    tick: 0,
    terrain: over.terrain ?? flat(),
    weather: { kind: 'sunny', temperatureC: 12 },
    agents: agents as WorldState['agents'],
    structures,
    items: {},
    crops: {},
    wildlife: { fish: 1, deer: 1 },
    counters: { nextEntityId: 1 },
  }
}

const struct = (
  over: Partial<Structure> & { id: string; kind: string; x: number; y: number },
): Structure => ({
  w: 1,
  h: 1,
  hp: 20,
  maxHp: 20,
  flammable: true,
  stage: 'complete',
  progressTicks: 0,
  builtBy: null,
  burning: false,
  burnTicks: 0,
  ...over,
})

// ── U12 requires WHERE THEY ARE on every roster row, and nothing in the product computed it ──
describe('placeOf — indoors', () => {
  const state = world({
    structures: [
      struct({ id: 'house_a', kind: 'house', x: 10, y: 10, w: 2, h: 2, owner: 'amara' }),
      struct({ id: 'store', kind: 'storehouse', x: 20, y: 20, w: 2, h: 2 }),
    ],
    agents: [
      { id: 'amara', name: 'Amara', x: 10, y: 10, insideId: 'house_a' },
      { id: 'omar', name: 'Omar', x: 20, y: 20, insideId: 'store' },
    ],
  })

  it('names an owned house with its owner, and a typographic apostrophe', () => {
    expect(placeOf(state, 'amara')).toEqual({ words: 'inside Amara’s house', kind: 'inside' })
    expect(placeOf(state, 'amara').words).toContain('’')
    expect(placeOf(state, 'amara').words).not.toContain("'")
  })

  it('names a public building by what it is', () => {
    expect(placeOf(state, 'omar')).toEqual({ words: 'inside the storehouse', kind: 'inside' })
  })

  it('a room that has vanished from under someone is not a crash', () => {
    const orphan = world({ agents: [{ id: 'ghost', x: 4, y: 4, insideId: 'gone' }] })
    expect(placeOf(orphan, 'ghost').kind).toBe('out')
  })
})

describe('placeOf — beside something', () => {
  const state = world({
    structures: [
      struct({ id: 'well', kind: 'well', x: 10, y: 10 }),
      struct({ id: 'house_y', kind: 'house', x: 30, y: 30, w: 2, h: 2, owner: 'yusuf' }),
    ],
    agents: [
      { id: 'a', x: 11, y: 10 },
      { id: 'b', x: 12, y: 10 },
      { id: 'c', x: 13, y: 10 },
      { id: 'yusuf', name: 'Yusuf', x: 30, y: 32 },
    ],
  })

  it('one tile and two tiles are AT the well; three tiles is not', () => {
    expect(AT_RADIUS_TILES).toBe(2)
    expect(placeOf(state, 'a')).toEqual({ words: 'at the well', kind: 'at' })
    expect(placeOf(state, 'b')).toEqual({ words: 'at the well', kind: 'at' })
    expect(placeOf(state, 'c').kind).not.toBe('at')
  })

  it('an owned building is somebody’s, and the preposition says so', () => {
    expect(placeOf(state, 'yusuf')).toEqual({ words: 'by Yusuf’s house', kind: 'at' })
  })

  it('a tie between two equidistant buildings resolves the same way twice', () => {
    const tied = world({
      structures: [
        struct({ id: 'zeta', kind: 'shed', x: 8, y: 10 }),
        struct({ id: 'alpha', kind: 'shed', x: 12, y: 10 }),
      ],
      agents: [{ id: 'a', x: 10, y: 10 }],
    })
    const first = placeOf(tied, 'a')
    expect(placeOf(tied, 'a')).toEqual(first)
    // by id, so a rename or a re-order can never move somebody
    expect(first.words).toBe('at the shed')
  })
})

describe('placeOf — the ground under them', () => {
  it('water-edge earth is the river bank', () => {
    const t = flat()
    t[20]![10] = TILE.water!
    t[20]![11] = TILE.dirt!
    expect(placeOf(world({ terrain: t, agents: [{ id: 'a', x: 11, y: 20 }] }), 'a')).toEqual({
      words: 'on the river bank',
      kind: 'on',
    })
  })

  it('dirt away from any water is just ground, not a bank', () => {
    const t = flat()
    t[20]![11] = TILE.dirt!
    expect(placeOf(world({ terrain: t, agents: [{ id: 'a', x: 11, y: 20 }] }), 'a').kind).toBe(
      'out',
    )
  })

  it('names the forest and the fields', () => {
    for (const [tile, words] of [
      [TILE.forest!, 'in the forest'],
      [TILE.farmland!, 'in the fields'],
    ] as const) {
      const t = flat()
      t[20]![11] = tile
      expect(placeOf(world({ terrain: t, agents: [{ id: 'a', x: 11, y: 20 }] }), 'a')).toEqual({
        words,
        kind: 'on',
      })
    }
  })

  it('open grass with nothing near is out past the edge of town', () => {
    expect(placeOf(world({ agents: [{ id: 'a', x: 5, y: 5 }] }), 'a')).toEqual({
      words: 'out past the edge of town',
      kind: 'out',
    })
  })

  it('TERRAIN_WORDS is total over TileId, and unnamed ground is null, not a word', () => {
    for (const t of TILE_IDS) expect(TERRAIN_WORDS[t], String(t)).not.toBeUndefined()
    expect(TERRAIN_WORDS[0]).toBeNull() // grass is just ground
    expect(TERRAIN_WORDS[1]).toBeNull() // and so is dirt, until the river is beside it
  })

  it('someone off the edge of the array does not throw', () => {
    expect(placeOf(world({ agents: [{ id: 'a', x: -4, y: 900 }] }), 'a').kind).toBe('out')
  })
})

describe('placeOf — nobody', () => {
  it('an unknown id is out of town rather than an exception', () => {
    expect(placeOf(world(), 'nobody')).toEqual({ words: 'out past the edge of town', kind: 'out' })
  })
})

describe('structureWords', () => {
  const state = world({ agents: [{ id: 'amara', name: 'Amara' }] })

  it('is the owner’s when it is owned and the kind’s when it is not', () => {
    expect(
      structureWords(state, struct({ id: 'h', kind: 'house', x: 0, y: 0, owner: 'amara' })),
    ).toBe('Amara’s house')
    expect(structureWords(state, struct({ id: 'w', kind: 'well', x: 0, y: 0 }))).toBe('the well')
  })

  it('never leaks a slug — a fire pit is two words and a standing stone is two more', () => {
    expect(structureWords(state, struct({ id: 'f', kind: 'fire_pit', x: 0, y: 0 }))).toBe(
      'the fire pit',
    )
    expect(structureWords(state, struct({ id: 's', kind: 'standing_stone', x: 0, y: 0 }))).toBe(
      'the standing stone',
    )
    expect(structureWords(state, struct({ id: 'x', kind: 'some_new_kind', x: 0, y: 0 }))).toBe(
      'the some new kind',
    )
  })
})

// ── THE REAL TOWN: 200 sampled positions on the task-59 template ──────────────────────────
describe('no output is ever machine vocabulary', () => {
  const ANCHOR = { x: 0, y: 9 } // gateway SHOWCASE_ANCHOR
  const structures = makeCityTemplate(ANCHOR).structures.map((s, i) =>
    struct({
      id: `structure_${s.kind}_${i}`,
      kind: s.kind,
      x: ANCHOR.x + s.dx,
      y: ANCHOR.y + s.dy,
      w: s.w,
      h: s.h,
      ...(s.owner === null ? {} : { owner: s.owner }),
    }),
  )
  const names = Object.fromEntries(
    FOUNDER_IDS.map((id) => [id, id[0]!.toUpperCase() + id.slice(1)]),
  )

  it('over 200 positions across the eleven-building town, says only words', () => {
    let sawAt = 0,
      sawOut = 0
    for (let i = 0; i < 200; i++) {
      const x = i % 40,
        y = 5 + ((i * 7) % 34)
      const t = flat()
      t[y]![x] = ((i * 3) % 8) as TileId
      const state = world({
        terrain: t,
        structures,
        agents: [
          { id: 'walker', name: 'Walker', x, y },
          ...FOUNDER_IDS.map((id) => ({ id, name: names[id]!, x: 0, y: 0 })),
        ],
      })
      const p = placeOf(state, 'walker')
      expect(p.words, `${x},${y}`).not.toMatch(/\d/)
      expect(p.words, `${x},${y}`).not.toMatch(/_/)
      expect(p.words, `${x},${y}`).not.toContain('structure_')
      expect(p.words, `${x},${y}`).not.toMatch(GAMIFICATION_BAN)
      expect(p.words.length).toBeGreaterThan(4)
      if (p.kind === 'at') sawAt += 1
      if (p.kind === 'out') sawOut += 1
    }
    // the sample really does walk both through the town and past its edge
    expect(sawAt).toBeGreaterThan(0)
    expect(sawOut).toBeGreaterThan(0)
  })
})
