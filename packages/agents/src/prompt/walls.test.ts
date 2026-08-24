import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import {
  buildTicks, composePerception, fold, genesisState, makeGenesisWorld,
  type TileId, type WorldState,
} from '@sj/engine'
import { howFarUp, perceptionToProse, type PerceptionPacket } from './prose.js'

// ★ R3 — TIME-COST, AND IT WAS NEVER THE PRICE.
//
// A house is 2 880 ticks and a night is 720, so the motive probe reported that no mind can
// answer tonight's cold by building. That reading is wrong about this engine. HANDS ARE THE
// RATE: `stepBuild` adds one to the walls for every hand on the site, and `buildSeam.test.ts`
// pins two pairs raising a house in half the time and five in a fifth. Five founders raise one
// house in 576 ticks — inside one 720-tick night, with two hours to spare.
//
// What stopped them was not the price. It was that a half-raised wall was invisible as a place
// work could go: the packet said `stage: 'construction'` and the prose said "still being built",
// which reads the same one hour short as it does four days short. Arm C's five minds started
// TEN separate houses across three nights and finished none of them.

const CFG = DEFAULT_CONFIG
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })

describe('howFarUp — where the work has got to, in words', () => {
  const needs = 2880

  it('walks the whole span, and no two neighbouring stages read alike', () => {
    const said = [0, 360, 720, 1080, 1440, 1800, 2160, 2520, 2879]
      .map((done) => howFarUp({ done, needs }))
    expect(new Set(said).size, said.join(' / ')).toBe(8)
    expect(said[0]).toBe('its walls are barely begun')
    expect(said[4]).toBe('its walls are half up')
    expect(said[8]).toBe('its walls are nearly done')
  })

  it('falls back to the old sentence when nothing knows the total', () => {
    expect(howFarUp(undefined)).toBe('still being built')
    expect(howFarUp({ done: 5, needs: 0 })).toBe('still being built')
  })

  // The mechanism, said out loud: five hands make 2 880 ticks of walls into 576 ticks of night.
  it('reads "nearly done" on the walls five hands raise in one night', () => {
    const house = buildTicks(CFG, 'house')
    expect(house).toBe(2880)
    const inOneNight = 720 * 5 // five pairs of hands, one 720-tick night
    expect(inOneNight).toBeGreaterThan(house)
    expect(howFarUp({ done: 576 * 5, needs: house })).toBe('its walls are nearly done')
  })

  // It says where the work is and never what to do about it — the motivation lane's law.
  it('names no remedy', () => {
    for (let done = 0; done <= needs; done += 120) {
      const said = howFarUp({ done, needs }).toLowerCase()
      for (const hint of ['build', 'raise a', 'you should', 'you must', 'a roof would', 'go inside', 'help']) {
        expect(said, `${done}: ${said}`).not.toContain(hint)
      }
    }
  })
})

describe('★ the packet carries how far up the walls are', () => {
  function siteWorld(progress: number): WorldState {
    const rows = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0 as TileId))
    let s = genesisState(CFG, rows)
    s = fold(s, ev(1, 'structure_planned', {
      id: 'structure_1', kind: 'house', x: 2, y: 1, w: 2, h: 2,
      maxHp: 50, flammable: true, builderId: 'b',
    }))
    if (progress > 0) s = fold(s, ev(2, 'structure_progressed', { id: 'structure_1', ticks: progress }))
    return fold(s, ev(3, 'agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 3, ageDays: 7300 }))
  }

  const seen = (s: WorldState) =>
    composePerception(s, CFG, 'a1', []).visible.structures.find((x) => x.id === 'structure_1')!

  it('is the work the walls still need, off the same number the verb runs down', () => {
    expect(seen(siteWorld(0)).raised).toEqual({ done: 0, needs: buildTicks(CFG, 'house') })
    expect(seen(siteWorld(1440)).raised).toEqual({ done: 1440, needs: buildTicks(CFG, 'house') })
  })

  it('is absent the moment the building is finished — a standing house is not a site', () => {
    let done = siteWorld(2880)
    done = fold(done, ev(9, 'structure_completed', { id: 'structure_1' }))
    expect(seen(done).raised).toBeUndefined()
    expect(seen(done).stage).toBe('complete')
  })

  it('never claims more work than the building is', () => {
    expect(seen(siteWorld(9000)).raised).toEqual({ done: 2880, needs: 2880 })
  })

  // Not a made-up fixture: the valley's own buildings, seen by a body standing in the town.
  it('says nothing about the standing town, which is all complete', () => {
    const g = makeGenesisWorld(CFG)
    let s = genesisState(CFG, g.terrain)
    for (const e of g.events) s = fold(s, ev(1, e.type, e.payload), CFG)
    const house = Object.values(s.structures).find((x) => x.kind === 'house')!
    s = fold(s, ev(2, 'agent_spawned',
      { id: 'a1', name: 'a1', x: house.x, y: house.y + house.h, ageDays: 7300 }), CFG)
    const packet = composePerception(s, CFG, 'a1', [])
    expect(packet.visible.structures.length).toBeGreaterThan(0)
    for (const st of packet.visible.structures) expect(st.raised, st.kind).toBeUndefined()
  })
})

describe('★ and the prose says it where the mind will read it', () => {
  const packetWith = (raised?: { done: number; needs: number }): PerceptionPacket => ({
    time: { tick: 0, year: 0, season: 'spring', dayOfSeason: 1, dayOfYear: 0, hour: 12, minute: 0, isNight: false },
    self: {
      body: { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 }, hp: 100, injuries: [], ill: false },
      x: 2, y: 4, asleep: false, collapsed: false, activity: null, inventory: [],
    },
    weather: { kind: 'sunny', temperatureC: 14 },
    light: 'bright',
    visible: {
      agents: [],
      structures: [{
        id: 'structure_1', kind: 'house', x: 2, y: 1, w: 2, h: 2,
        burning: false, stage: 'construction', ...(raised === undefined ? {} : { raised }),
      }],
      items: [], crops: [], fauna: [], forageables: [],
    },
    heard: [], seen: [], feltEvents: [],
  } as unknown as PerceptionPacket)

  const say = (raised?: { done: number; needs: number }): string =>
    perceptionToProse(packetWith(raised), undefined, { isWalkable: () => true })

  it('reads a wall an hour short differently from a wall four days short', () => {
    const nearly = say({ done: 2700, needs: 2880 })
    const barely = say({ done: 60, needs: 2880 })
    expect(nearly).toContain('its walls are nearly done')
    expect(barely).toContain('its walls are barely begun')
    expect(nearly).not.toEqual(barely)
  })

  it('still tells the mind where to stand, which is the half that lets it join', () => {
    expect(say({ done: 1440, needs: 2880 })).toMatch(/its walls are half up; you could stand beside it at \(\d+, \d+\)\./)
  })

  it('falls back to the landed sentence when the packet carries no progress', () => {
    expect(say(undefined)).toContain('still being built')
  })
})
