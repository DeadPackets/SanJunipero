import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { doorTile, fold, genesisState, type TileId } from '@sj/engine'
import { DEFAULT_CONFIG, scanPromptForGlassLeak } from '@sj/shared'
import { perceptionToProse } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import type { EngineBridge, SubmitResult } from '../runtime/bridge.js'

// The five refusals that took 41% of run B's turns (~/handoff/cleanup/rehearsal4). Each is a
// fact the body already had and the prose never said, so the mind guessed and paid for the
// guess. One world per class: the engine refuses the guess, and the block states the fact.
const AGENT = 'tamar'
const HOUSE = 'structure_1'
const BREAD = 'item_bread'

type Town = { bridge: EngineBridge; step: () => void; door: { x: number; y: number } }

function town(opts: { indoors?: boolean; sheds?: number } = {}): Town {
  const config = DEFAULT_CONFIG
  const terrain: TileId[][] = Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 10, y: 10, ageDays: 7300 })
  put('structure_planned', {
    id: HOUSE,
    kind: 'house',
    x: 5,
    y: 5,
    w: 2,
    h: 2,
    maxHp: 50,
    flammable: true,
    builderId: AGENT,
  })
  put('structure_completed', { id: HOUSE })
  put('item_spawned', { id: BREAD, kind: 'bread', qty: 1, loc: { t: 'tile', x: 10, y: 11 } })
  for (let i = 0; i < (opts.sheds ?? 0); i++) {
    put('structure_planned', {
      id: `shed_${i}`,
      kind: 'shed',
      x: 9 + i,
      y: 12,
      w: 1,
      h: 1,
      maxHp: 20,
      flammable: true,
      builderId: AGENT,
    })
    put('structure_completed', { id: `shed_${i}` })
  }
  const door = doorTile(state, state.structures[HOUSE]!)!
  if (opts.indoors === true) {
    put('agent_moved', { id: AGENT, x: door.x, y: door.y })
    put('agent_entered', { agentId: AGENT, structureId: HOUSE })
  }
  // Noon: the house is inside the sight horizon.
  const { bridge, loop } = wireTown({ state, store, seed: 'affordance', startTick: 720 })
  return {
    bridge,
    step: () => {
      loop.step()
    },
    door,
  }
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
  })

async function refusal(
  t: Town,
  intent: { verb: string; params: Record<string, unknown> },
): Promise<string> {
  const submitted = t.bridge.submit(AGENT, intent)
  t.step()
  const result: SubmitResult = await submitted
  return result.ok ? 'the world allowed it' : result.reason
}

describe('the affordance block says what the validators would otherwise refuse', () => {
  // The block still steers a mind off the wasted intent; the world no longer spends a turn
  // refusing one, because the body is already standing where it was sent.
  it('the tile under the feet is named as no destination, and costs nothing when named anyway', async () => {
    const t = town()
    expect(await refusal(t, { verb: 'walk', params: { x: 10, y: 10 } })).toBe(
      'the world allowed it',
    )
    expect(proseFor(t.bridge)).toContain('a walk to (10, 10) goes nowhere: you already stand there')
  })

  it('open sky is said, not left to be inferred — and stepping out of it costs nothing', async () => {
    const t = town()
    expect(await refusal(t, { verb: 'exit', params: {} })).toBe('the world allowed it')
    expect(proseFor(t.bridge)).toContain('No walls are around you: there is nothing to step out of')
  })

  it('the roof overhead is said to bar every other one, and entering it again is over at once', async () => {
    const t = town({ indoors: true })
    expect(await refusal(t, { verb: 'enter', params: { structureId: HOUSE } })).toBe(
      'the world allowed it',
    )
    expect(proseFor(t.bridge)).toContain(
      `Four walls are around you: while you are inside the house (${HOUSE}) you can walk nowhere and enter nothing, and the doorway at (${t.door.x}, ${t.door.y}) is the way back out under the sky.`,
    )
  })

  it('`no path to that spot` — the wall the prose names as a place is named as no footing', async () => {
    const t = town()
    expect(await refusal(t, { verb: 'walk', params: { x: 5, y: 5 } })).toBe('no path to that spot')
    const said = proseFor(t.bridge)
    expect(said).toContain(`A house (${HOUSE}) stands at (5, 5)`)
    expect(said).toContain('Wall or water covers (5, 5); no walk of yours can end there.')
  })

  it('`not holding that` — what the hands can touch is told apart from what they hold', async () => {
    const t = town()
    expect(await refusal(t, { verb: 'stow', params: { itemId: BREAD, structureId: HOUSE } })).toBe(
      'not holding that',
    )
    expect(proseFor(t.bridge)).toContain(
      `Your hands are empty; close enough for them to touch, but not yet in them: 1 bread (${BREAD}).`,
    )
    expect(proseFor(town({ indoors: true }).bridge)).toContain(
      'Your hands are empty; nothing is close enough for them to touch.',
    )
  })

  it('and once the taking is done the same bread is said to be held', async () => {
    const t = town()
    expect(await refusal(t, { verb: 'take', params: { itemId: BREAD } })).toBe(
      'the world allowed it',
    )
    for (let i = 0; i < 20; i++) t.step()
    expect(proseFor(t.bridge)).toContain(
      `Your hands hold 1 bread (${BREAD}); nothing else is close enough for them to touch.`,
    )
  })

  it('the block is two sentences however crowded the square, and the barred spots are capped', () => {
    const said = proseFor(town({ sheds: 6 }).bridge)
    const block = said
      .split(/(?<=\.)\s+/)
      .filter((s) => /^(No walls are|Four walls are|Your hands )/.test(s))
    expect(block).toHaveLength(2)
    const barred = /Wall or water covers ([^;]+);/.exec(said)![1]!
    expect(barred.match(/\(\d+, \d+\)/g)).toHaveLength(4)
  })

  it('every fixture reads clean through the one-way glass', () => {
    expect(scanPromptForGlassLeak(proseFor(town({ sheds: 6 }).bridge))).toEqual([])
    expect(scanPromptForGlassLeak(proseFor(town({ indoors: true }).bridge))).toEqual([])
  })
})
