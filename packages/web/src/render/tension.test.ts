import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { GIVE_WAY_AFTER } from '@sj/shared'
import { SceneClosed, SceneLineSaid, SceneOpened, SceneTurned } from '@sj/engine'
import type { WorldStore } from '../state/worldStore.js'
import {
  TENSION_AGREE,
  TENSION_BAR_H,
  TENSION_BAR_W,
  TENSION_CARET_PX,
  TENSION_DEFLECT_PX,
  TENSION_DESATURATE_MS,
  TENSION_GIVE_WAY_MS,
  TENSION_INK,
  TENSION_LEVEL_START,
  TENSION_MOVE_MS,
  TENSION_RIM_MS,
  TENSION_SPENT,
  TENSION_TEASE_MS,
  TENSION_TEASE_SCALE,
  TENSION_UNIT,
  TENSION_WARM,
  type Tension,
  type TensionBar,
  type TensionTurn,
  createTension,
} from './tension.js'

const SCENE = 'scene_1'
let clock = 0

type Harness = {
  tension: Tension
  /** the world says a thing at `clock`, exactly as the socket delivers it */
  emit: (type: string, payload: unknown) => void
  open: (participants: string[]) => void
  say: (agentId: string, move: string) => void
  bar: (agentId: string, nowMs?: number) => TensionBar
  turns: TensionTurn[]
}

function harness(): Harness {
  let handler: (evts: SimEvent[]) => void = () => undefined
  const store = {
    onEvents: (fn: (evts: SimEvent[]) => void) => {
      handler = fn
      return () => undefined
    },
  } as unknown as WorldStore
  const tension = createTension(store)
  const turns: TensionTurn[] = []
  tension.onTurn((t) => turns.push(t))
  let seq = 0
  const emit = (type: string, payload: unknown): void => {
    seq += 1
    handler([{ seq, tick: seq, type, payload }])
  }
  return {
    tension,
    emit,
    turns,
    open: (participants) => {
      emit(
        'scene_opened',
        SceneOpened.parse({ id: SCENE, kind: 'talk', participants, topic: null, stakes: 5 }),
      )
    },
    say: (agentId, move) => {
      emit('scene_line', SceneLineSaid.parse({ id: SCENE, agentId, text: 'Well.', move }))
    },
    bar: (agentId, nowMs = clock) => tension.bars(SCENE, nowMs).find((b) => b.agentId === agentId)!,
  }
}

beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('a bar stands for every person the world holds in the scene, and for nobody else', () => {
  it('opens one bar per participant, at rest, on a 64 by 4 bar', () => {
    expect([TENSION_BAR_W, TENSION_BAR_H]).toEqual([64, 4])
    const h = harness()
    h.open(['amara', 'yusuf'])
    expect(h.tension.bars(SCENE, clock).map((b) => b.agentId)).toEqual(['amara', 'yusuf'])
    expect(h.bar('amara').level).toBe(TENSION_LEVEL_START)
    expect(h.bar('amara').colour).toBe(TENSION_INK)
  })

  it('draws nothing for a scene the world never opened, and nothing once it closes', () => {
    const h = harness()
    h.say('amara', 'press')
    expect(h.tension.bars(SCENE, clock)).toEqual([])
    h.open(['amara', 'yusuf'])
    expect(h.tension.bars(SCENE, clock)).toHaveLength(2)
    h.emit(
      'scene_closed',
      SceneClosed.parse({ id: SCENE, summary: 'It ended.', deltas: [], closeReason: 'ended' }),
    )
    expect(h.tension.bars(SCENE, clock)).toEqual([])
  })

  it('never moves a bar for a person the world does not hold in that scene', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('omar', 'press')
    expect(h.tension.bars(SCENE, clock).map((b) => b.agentId)).toEqual(['amara', 'yusuf'])
    // and the two it does hold still take the halving a press puts on the others
    expect(h.bar('amara', clock + TENSION_MOVE_MS).level).toBeCloseTo(
      TENSION_LEVEL_START - TENSION_UNIT / 2,
      5,
    )
  })

  it('a scene that turns keeps the bars of whoever is still in it', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'press')
    const pressed = h.bar('amara', clock + TENSION_MOVE_MS).level
    expect(pressed).toBeGreaterThan(TENSION_LEVEL_START)
    h.emit(
      'scene_turned',
      SceneTurned.parse({ id: SCENE, kind: 'quarrel', participants: ['amara', 'omar'], stakes: 7 }),
    )
    clock += TENSION_MOVE_MS
    expect(h.tension.bars(SCENE, clock).map((b) => b.agentId)).toEqual(['amara', 'omar'])
    expect(h.bar('amara').level, 'the press it was carrying is still on it').toBeCloseTo(pressed, 5)
    expect(h.bar('omar').level).toBe(TENSION_LEVEL_START)
  })
})

