import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { doorTile, insideOf, sameInterior } from './interiors.js'
import { RngStream } from './rng.js'
import { VERBS } from './verbs/index.js'

const RNG = RngStream.seed('interiors-test', 'actions')

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick: 0,
  type,
  payload,
})

const OPEN = ['........', '........', '........', '........', '........', '........']

function world(rows: string[] = OPEN, config = DEFAULT_CONFIG): WorldState {
  return genesisState(
    config,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
}

// A complete 2x2 house at (2,1): footprint rows 1-2, cols 2-3; door lands at (2,3).
function withHouse(
  s: WorldState,
  kind = 'house',
  stage: 'construction' | 'complete' = 'complete',
): WorldState {
  let out = fold(
    s,
    ev(1, 'structure_planned', {
      id: 'structure_1',
      kind,
      x: 2,
      y: 1,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: 'a1',
    }),
  )
  if (stage === 'complete') out = fold(out, ev(2, 'structure_completed', { id: 'structure_1' }))
  return out
}

function withAgent(s: WorldState, id: string, x: number, y: number): WorldState {
  return fold(s, ev(10, 'agent_spawned', { id, name: id, x, y, ageDays: 7300 }))
}

describe('doorTile', () => {
  it('is the tile south of the footprint centre', () => {
    const s = withHouse(world())
    expect(doorTile(s, s.structures.structure_1!)).toEqual({ x: 2, y: 3 })
  })

  it('falls back clockwise when the south centre is impassable', () => {
    // Water across the whole southern approach: the ring scan walks on to the left column.
    const s = withHouse(
      world(['........', '........', '........', '~~~~~~~~', '........', '........']),
    )
    expect(doorTile(s, s.structures.structure_1!)).toEqual({ x: 1, y: 2 })
  })

  it('is null when no perimeter tile is passable', () => {
    const s = withHouse(
      world(['.~~~~...', '.~..~...', '.~..~...', '.~~~~...', '........', '........']),
    )
    expect(doorTile(s, s.structures.structure_1!)).toBeNull()
  })
})

describe('enter / exit', () => {
  it('round-trips insideId and parks the body on the door tile', () => {
    let s = withAgent(withHouse(world()), 'a1', 4, 4)
    // Stand within reach of the door at (2,3).
    s = fold(s, ev(11, 'agent_moved', { id: 'a1', x: 3, y: 4 }))
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'enter', { structureId: 'structure_1' })
    expect(r.ok).toBe(true)
    expect(insideOf(s, 'a1')).toBeNull()

    s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    s = fold(s, ev(13, 'agent_moved', { id: 'a1', x: 2, y: 3 }))
    expect(insideOf(s, 'a1')).toBe('structure_1')
    expect(s.agents.a1!.insideId).toBe('structure_1')
    expect([s.agents.a1!.x, s.agents.a1!.y]).toEqual([2, 3])

    s = fold(s, ev(14, 'agent_exited', { agentId: 'a1', structureId: 'structure_1' }))
    expect(insideOf(s, 'a1')).toBeNull()
    expect(s.agents.a1!).not.toHaveProperty('insideId')
  })

  it('enter emits the move to the door then the entry', () => {
    const s = withAgent(withHouse(world()), 'a1', 3, 4)
    expect(
      VERBS.enter!.onComplete(s, DEFAULT_CONFIG, 'a1', { structureId: 'structure_1' }, RNG),
    ).toEqual([
      { type: 'agent_moved', payload: { id: 'a1', x: 2, y: 3 } },
      { type: 'agent_entered', payload: { agentId: 'a1', structureId: 'structure_1' } },
    ])
  })

  it('exit emits the exit event', () => {
    let s = withAgent(withHouse(world()), 'a1', 2, 3)
    s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(VERBS.exit!.onComplete(s, DEFAULT_CONFIG, 'a1', {}, RNG)).toEqual([
      { type: 'agent_exited', payload: { agentId: 'a1', structureId: 'structure_1' } },
    ])
  })

  it('refuses a construction site, an unenterable kind, out of reach, and a second entry', () => {
    const site = withAgent(withHouse(world(), 'house', 'construction'), 'a1', 3, 4)
    expect(
      submitIntent(site, DEFAULT_CONFIG, 'a1', 'enter', { structureId: 'structure_1' }),
    ).toMatchObject({ ok: false, reason: 'it is not finished' })

    const stone = withAgent(withHouse(world(), 'standing_stone'), 'a1', 3, 4)
    expect(
      submitIntent(stone, DEFAULT_CONFIG, 'a1', 'enter', { structureId: 'structure_1' }),
    ).toMatchObject({ ok: false, reason: 'a standing stone has no roof to get under' })

    const far = withAgent(withHouse(world()), 'a1', 7, 5)
    expect(
      submitIntent(far, DEFAULT_CONFIG, 'a1', 'enter', { structureId: 'structure_1' }),
    ).toMatchObject({ ok: false, reason: 'not close enough to the door' })

    let inside = withAgent(withHouse(world()), 'a1', 2, 3)
    inside = fold(inside, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(
      submitIntent(inside, DEFAULT_CONFIG, 'a1', 'enter', { structureId: 'structure_1' }),
    ).toMatchObject({ ok: true })
    expect(
      submitIntent(withAgent(withHouse(world()), 'a1', 3, 4), DEFAULT_CONFIG, 'a1', 'exit', {}),
    ).toMatchObject({ ok: true })
  })

  it('walk is refused while indoors', () => {
    let s = withAgent(withHouse(world()), 'a1', 2, 3)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 5, y: 5 }).ok).toBe(true)
    s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 5, y: 5 })).toMatchObject({
      ok: false,
      reason: 'you are indoors; step outside first',
    })
  })
})

