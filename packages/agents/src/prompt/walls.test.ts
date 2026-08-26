import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import {
  buildTicks,
  composePerception,
  fold,
  genesisState,
  makeables,
  makeGenesisWorld,
  unfinishedWork,
  type TileId,
  type WorldState,
} from '@sj/engine'
import {
  howFarUp,
  makeablesLine,
  perceptionToProse,
  standingWallsLine,
  type PerceptionPacket,
} from './prose.js'

// Hands are the rate — `stepBuild` adds one per hand on the site — so a house is a night's work
// for five. "Still being built" reads the same one hour short as four days short.

const CFG = DEFAULT_CONFIG
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick: 0,
  type,
  payload,
})

describe('howFarUp — where the work has got to, in words', () => {
  const needs = 2880

  it('walks the whole span, and no two neighbouring stages read alike', () => {
    const said = [0, 360, 720, 1080, 1440, 1800, 2160, 2520, 2879].map((done) =>
      howFarUp({ done, needs }),
    )
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
      for (const hint of [
        'build',
        'raise a',
        'you should',
        'you must',
        'a roof would',
        'go inside',
        'help',
      ]) {
        expect(said, `${done}: ${said}`).not.toContain(hint)
      }
    }
  })
})

describe('★ the packet carries how far up the walls are', () => {
  function siteWorld(progress: number): WorldState {
    const rows = Array.from({ length: 10 }, () => Array.from({ length: 10 }, (): TileId => 0))
    let s = genesisState(CFG, rows)
    s = fold(
      s,
      ev(1, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 2,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'b',
      }),
    )
    if (progress > 0)
      s = fold(s, ev(2, 'structure_progressed', { id: 'structure_1', ticks: progress }))
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

  // The founding valley itself: the roofless dwellings say how far up they are, and the two
  // roofs that held say nothing, because a standing building is not a site.
  it('reads the founding valley: walls on the roofless, silence on the sound', () => {
    const g = makeGenesisWorld(CFG)
    let s = genesisState(CFG, g.terrain)
    for (const e of g.events) s = fold(s, ev(1, e.type, e.payload), CFG)
    const house = Object.values(s.structures).find((x) => x.kind === 'house')!
    s = fold(
      s,
      ev(2, 'agent_spawned', {
        id: 'a1',
        name: 'a1',
        x: house.x,
        y: house.y + house.h,
        ageDays: 7300,
      }),
      CFG,
    )
    const seen = composePerception(s, CFG, 'a1', []).visible.structures
    expect(seen.length).toBeGreaterThan(0)
    const roofless = seen.filter((st) => st.stage === 'construction')
    expect(roofless.length, 'the valley stood nothing roofless').toBeGreaterThan(0)
    for (const st of roofless) {
      expect(st.raised, st.kind).toBeDefined()
      expect(st.raised!.done / st.raised!.needs, st.kind).toBeCloseTo(0.75, 5)
      expect(howFarUp(st.raised)).toBe('its walls are three quarters up')
    }
    for (const st of seen.filter((x) => x.stage === 'complete')) {
      expect(st.raised, st.kind).toBeUndefined()
    }
  })
})

describe('★ and the prose says it where the mind will read it', () => {
  const packetWith = (raised?: { done: number; needs: number }): PerceptionPacket =>
    ({
      time: {
        tick: 0,
        year: 0,
        season: 'spring',
        dayOfSeason: 1,
        dayOfYear: 0,
        hour: 12,
        minute: 0,
        isNight: false,
      },
      self: {
        body: {
          needs: { hunger: 90, energy: 90, warmth: 90, social: 90 },
          hp: 100,
          injuries: [],
          ill: false,
        },
        x: 2,
        y: 4,
        asleep: false,
        collapsed: false,
        activity: null,
        inventory: [],
      },
      weather: { kind: 'sunny', temperatureC: 14 },
      light: 'bright',
      visible: {
        agents: [],
        structures: [
          {
            id: 'structure_1',
            kind: 'house',
            x: 2,
            y: 1,
            w: 2,
            h: 2,
            burning: false,
            stage: 'construction',
            ...(raised === undefined ? {} : { raised }),
          },
        ],
        items: [],
        crops: [],
        fauna: [],
        forageables: [],
      },
      heard: [],
      seen: [],
      feltEvents: [],
    }) as unknown as PerceptionPacket

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
    expect(say({ done: 1440, needs: 2880 })).toMatch(
      /its walls are half up; you could stand beside it at \(\d+, \d+\)\./,
    )
  })

  it('falls back to the landed sentence when the packet carries no progress', () => {
    expect(say(undefined)).toContain('still being built')
  })
})

// ---------------------------------------------------- what a mind READS at a full door ---

