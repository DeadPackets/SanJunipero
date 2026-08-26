import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStream } from './rng.js'
import { VERBS } from './verbs.js'

// `stow` is the inverse of `take`: it closes the "no way yet to shelve what you hold" gap.

const RNG = RngStream.seed('stow-test', 'actions')
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const OPEN = ['........', '........', '........', '........', '........', '........']

// A 2x2 storehouse at (2,1); its door is the tile south of centre, (2,3).
function world(stage: 'construction' | 'complete' = 'complete', kind = 'storehouse'): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    OPEN.map((row) => [...row].map((): TileId => 0)),
  )
  s = fold(
    s,
    ev('structure_planned', {
      id: 'structure_1',
      kind,
      x: 2,
      y: 1,
      w: 2,
      h: 2,
      maxHp: 20,
      flammable: true,
      builderId: 'a1',
    }),
  )
  if (stage === 'complete') s = fold(s, ev('structure_completed', { id: 'structure_1' }))
  return s
}

function withHolder(s: WorldState, x: number, y: number, owner = 'a1'): WorldState {
  const spawned = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x, y, ageDays: 7300 }))
  return fold(
    spawned,
    ev('item_spawned', {
      id: 'item_1',
      kind: 'bread',
      qty: 1,
      loc: { t: 'agent', id: 'a1' },
      owner,
    }),
  )
}

const goInside = (s: WorldState, structureId = 'structure_1'): WorldState =>
  fold(
    fold(s, ev('agent_moved', { id: 'a1', x: 2, y: 3 })),
    ev('agent_entered', { agentId: 'a1', structureId }),
  )

const MOVED = {
  type: 'item_moved',
  payload: { id: 'item_1', loc: { t: 'structure', id: 'structure_1' } },
}

describe('verb: stow', () => {
  it('shelves a held thing from just outside the wall', () => {
    const s = withHolder(world(), 4, 2)
    expect(
      submitIntent(s, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_1',
      }).ok,
    ).toBe(true)
    expect(
      VERBS.stow!.onComplete(
        s,
        DEFAULT_CONFIG,
        'a1',
        { itemId: 'item_1', structureId: 'structure_1' },
        RNG,
      ),
    ).toEqual([MOVED])
  })

  it('shelves it from inside too', () => {
    const s = goInside(withHolder(world(), 2, 4))
    expect(
      submitIntent(s, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_1',
      }).ok,
    ).toBe(true)
    expect(
      VERBS.stow!.onComplete(
        s,
        DEFAULT_CONFIG,
        'a1',
        { itemId: 'item_1', structureId: 'structure_1' },
        RNG,
      ),
    ).toEqual([MOVED])
  })

  it('leaves ownership exactly where it was — a shelf is not a transfer', () => {
    const s = withHolder(world(), 4, 2, 'a2')
    const after = VERBS.stow!.onComplete(
      s,
      DEFAULT_CONFIG,
      'a1',
      { itemId: 'item_1', structureId: 'structure_1' },
      RNG,
    ).reduce((acc, e) => fold(acc, ev(e.type, e.payload)), s)
    expect(after.items.item_1!).toMatchObject({
      owner: 'a2',
      loc: { t: 'structure', id: 'structure_1' },
    })
  })

  it('refuses a building that is still going up', () => {
    const s = withHolder(world('construction'), 4, 2)
    expect(
      submitIntent(s, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_1',
      }),
    ).toMatchObject({ ok: false, reason: 'it is not finished' })
  })

  it('refuses out of reach, and refuses what you are not holding', () => {
    expect(
      submitIntent(withHolder(world(), 6, 5), DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_1',
      }),
    ).toMatchObject({ ok: false, reason: 'not close enough to put anything down there' })

    let s = withHolder(world(), 4, 2)
    s = fold(s, ev('item_moved', { id: 'item_1', loc: { t: 'tile', x: 4, y: 2 } }))
    expect(
      submitIntent(s, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_1',
      }),
    ).toMatchObject({ ok: false, reason: 'not holding that' })

    expect(
      submitIntent(withHolder(world(), 4, 2), DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'ghost',
        structureId: 'structure_1',
      }),
    ).toMatchObject({ ok: false, reason: 'not holding that' })
    expect(
      submitIntent(withHolder(world(), 4, 2), DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'ghost',
      }),
    ).toMatchObject({ ok: false, reason: 'there is nothing there to put it in' })
    expect(
      submitIntent(withHolder(world(), 4, 2), DEFAULT_CONFIG, 'a1', 'stow', { itemId: 'item_1' }),
    ).toMatchObject({ ok: false, reason: 'stow needs {itemId, structureId}' })
  })

  it('a wall stops hands — indoors you can only shelve the room you are in', () => {
    let s = withHolder(world(), 2, 4)
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_2',
        kind: 'storehouse',
        x: 5,
        y: 1,
        w: 1,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: 'a1',
      }),
    )
    s = fold(s, ev('structure_completed', { id: 'structure_2' }))
    s = goInside(s)
    expect(
      submitIntent(s, DEFAULT_CONFIG, 'a1', 'stow', {
        itemId: 'item_1',
        structureId: 'structure_2',
      }),
    ).toMatchObject({ ok: false, reason: 'a wall is in the way' })
  })

  it('is a registered Tier-1 verb', () => {
    expect(VERBS.stow).toBeDefined()
  })
})