describe('every row of the table, over the clock', () => {
  it('press: the speaker up one unit over 180 ms, the others down half', () => {
    expect(TENSION_MOVE_MS).toBe(180)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'press')

    expect(h.bar('amara', clock).level, 'nothing has moved at the instant it is said').toBeCloseTo(
      TENSION_LEVEL_START,
      5,
    )
    const half = h.bar('amara', clock + TENSION_MOVE_MS / 2).level
    expect(half).toBeGreaterThan(TENSION_LEVEL_START)
    expect(half).toBeLessThan(TENSION_LEVEL_START + TENSION_UNIT)
    expect(h.bar('amara', clock + TENSION_MOVE_MS).level).toBeCloseTo(
      TENSION_LEVEL_START + TENSION_UNIT,
      5,
    )
    expect(h.bar('yusuf', clock + TENSION_MOVE_MS).level).toBeCloseTo(
      TENSION_LEVEL_START - TENSION_UNIT / 2,
      5,
    )
    expect(h.bar('amara', clock + TENSION_MOVE_MS + 500).level, 'and it rests there').toBeCloseTo(
      TENSION_LEVEL_START + TENSION_UNIT,
      5,
    )
  })

  it('give_way: the yielder collapses to zero over 260 ms, its colour falling to the spent ink', () => {
    expect(TENSION_GIVE_WAY_MS).toBe(260)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'give_way')

    expect(h.bar('amara', clock).level).toBeCloseTo(TENSION_LEVEL_START, 5)
    expect(h.bar('amara', clock).colour).toBe(TENSION_INK)
    const half = h.bar('amara', clock + TENSION_GIVE_WAY_MS / 2)
    expect(half.level).toBeLessThan(TENSION_LEVEL_START)
    expect(half.level).toBeGreaterThan(0)
    expect(half.colour, 'part way from strife to spent').not.toBe(TENSION_INK)
    expect(half.colour).not.toBe(TENSION_SPENT)
    expect(h.bar('amara', clock + TENSION_GIVE_WAY_MS - 1).level).toBeGreaterThan(0)
    expect(h.bar('amara', clock + TENSION_GIVE_WAY_MS).level).toBe(0)
    expect(h.bar('amara', clock + TENSION_GIVE_WAY_MS).colour).toBe(TENSION_SPENT)
    expect(h.bar('yusuf', clock + TENSION_GIVE_WAY_MS).level, 'the other bar is untouched').toBe(
      TENSION_LEVEL_START,
    )
  })

  it('deflect: 6 px sideways and no length change', () => {
    expect(TENSION_DEFLECT_PX).toBe(6)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'deflect')
    expect(h.bar('amara', clock).dx).toBe(TENSION_DEFLECT_PX)
    expect(h.bar('amara', clock).level, 'a dodge changes nothing about the length').toBe(
      TENSION_LEVEL_START,
    )
    expect(h.bar('amara', clock + TENSION_MOVE_MS / 2).dx).toBeCloseTo(TENSION_DEFLECT_PX / 2, 5)
    expect(h.bar('amara', clock + TENSION_MOVE_MS).dx).toBe(0)
    expect(h.bar('yusuf', clock).dx).toBe(0)
  })

  it('tease: a 90 ms 1.06 nudge', () => {
    expect([TENSION_TEASE_MS, TENSION_TEASE_SCALE]).toEqual([90, 1.06])
    const h = harness()
    h.open(['amara', 'yusuf'])
    expect(h.bar('amara').scale).toBe(1)
    h.say('amara', 'tease')
    expect(h.bar('amara', clock).scale).toBeCloseTo(TENSION_TEASE_SCALE, 5)
    expect(h.bar('amara', clock + TENSION_TEASE_MS).scale).toBe(1)
    expect(h.bar('amara', clock).level, 'a nudge is not a press').toBe(TENSION_LEVEL_START)
    expect(h.bar('yusuf', clock).scale).toBe(1)
  })

  it('joke: a warm tick over the joker s bar, standing until the next line', () => {
    expect(TENSION_WARM).toBe(0xf2c879)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'joke')
    expect(h.bar('amara').tickAbove).toBe(true)
    expect(h.bar('yusuf').tickAbove).toBe(false)
    h.say('yusuf', 'none')
    expect(h.bar('amara').tickAbove).toBe(false)
  })

  it('ask: a caret opens on the OTHER bar', () => {
    expect(TENSION_CARET_PX).toBe(1)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'ask')
    expect(h.bar('yusuf').caret).toBe(true)
    expect(h.bar('amara').caret, 'nobody asks themselves').toBe(false)
    h.say('yusuf', 'none')
    expect(h.bar('yusuf').caret).toBe(false)
  })

  it('agree: both close 20 percent toward each other', () => {
    expect(TENSION_AGREE).toBe(0.2)
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('amara', 'press')
    clock += TENSION_MOVE_MS
    const apart = h.bar('amara').level - h.bar('yusuf').level
    expect(apart).toBeGreaterThan(0)
    h.say('yusuf', 'agree')
    clock += TENSION_MOVE_MS
    expect(h.bar('amara').level - h.bar('yusuf').level).toBeCloseTo(
      apart * (1 - 2 * TENSION_AGREE),
      5,
    )
  })

  it('a line that is only a line moves nothing', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    for (const move of ['none', 'tell', 'shift']) {
      h.say('amara', move)
      clock += TENSION_MOVE_MS
      expect(h.bar('amara').level, move).toBe(TENSION_LEVEL_START)
      expect(h.bar('yusuf').level, move).toBe(TENSION_LEVEL_START)
    }
  })
})

