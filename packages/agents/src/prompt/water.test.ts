import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, type TickLoop, type TileId, type WorldState } from '@sj/engine'
import { DEFAULT_CONFIG, T_GRASS, T_WATER } from '@sj/shared'
import { perceptionToProse, placesKnownLine } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import { lastTurnLine, wantedWater } from '../runtime/agentRuntime.js'
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

type Town = { bridge: EngineBridge; loop: TickLoop; step: () => void }

function valley(at: { x: number; y: number }, opts: { bucket?: boolean } = {}): Town {
  const terrain: TileId[][] = Array.from({ length: SPAN }, (_, y) =>
    Array.from(
      { length: SPAN },
      (_, x): TileId =>
        x >= CHANNEL.x0 && x <= CHANNEL.x1 && y >= CHANNEL.y0 && y <= CHANNEL.y1
          ? T_WATER
          : T_GRASS,
    ),
  )
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = { ...genesisState(DEFAULT_CONFIG, terrain), origin: ORIGIN }
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
    loop,
    step: () => {
      loop.step()
    },
  }
}

const thirsty = (t: Town): Town => {
  t.loop.state.agents[AGENT]!.thirst = 10
  return t
}

const proseFor = (t: Town, lastOutcome = ''): string =>
  perceptionToProse(t.bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => t.bridge.isWalkable(x, y),
    isEdible: (kind) => t.bridge.isEdible(kind),
    waterAtHand: () => t.bridge.waterAtHand(AGENT),
    nearestWater: (x, y) => t.bridge.nearestWater(x, y),
    distantWater: (x, y) => t.bridge.distantWater(x, y),
    waterRefused: () => wantedWater(lastOutcome),
  })

const placesFor = (t: Town): string =>
  placesKnownLine(t.bridge.knownPlaces(AGENT), t.bridge.perception(AGENT))

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
    const said = proseFor(t)
    expect(said).toContain('Water lies within reach of your hands')
    expect(said).not.toContain('No water is within reach')
  })

  // The places block reads the river as somewhere to go while the body stands on its bank, and
  // the walk lands on the tile under the feet. The in-reach line is the one thing that tells a
  // mind it has already arrived.
  it('at the bank the walk the places block invites changes nothing', async () => {
    const t = valley(BANK)
    expect(placesFor(t)).toContain('the river (river)')
    expect(await refusal(t, { verb: 'walk', params: { structureId: 'river' } })).toBe(
      'the world allowed it',
    )
    expect(t.loop.state.agents[AGENT]).toMatchObject(BANK)
    expect(proseFor(t)).toContain('Water lies within reach of your hands')
  })

  it('on dry ground a dry throat is told the water is not here, and which way it is', () => {
    const said = proseFor(thirsty(valley(DRY)))
    expect(said).toContain('No water is within reach of your hands')
    expect(said).toContain('The nearest water you know of lies at (13, 40), a way to the east.')
  })

  // Below the channel's southern end the river is offered off its nearest end, so the places
  // block names it — but a name is not a reach, and `fill` and `fish` are refused for the reach.
  // Omar, run B, from this corner: "The glint's a step west, at (0,64)." The water is east; 84 of
  // world B's 105 water refusals were fired from 11 to 13 tiles out, where the glint is
  // suppressed for being inside the sight box and the coordinate was gated behind thirst.
  it('below the end of the river the water is given a coordinate, not only a name', () => {
    const t = valley(BELOW_THE_END)
    expect(placesFor(t)).toContain('the river (river)')
    const said = proseFor(thirsty(t))
    expect(said).toContain('No water is within reach of your hands')
    expect(said).toContain('The nearest water you know of lies at (13, 67), a way to the east.')
    expect(said).not.toContain('west')
  })

  it('a wet throat and nothing refused says nothing about water on dry ground', () => {
    const said = proseFor(valley(DRY))
    expect(said).not.toContain('water')
    expect(said).not.toContain('Water')
  })

  // Since the settle policy, a fill named within a walk of the bank is the walk and the fill,
  // not a refusal to explain: the body ends the episode standing at the water.
  it('a fill named below the end walks the body to the bank and fills there', async () => {
    const t = valley(BELOW_THE_END, { bucket: true })
    expect(await refusal(t, { verb: 'fill', params: { itemId: BUCKET } })).toBe(
      'the world allowed it',
    )
    expect(t.loop.state.agents[AGENT]!.activity).toMatchObject({ then: { verb: 'fill' } })
    for (let i = 0; i < 200 && t.loop.state.agents[AGENT]!.activity !== null; i++) t.step()
    expect(t.bridge.waterAtHand(AGENT)).toBe(true)
    expect(proseFor(t)).toContain('Water lies within reach of your hands')
  })

  it('water past all reach is still refused, with the state beside the reason', async () => {
    const t = valley({ x: 40, y: 40 }, { bucket: true })
    const reason = await refusal(t, { verb: 'fill', params: { itemId: BUCKET } })
    expect(reason).toBe('no water within reach')
    expect(proseFor(t, lastTurnLine('fill', reason))).toContain(
      'No water is within reach of your hands',
    )
  })

  // Omar cast at dry ground 37 times in run B. A cast wants neither a vessel nor a dry throat,
  // so the reason alone came back turn after turn with no state beside it to answer it.
  it('a cast at dry ground walks to the water instead of coming back a reason', async () => {
    const t = valley(BELOW_THE_END)
    expect(proseFor(t)).not.toContain('water')
    expect(await refusal(t, { verb: 'fish', params: { x: 2, y: 71 } })).toBe(
      'the world allowed it',
    )
    for (let i = 0; i < 200 && t.loop.state.agents[AGENT]!.activity !== null; i++) t.step()
    expect(t.bridge.waterAtHand(AGENT)).toBe(true)
  })
})
