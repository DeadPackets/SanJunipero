import { describe, it, expect } from 'vitest'
import {
  createWorldTick, doorTile, EventStore, fold, genesisState, makeGenesisWorld, openDb,
  RngStreams, TickLoop, warmthTargetFor, type LawQueue, type TickHandler, type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { EngineBridge } from '../runtime/bridge.js'
import { scanForLayoutLeak, scanPromptForGlassLeak } from './glassScan.js'
import { CAPABILITIES } from './rulesOfBeing.js'
import { perceptionToProse } from './prose.js'

// ★ THE ROOM A MIND COULD NOT SEE INTO — INCLUDING THE ONE IT WAS STANDING IN.
//
// Five furnishings stand in every house the town has ever raised. Nothing a mind ever read
// said one of them was there. `PerceivedInterior` was `{ id, kind }` — a roof and a word for
// it — so a body walked to the hearth and there was nothing it could do at it, and no sentence
// that said it was a hearth.
//
// The pair below is the whole lesson, and it is the same shape the cold's pair is: the room
// with a fire in it and the room without, read off the same body on the same night.

const CFG = DEFAULT_CONFIG

const WORLD = {
  isWalkable: () => true,
  isEdible: () => false,
  waterAtHand: () => false,
  nearestWater: () => null,
  nearestFood: () => null,
}

// The genesis valley, wired through a real bridge — the same object the runtime reads packets
// from, so nothing here is a hand-built fixture. Amara is put at the cabin's door with wood in
// hand; the cabin is one of the two roofs the ruling left standing, and it is 2x2 like a house.
function town(startTick: number): { bridge: EngineBridge; loop: TickLoop; homeId: string } {
  const db = openDb(':memory:')
  const g = makeGenesisWorld(CFG)
  const store = new EventStore(db)
  const rng = new RngStreams('hearth-prose')
  let state: WorldState = genesisState(CFG, g.terrain)
  for (const e of g.events) state = fold(state, store.append(state.tick, e.type, e.payload), CFG)
  // A finished house is what has a hearth in it. The valley's own houses stand roofless, so one
  // is completed here — the same thing a night of five pairs of hands does.
  const house = Object.values(state.structures).find((s) => s.kind === 'house')!
  state = fold(state, store.append(state.tick, 'structure_completed', { id: house.id }), CFG)
  const door = doorTile(state, state.structures[house.id]!)!
  state = fold(state, store.append(state.tick, 'agent_spawned',
    { id: 'amara', name: 'amara', x: door.x, y: door.y, ageDays: 30 * 364, sex: 'f' }), CFG)
  state = fold(state, store.append(state.tick, 'item_spawned',
    { id: 'wood_1', kind: 'wood', qty: 4, loc: { t: 'agent', id: 'amara' }, owner: 'amara' }), CFG)
  const lawQueue: LawQueue = []
  const worldTick = createWorldTick(CFG, rng, lawQueue)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config: CFG, startTick, realMsPerTick: 0, onTick: (c) => handler(c) })
  const bridge = new EngineBridge({ loop, store, simConfig: CFG })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, loop, homeId: house.id }
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception('amara'), () => {}, WORLD)

const NIGHT = 21 * 60

