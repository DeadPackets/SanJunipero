import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, type TileId } from '@sj/engine'
import { DEFAULT_CONFIG, T_GRASS, T_WATER } from '@sj/shared'
import { perceptionToProse, placesKnownLine } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import type { EngineBridge, SubmitResult } from '../runtime/bridge.js'

// The ring-1 showcase ground, measured off `showcaseTerrain()`: a 76x76 map whose (0, 0) sits at
// authored (35, 48), and whose channel is three columns of water 60 tiles long. It stops eight
// tiles short of the map's south edge, which is the whole of why the southwest corner refused.
const SPAN = 76
const ORIGIN = { x: 35, y: 48 }
const CHANNEL = { x0: 13, x1: 15, y0: 8, y1: 67 }
const BANK = { x: 12, y: 40 }
const DRY = { x: 2, y: 40 }
const BELOW_THE_END = { x: 2, y: 70 }

const AGENT = 'tamar'
const BUCKET = 'item_bucket'

type Town = { bridge: EngineBridge; step: () => void }

function valley(at: { x: number; y: number }, opts: { bucket?: boolean } = {}): Town {
  const terrain: TileId[][] = Array.from({ length: SPAN }, (_, y) =>
    Array.from({ length: SPAN }, (_, x): TileId =>
      x >= CHANNEL.x0 && x <= CHANNEL.x1 && y >= CHANNEL.y0 && y <= CHANNEL.y1 ? T_WATER : T_GRASS,
    ),
  )
  const store = new EventStore(openDb(':memory:'))
  let state = { ...genesisState(DEFAULT_CONFIG, terrain), origin: ORIGIN }
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), DEFAULT_CONFIG)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: at.x, y: at.y, ageDays: 7300 })
  if (opts.bucket === true) {
    put('item_spawned', { id: BUCKET, kind: 'bucket', qty: 1, loc: { t: 'agent', id: AGENT } })
  }
  const { bridge, loop } = wireTown({ state, store, seed: 'water', startTick: 720 })
  return {
    bridge,
    step: () => {
      loop.step()
    },
  }
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
    waterAtHand: () => bridge.waterAtHand(AGENT),
    nearestWater: (x, y) => bridge.nearestWater(x, y),
    distantWater: (x, y) => bridge.distantWater(x, y),
  })

const placesFor = (bridge: EngineBridge): string =>
  placesKnownLine(bridge.knownPlaces(AGENT), bridge.perception(AGENT))

async function refusal(
  t: Town,
  intent: { verb: string; params: Record<string, unknown> },
): Promise<string> {
  const submitted = t.bridge.submit(AGENT, intent)
  t.step()
  const result: SubmitResult = await submitted
  return result.ok ? 'the world allowed it' : result.reason
}

describe('the water a body can and cannot reach is said before the turn is spent', () => {
  it('at the bank the hands are told they are at water, whatever the throat says', () => {
    const t = valley(BANK)
    expect(t.bridge.waterAtHand(AGENT)).toBe(true)
    const said = proseFor(t.bridge)
    expect(said).toContain('Water lies within reach of your hands')
    expect(said).not.toContain('No water is within reach')
  })

  // The Places block reads the river as somewhere to go while the body stands on its bank, and
  // `walk {river}` lands on the tile under the feet. The in-reach line is what tells them apart.
  it('at the bank the walk the places block invites is the one the world refuses', async () => {
    const t = valley(BANK)
    expect(placesFor(t.bridge)).toContain('the river (river)')
    expect(await refusal(t, { verb: 'walk', params: { structureId: 'river' } })).toBe(
      'already at that spot',
    )
    expect(proseFor(t.bridge)).toContain('Water lies within reach of your hands')
  })

  it('on dry ground a mind with a vessel is told the water is not here, and where it is', () => {
    const said = proseFor(valley(DRY, { bucket: true }).bridge)
    expect(said).toContain('No water is within reach of your hands')
    expect(said).toContain('The nearest water you know of lies at (13, 40)')
  })

  // Below the channel's southern end `naturalPlaces` finds no river abreast of the body, so the
  // places block is empty and `walk {river}` is "you know no such place". The prose said nothing
  // about water at all: three minds spent run B here, and 105 refusals came of it (rehearsal5).
  it('below the end of the river the mind is no longer told the valley has none', async () => {
    const t = valley(BELOW_THE_END, { bucket: true })
    expect(placesFor(t.bridge)).toBe('')
    expect(await refusal(t, { verb: 'walk', params: { structureId: 'river' } })).toBe(
      'you know no such place',
    )
    const said = proseFor(t.bridge)
    expect(said).toContain('No water is within reach of your hands')
    expect(said).toContain('The nearest water you know of lies at (13, 67)')
  })

  it('empty hands and a wet throat say nothing about water on dry ground', () => {
    const said = proseFor(valley(DRY).bridge)
    expect(said).not.toContain('water')
    expect(said).not.toContain('Water')
  })

  it('the refusal and where the body actually stands reach the mind together', async () => {
    const t = valley(BELOW_THE_END, { bucket: true })
    expect(await refusal(t, { verb: 'fill', params: { itemId: BUCKET } })).toBe(
      'no water within reach',
    )
    expect(proseFor(t.bridge)).toContain('No water is within reach of your hands')
  })
})
