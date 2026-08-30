import { describe, expect, it } from 'vitest'
import {
  MOMENT_STEP_MS,
  PLAY_SPEEDS,
  idlePlayer,
  nextPlaySpeed,
  pausePlayer,
  playPlayer,
  seekPlayer,
  tickPlayer,
  type PlaySpeed,
  type PlayerState,
} from './momentsPlayer.js'
import { momentRows } from '../paper/pages/Moments.js'

const START = 100
const END = 140

const playing = (over: Partial<PlayerState> = {}): PlayerState => ({
  status: 'playing',
  tick: START,
  speed: 1,
  accMs: 0,
  ...over,
})

// Feed the machine a stream of frames and report where it landed. This is the whole of the
// player's clock: nothing inside it reads a wall clock, so the same frames always land here.
function run(prev: PlayerState, frames: number[], startTick = START, endTick = END): PlayerState {
  let s = prev
  for (const dt of frames) s = tickPlayer(s, dt, startTick, endTick)
  return s
}

describe('tickPlayer', () => {
  it('advances one tick per step at 1×', () => {
    expect(run(playing(), [MOMENT_STEP_MS]).tick).toBe(START + 1)
    expect(run(playing(), Array<number>(4).fill(MOMENT_STEP_MS)).tick).toBe(START + 4)
  })

  it('advances four times as fast at 4×', () => {
    expect(run(playing({ speed: 4 }), [MOMENT_STEP_MS]).tick).toBe(START + 4)
    expect(run(playing({ speed: 8 }), Array<number>(2).fill(MOMENT_STEP_MS)).tick).toBe(START + 16)
  })

  it('does not move on a single frame shorter than a step', () => {
    const s = tickPlayer(playing(), 16, START, END)
    expect(s.tick).toBe(START)
    expect(s.status).toBe('playing')
  })

  it('keeps the leftover, so a 60fps loop still plays', () => {
    // 31 frames of 16ms is 496ms — still short; the 32nd crosses 500 and one tick lands.
    expect(run(playing(), Array<number>(31).fill(16)).tick).toBe(START)
    expect(run(playing(), Array<number>(32).fill(16)).tick).toBe(START + 1)
  })

  it('is a pure function of its inputs — the same frames always land in the same place', () => {
    const frames = [120, 300, 90, 700, 16, 16, 480]
    expect(run(playing(), frames)).toEqual(run(playing(), frames))
    // and one long frame equals the sum of its parts
    expect(run(playing(), [1000]).tick).toBe(run(playing(), [500, 500]).tick)
  })

  it('stops at the end of the moment rather than running past it', () => {
    const s = run(playing({ speed: 8 }), Array<number>(20).fill(MOMENT_STEP_MS))
    expect(s.tick).toBe(END)
    expect(s.status).toBe('idle')
  })

  it('never drifts before the start of the moment', () => {
    expect(tickPlayer(playing({ tick: 0 }), MOMENT_STEP_MS, START, END).tick).toBe(START)
  })

  it('holds still while paused and while idle, however long the frame', () => {
    for (const status of ['paused', 'idle'] as const) {
      const before: PlayerState = { status, tick: 120, speed: 4, accMs: 0 }
      expect(tickPlayer(before, 10_000, START, END), status).toEqual(before)
    }
  })

  it('handles a moment that is a single instant', () => {
    const s = run({ status: 'playing', tick: 7, speed: 1, accMs: 0 }, [MOMENT_STEP_MS], 7, 7)
    expect(s).toEqual({ status: 'idle', tick: 7, speed: 1, accMs: 0 })
  })
})

describe('seekPlayer', () => {
  it('lands on the midpoint at half way', () => {
    expect(seekPlayer(playing(), 0.5, START, END).tick).toBe(120)
  })

  it('lands on the ends at nought and one', () => {
    expect(seekPlayer(playing(), 0, START, END).tick).toBe(START)
    expect(seekPlayer(playing(), 1, START, END).tick).toBe(END)
  })

  it('clamps a drag that leaves the bar', () => {
    expect(seekPlayer(playing(), -3, START, END).tick).toBe(START)
    expect(seekPlayer(playing(), 4.2, START, END).tick).toBe(END)
  })

  it('keeps playing from where it was dropped, and drops the part-step', () => {
    const s = seekPlayer(playing({ accMs: 400 }), 0.25, START, END)
    expect(s.status).toBe('playing')
    expect(s.tick).toBe(110)
    expect(s.accMs).toBe(0)
  })

  it('leaves a paused player paused', () => {
    expect(
      seekPlayer({ status: 'paused', tick: START, speed: 2, accMs: 0 }, 0.5, START, END).status,
    ).toBe('paused')
  })
})

describe('the player’s controls', () => {
  it('starts at the beginning of the moment', () => {
    expect(idlePlayer(START)).toEqual({ status: 'idle', tick: START, speed: 1, accMs: 0 })
  })

  it('plays, pauses, and plays again from where it stopped', () => {
    const p = playPlayer({ status: 'idle', tick: 130, speed: 2, accMs: 0 })
    expect(p).toEqual({ status: 'playing', tick: 130, speed: 2, accMs: 0 })
    expect(pausePlayer(p)).toEqual({ status: 'paused', tick: 130, speed: 2, accMs: 0 })
    expect(playPlayer(pausePlayer(p)).status).toBe('playing')
  })

  it('restarts from the top when the moment has run out', () => {
    expect(playPlayer({ status: 'idle', tick: END, speed: 1, accMs: 0 }, START, END).tick).toBe(
      START,
    )
  })

  it('cycles the speed through every rate and back to the first', () => {
    let speed: PlaySpeed = PLAY_SPEEDS[0]
    const seen: PlaySpeed[] = [speed]
    for (let i = 1; i < PLAY_SPEEDS.length; i++) {
      speed = nextPlaySpeed(speed)
      seen.push(speed)
    }
    expect(seen).toEqual([...PLAY_SPEEDS])
    expect(nextPlaySpeed(PLAY_SPEEDS[PLAY_SPEEDS.length - 1]!)).toBe(PLAY_SPEEDS[0])
  })
})

// `MomentSchema` wants a title of at least one character. Parsed as one array, a single scene
// the narrator left untitled took every other scene off the filmstrip with it.
describe('★ one bad scene costs one row', () => {
  const scene = (id: number, title: string): unknown => ({
    id,
    day: 1,
    startTick: 0,
    endTick: 10,
    title,
    cast: ['amara'],
    location: null,
  })

  it('keeps the scenes that read and drops the one that does not', () => {
    const rows = momentRows({ moments: [scene(1, 'The well'), scene(2, ''), scene(3, 'Dusk')] })
    expect(rows?.map((m) => m.id)).toEqual([1, 3])
  })

  it('still refuses a body that is not a list of scenes, so the last good answer stands', () => {
    expect(momentRows(null)).toBeNull()
    expect(momentRows({})).toBeNull()
    expect(momentRows({ moments: 'soon' })).toBeNull()
  })
})