describe('★ a full room, said in the prose and not in a refusal', () => {
  const seeing = (extra: Record<string, unknown>): string =>
    perceptionToProse(
      {
        time: {
          tick: 0,
          year: 0,
          season: 'spring',
          dayOfSeason: 1,
          dayOfYear: 0,
          hour: 12,
          minute: 0,
          isNight: false,
        },
        self: {
          body: {
            needs: { hunger: 90, energy: 90, warmth: 90, social: 90 },
            hp: 100,
            injuries: [],
            ill: false,
          },
          x: 2,
          y: 4,
          asleep: false,
          collapsed: false,
          activity: null,
          inventory: [],
        },
        weather: { kind: 'sunny', temperatureC: 14 },
        light: 'bright',
        visible: {
          agents: [],
          structures: [
            {
              id: 'structure_1',
              kind: 'cabin',
              x: 2,
              y: 1,
              w: 2,
              h: 2,
              burning: false,
              stage: 'complete',
              door: { x: 2, y: 3 },
              ...extra,
            },
          ],
          items: [],
          crops: [],
          fauna: [],
          forageables: [],
        },
        heard: [],
        seen: [],
        feltEvents: [],
      } as unknown as PerceptionPacket,
      undefined,
      { isWalkable: () => true },
    )

  it('names the doorway either way — a full room is not a wall', () => {
    expect(seeing({})).toContain('its doorway is at (2, 3); stand there and you can go in.')
    expect(seeing({ full: true })).toContain(
      'its doorway is at (2, 3), and there is no floor left in it.',
    )
  })

  // The distinction the whole of R2 turns on: a mind that cannot tell "full now" from "no way
  // through, ever" walks back to the same door all night. That was arm B's defect.
  it('reads differently from a wall with no way in at all', () => {
    const full = seeing({ full: true })
    const solid = seeing({ door: undefined })
    expect(full).not.toEqual(solid)
    expect(full).toContain('(2, 3)')
    expect(solid).not.toContain('doorway')
  })

  it('names no remedy and gives no counsel', () => {
    const said = seeing({ full: true }).toLowerCase()
    for (const hint of [
      'build',
      'raise a',
      'you should',
      'a roof would',
      'go inside',
      'wait for',
    ]) {
      expect(said).not.toContain(hint)
    }
  })
})

// `groundForBuilding` names the town's next FREE plot, which is the same plot for everyone
// until one body plants walls on it: free ground alone cannot answer "where does work go".

describe('* walls already standing are a place the world can name', () => {
  const rows = () => Array.from({ length: 14 }, () => Array.from({ length: 14 }, (): TileId => 0))
  const ev2 = (seq: number, type: string, payload: unknown) => ({ seq, tick: 0, type, payload })

  function townWith(
    sites: { id: string; kind: string; x: number; y: number; progress: number }[],
  ): WorldState {
    let s = genesisState(CFG, rows())
    let seq = 0
    for (const site of sites) {
      const row = CFG.structures.recipes[site.kind]!
      s = fold(
        s,
        ev2(++seq, 'structure_planned', {
          id: site.id,
          kind: site.kind,
          x: site.x,
          y: site.y,
          w: row.w,
          h: row.h,
          maxHp: row.maxHp,
          flammable: row.flammable,
          builderId: 'g',
        }),
        CFG,
      )
      if (site.progress > 0) {
        s = fold(s, ev2(++seq, 'structure_progressed', { id: site.id, ticks: site.progress }), CFG)
      }
    }
    return fold(
      s,
      ev2(++seq, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }),
      CFG,
    )
  }

  it('names the nearest half-raised building, and how far up it is', () => {
    const s = townWith([
      { id: 'structure_1', kind: 'house', x: 9, y: 9, progress: 2160 },
      { id: 'structure_2', kind: 'house', x: 2, y: 2, progress: 1440 },
    ])
    const w = unfinishedWork(s, CFG, { x: 1, y: 1 })!
    expect(w.id).toBe('structure_2')
    expect(standingWallsLine(w)).toBe('Walls already stand at (2, 4): a house, half up.')
  })

  it('is silent when the town has nothing half-raised in it', () => {
    let done = townWith([{ id: 'structure_1', kind: 'house', x: 2, y: 2, progress: 2880 }])
    done = fold(done, ev2(90, 'structure_completed', { id: 'structure_1' }), CFG)
    expect(unfinishedWork(done, CFG, { x: 1, y: 1 })).toBeNull()
    expect(standingWallsLine(null)).toBe('')
    expect(standingWallsLine(undefined)).toBe('')
  })

  // * NEVER NAME A WALL NOBODY CAN FINISH. That is the cottage-that-was-not-a-cottage all over
  // again: a building that looks like an answer and refuses in words a mind cannot use.
  it('says nothing about walls no pair of hands could carry on', () => {
    const s = townWith([{ id: 'structure_1', kind: 'cabin', x: 2, y: 2, progress: 1 }])
    expect(CFG.structures.recipes.cabin!.inputs).toEqual({})
    expect(unfinishedWork(s, CFG, { x: 1, y: 1 }), 'named an unfinishable wall').toBeNull()
  })

  it('names no remedy and no act', () => {
    const s = townWith([{ id: 'structure_1', kind: 'house', x: 2, y: 2, progress: 720 }])
    const said = standingWallsLine(unfinishedWork(s, CFG, { x: 1, y: 1 })).toLowerCase()
    expect(said.length).toBeGreaterThan(0)
    for (const hint of ['build', 'raise', 'you should', 'you must', 'go and', 'help', 'join']) {
      expect(said, said).not.toContain(hint)
    }
  })

  // The other half of the pair, and it must not contradict the first: one is where a roof
  // BEGINS, the other is where one already stands.
  it('the town ground now says "begin a new one", not "raise one"', () => {
    const line = makeablesLine(makeables(CFG), { x: 7, y: 7 })
    expect(line).toContain('you must be standing there to begin a new one.')
    expect(line).not.toContain('to raise one')
  })
})