describe('sameInterior', () => {
  it('pairs co-occupants and pairs the outdoors, never across a wall', () => {
    let s = withAgent(withAgent(withHouse(world()), 'a1', 2, 3), 'a2', 3, 3)
    s = withAgent(s, 'a3', 6, 5)
    expect(sameInterior(s, 'a1', 'a3')).toBe(true) // both outside
    s = fold(s, ev(20, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(sameInterior(s, 'a1', 'a3')).toBe(false)
    s = fold(s, ev(21, 'agent_entered', { agentId: 'a2', structureId: 'structure_1' }))
    expect(sameInterior(s, 'a1', 'a2')).toBe(true)
  })
})

describe('destruction ejects occupants', () => {
  it('fold refuses to destroy a structure with someone still inside', () => {
    let s = withAgent(withHouse(world()), 'a1', 2, 3)
    s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(() => fold(s, ev(13, 'structure_destroyed', { id: 'structure_1' }))).toThrow(/occupant/i)
    expect(() => fold(s, ev(13, 'structure_damaged', { id: 'structure_1', amount: 999 }))).toThrow(
      /occupant/i,
    )
    const out = fold(s, ev(13, 'agent_exited', { agentId: 'a1', structureId: 'structure_1' }))
    expect(
      Object.keys(fold(out, ev(14, 'structure_destroyed', { id: 'structure_1' })).structures),
    ).toEqual([])
  })
})

describe('sleep is indoors-only (C9 T2b)', () => {
  const OUTDOORS =
    'there is nothing over you here; find somewhere to lie down — weary enough and the bare ground will do'

  it('refuses a bed under the sky, allows one inside a house', () => {
    let s = withAgent(withHouse(world()), 'a1', 2, 3)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {})).toMatchObject({
      ok: false,
      reason: OUTDOORS,
    })
    s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {}).ok).toBe(true)
  })

  // sleepableKinds used to say `house` and nothing else, so a body standing dry inside a
  // storehouse was refused a bed and walked back into the weather. Anything with a roof will do.
  it('checks the roof, not the owner — a storehouse and a cottage both do', () => {
    for (const kind of ['storehouse', 'cottage', 'cabin', 'farmhouse']) {
      let s = withAgent(withHouse(world(), kind), 'a1', 2, 3)
      s = fold(s, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
      expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {}).ok, kind).toBe(true)
    }
    // A thing with no roof over it is still not a bed, however close you stand to it.
    let bare = withAgent(withHouse(world(), 'well'), 'a1', 2, 3)
    bare = fold(bare, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(submitIntent(bare, DEFAULT_CONFIG, 'a1', 'sleep', {})).toMatchObject({
      ok: false,
      reason: OUTDOORS,
    })

    // Another agent's house is a legal bed: ownership is witnessed, never enforced.
    let owned = fold(
      world(),
      ev(1, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a2',
        owner: 'a2',
      }),
    )
    owned = fold(owned, ev(2, 'structure_completed', { id: 'structure_1' }))
    owned = withAgent(owned, 'a1', 2, 3)
    owned = fold(owned, ev(12, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(submitIntent(owned, DEFAULT_CONFIG, 'a1', 'sleep', {}).ok).toBe(true)
  })

  it('a body weary enough to stumble may lie down under the sky', () => {
    let s = withAgent(withHouse(world()), 'a1', 2, 3)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {})).toMatchObject({
      ok: false,
      reason: OUTDOORS,
    })
    s = fold(s, ev(12, 'needs_changed', { id: 'a1', changes: [{ need: 'energy', delta: -75 }] }))
    expect(s.agents.a1!.needs.energy).toBeLessThan(DEFAULT_CONFIG.needs.debuffThreshold)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {}).ok).toBe(true)
  })

  it('a collapsed body sleeps where it fell', () => {
    let s = withAgent(withHouse(world()), 'a1', 6, 5)
    s = fold(s, { seq: 12, tick: 4, type: 'agent_collapsed', payload: { agentId: 'a1' } })
    expect(s.agents.a1!.collapsedSinceTick).toBe(4)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'sleep', {}).ok).toBe(true)
  })

  it('the flag turns the law off entirely', () => {
    const off = SimConfigSchema.parse({ structures: { sleepIndoorsOnly: false } })
    const s = withAgent(withHouse(world(), 'house', 'complete'), 'a1', 6, 5)
    expect(submitIntent(s, off, 'a1', 'sleep', {}).ok).toBe(true)
  })
})

describe('structure ownership (deep-world POST-REVIEW RULING 1)', () => {
  it('is absent until set — public by default', () => {
    const s = withHouse(world())
    expect(s.structures.structure_1!).not.toHaveProperty('owner')
  })

  it('the builder owns what they build, and the flag governs it', () => {
    const owned = fold(
      world(),
      ev(1, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
        owner: 'a1',
      }),
    )
    expect(owned.structures.structure_1!.owner).toBe('a1')

    const s = withAgent(world(), 'a1', 2, 4)
    const built = VERBS.build!.onStart!(s, DEFAULT_CONFIG, 'a1', { kind: 'house', x: 2, y: 2 })
    expect(built.at(-1)).toMatchObject({ type: 'structure_planned', payload: { owner: 'a1' } })

    const off = SimConfigSchema.parse({ ownership: { enabled: false } })
    const plain = VERBS.build!.onStart!(s, off, 'a1', { kind: 'house', x: 2, y: 2 })
    expect((plain.at(-1)!.payload as Record<string, unknown>).owner).toBeUndefined()
  })
})