describe('the turn: the world already paid six for it and the screen has been silent', () => {
  const turned = (h: Harness): void => {
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('yusuf', 'press')
    h.say('amara', 'give_way')
  }

  it('fires once, naming the scene, the yielder and the tick', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    turned(h)
    expect(h.turns).toHaveLength(1)
    expect(h.turns[0]).toEqual({ sceneId: SCENE, yielder: 'amara', tick: 5 })
  })

  it('and not once per frame: reading the bars a hundred times fires nothing', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    turned(h)
    for (let i = 0; i < 100; i++) {
      h.tension.bars(SCENE, clock + i)
      h.tension.rimFlash(SCENE, clock + i)
      h.tension.desaturate('amara', clock + i)
    }
    expect(h.turns).toHaveLength(1)
  })

  it('does not fire for a give_way nobody pressed for, and the bar still collapses', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    h.say('yusuf', 'press')
    h.say('amara', 'give_way')
    expect(h.turns).toEqual([])
    expect(h.bar('amara', clock + TENSION_GIVE_WAY_MS).level).toBe(0)
    expect(h.tension.rimFlash(SCENE, clock)).toBe(0)
  })

  it('flashes the ring rim for 200 ms', () => {
    expect(TENSION_RIM_MS).toBe(200)
    const h = harness()
    h.open(['amara', 'yusuf'])
    turned(h)
    expect(h.tension.rimFlash(SCENE, clock)).toBe(1)
    expect(h.tension.rimFlash(SCENE, clock + TENSION_RIM_MS / 2)).toBeCloseTo(0.5, 5)
    expect(h.tension.rimFlash(SCENE, clock + TENSION_RIM_MS)).toBe(0)
    expect(h.tension.rimFlash('scene_2', clock), 'no other scene flashes').toBe(0)
  })

  it('desaturates the yielder and the one who pressed, for 120 ms, and nobody else', () => {
    expect(TENSION_DESATURATE_MS).toBe(120)
    const h = harness()
    h.open(['amara', 'yusuf', 'omar'])
    turned(h)
    expect(h.tension.desaturate('amara', clock)).toBe(1)
    expect(h.tension.desaturate('yusuf', clock)).toBe(1)
    expect(h.tension.desaturate('omar', clock)).toBe(0)
    expect(h.tension.desaturate('amara', clock + TENSION_DESATURATE_MS / 2)).toBeCloseTo(0.5, 5)
    expect(h.tension.desaturate('amara', clock + TENSION_DESATURATE_MS)).toBe(0)
  })

  it('collapses the yielder s own bar, which is what a turn looks like from across a room', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    turned(h)
    const after = h.bar('amara', clock + TENSION_GIVE_WAY_MS)
    expect(after.level).toBe(0)
    expect(after.colour).toBe(TENSION_SPENT)
    expect(h.bar('yusuf', clock + TENSION_GIVE_WAY_MS).level, 'the presser is up').toBeGreaterThan(
      TENSION_LEVEL_START,
    )
  })

  it('takes three fresh presses to turn again', () => {
    const h = harness()
    h.open(['amara', 'yusuf'])
    turned(h)
    h.say('amara', 'give_way')
    expect(h.turns).toHaveLength(1)
    turned(h)
    expect(h.turns).toHaveLength(2)
  })

  it('a listener that has gone away hears nothing', () => {
    const h = harness()
    const heard: TensionTurn[] = []
    const off = h.tension.onTurn((t) => heard.push(t))
    h.open(['amara', 'yusuf'])
    off()
    turned(h)
    expect(heard).toEqual([])
    expect(h.turns).toHaveLength(1)
  })
})