describe('★ a mind reads the fire in the room it is standing in', () => {
  it('the pair: a cold hearth and a burning one, off the same body on the same night', () => {
    const { bridge, loop, homeId } = town(NIGHT - 3)
    void bridge.submit('amara', { verb: 'enter', params: { structureId: homeId } })
    loop.step()
    loop.step()
    expect(proseFor(bridge)).toContain('The hearth here is cold.')

    void bridge.submit('amara', { verb: 'stoke', params: { structureId: homeId } })
    loop.step()
    loop.step()
    const lit = proseFor(bridge)
    expect(lit).toContain('A fire is burning in the hearth here.')
    expect(lit).not.toContain('The hearth here is cold.')
  })

  // Twenty past the hour, and four steps: no hour boundary rolls the sky under the measurement.
  it('the fire is worth a measurable number on the body, not only a sentence', () => {
    const { bridge, loop, homeId } = town(NIGHT + 20)
    void bridge.submit('amara', { verb: 'enter', params: { structureId: homeId } })
    loop.step()
    loop.step()
    const before = warmthTargetFor(loop.state, CFG, 'amara')
    void bridge.submit('amara', { verb: 'stoke', params: { structureId: homeId } })
    loop.step()
    loop.step()
    // A spring night, so nothing here is shivering either way — the point is that the number
    // MOVES, which it never did: walls answered the cold and the fire answered nothing.
    expect(warmthTargetFor(loop.state, CFG, 'amara')).toBe(before + 2 * CFG.warmth.fireWarmth)
  })

  it('★ VACUOUS GUARD: a roof with no fire in it says nothing about a hearth at all', () => {
    const { bridge, loop } = town(NIGHT - 3)
    const store = Object.values(loop.state.structures).find((s) => s.kind === 'storehouse')!
    void bridge.submit('amara', { verb: 'walk', params: { x: store.x, y: store.y + store.h } })
    loop.step()
    // Standing in the street beside the storehouse and its neighbours: the word must not appear
    // for a building that holds no fire, and no unlit hearth is recited from outside either.
    expect(proseFor(bridge)).not.toContain('hearth')
  })

  // ★ AND WHICH ROOF HAS BEDS IN IT, SAID BEFORE THE WALK. Two 2x2 roofs are not the same
  // night: the house has beds and the cabin has a floor. A body that can only learn which by
  // lying down in both has spent two nights finding out — the lesson `full` already taught.
  it('★ the two 2x2 roofs read differently, and only one of them has beds', () => {
    const { bridge, loop, homeId } = town(NIGHT - 3)
    loop.step()
    const said = bridge.perception('amara').visible.structures
    const cabin = Object.values(loop.state.structures).find((s) => s.kind === 'cabin')!
    // Same mass, same roof, same way in — and one of them is somewhere to sleep well.
    expect(loop.state.structures[homeId]!.w * loop.state.structures[homeId]!.h)
      .toBe(cabin.w * cabin.h)
    expect(said.find((x) => x.id === homeId)?.bed).toBe(true)
    expect(said.find((x) => x.id === cabin.id)?.bed).toBeUndefined()
  })

  it('and the sentence for it says what is there and never that it is better', () => {
    const { bridge, loop, homeId } = town(NIGHT - 3)
    void bridge.submit('amara', { verb: 'enter', params: { structureId: homeId } })
    loop.step()
    loop.step()
    expect(proseFor(bridge)).toContain('There are beds in here.')
  })

  it('it names no remedy and no act, exactly as the cold and the walls do', () => {
    const { bridge, loop, homeId } = town(NIGHT - 3)
    void bridge.submit('amara', { verb: 'enter', params: { structureId: homeId } })
    loop.step()
    loop.step()
    const cold = proseFor(bridge).toLowerCase()
    void bridge.submit('amara', { verb: 'stoke', params: { structureId: homeId } })
    loop.step()
    loop.step()
    const lit = proseFor(bridge).toLowerCase()
    for (const said of [cold, lit]) {
      for (const hint of [
        'stoke', 'you should', 'you must', 'you could feed', 'go inside', 'light it', 'feed it',
        'sleep here', 'better than', 'you would rest',
      ]) {
        expect(said, hint).not.toContain(hint)
      }
    }
  })
})

// ★ `enter: it is not finished` — 34 refusals across twelve live nights, and the wants lane
// named it as this one's. A mind reads "its walls are three quarters up", walks over, and tries
// the door. The packet said how far up the walls were and never that there was nothing behind
// them yet.
describe('★ a roofless building has no inside yet, and the wall says so', () => {
  const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })

  function site(stage: 'construction' | 'complete'): string {
    const rows = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0 as const))
    let s = genesisState(CFG, rows)
    s = fold(s, ev(1, 'structure_planned', {
      id: 'structure_1', kind: 'house', x: 2, y: 1, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'b',
    }))
    if (stage === 'complete') s = fold(s, ev(2, 'structure_completed', { id: 'structure_1' }))
    s = fold(s, ev(3, 'agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 4, ageDays: 7300 }))
    const db = openDb(':memory:')
    const store = new EventStore(db)
    const loop = new TickLoop({ store, state: s, rng: new RngStreams('h2'), config: CFG, realMsPerTick: 0, onTick: () => {} })
    const bridge = new EngineBridge({ loop, store, simConfig: CFG })
    return perceptionToProse(bridge.perception('a1'), () => {}, WORLD)
  }

  it('says it at the wall instead of at the refusal', () => {
    expect(site('construction')).toContain('There is no inside to it yet.')
  })

  it('★ VACUOUS GUARD: and the finished building does not say it', () => {
    const done = site('complete')
    expect(done).not.toContain('There is no inside to it yet.')
    expect(done).toContain('stand there and you can go in')
  })

  it('names no remedy: it is a fact about now and promises nothing later', () => {
    const said = site('construction').toLowerCase()
    for (const hint of ['you should', 'you must', 'once the roof', 'when it is finished', 'come back']) {
      expect(said, hint).not.toContain(hint)
    }
  })
})

// ★ THE ONE-WAY GLASS, over every surface this lane wrote. Nothing a mind perceives may name a
// construct type, our ops jargon, or the grammar that decides where a building can stand.
describe('the one-way glass holds over every sentence this lane added', () => {
  const AUTHORED = [
    'The hearth here is cold.',
    'A fire is burning in the hearth here.',
    'Firelight moves inside it.',
    'There are beds in here.',
    'There are beds in it.',
    'There is no inside to it yet.',
    CAPABILITIES,
  ]

  it('names no construct type and no ops word', () => {
    for (const text of AUTHORED) expect(scanPromptForGlassLeak(text), text.slice(0, 40)).toEqual([])
  })

  it('names nothing about how the town is laid out', () => {
    for (const text of AUTHORED) expect(scanForLayoutLeak(text), text.slice(0, 40)).toEqual([])
  })

  // ★ VACUOUS GUARD: the scan is looking, and would have caught one.
  it('and the scan is awake — a sentence that DID leak comes back named', () => {
    expect(scanPromptForGlassLeak('The hearth here is cold, and the council meets by it.')).toContain('council')
    expect(scanForLayoutLeak('There are beds in it, on the town\'s next free plot.')).toContain('plot')
  })
})
