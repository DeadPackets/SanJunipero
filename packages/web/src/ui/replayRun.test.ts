import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { momentPlay, momentRows } from '../paper/pages/Moments.js'
import { onCamera } from './autoCut.js'
import {
  MOMENT_LEAD_TICKS,
  MOMENT_TAIL_TICKS,
  playClosesPaper,
  pointPlay,
  pointWindow,
  reachedEnd,
  sceneWindow,
} from './replayRun.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const EDGE = 100_000

// ★ The owner clicked "the first grave" in the Chronicle and watched nothing happen. A correct
// replay engine had landed and only the deep-link path was wired to it: every click the owner
// makes went `onJump → goTo → scrub`, which paints ONE still frame and stops.
describe('★ clicking a chronicle line plays the moment, it does not freeze on it', () => {
  const APP = src('../App.tsx')

  it('★ hands every clicked row `replay`, and keeps `scrub` for the filmstrip drag', () => {
    expect(APP).toContain('handle?.replay(next.from)')
    expect(APP).not.toContain('const onJump')
    // the one caller that still holds a minute still, and says so
    expect(APP).toContain('const onScrub')
    expect(src('../paper/pages/Days.tsx')).toContain('onScrub(Math.max(0, Math.min(edge')
  })

  it('★ closes the paper on play: it covers 66% of the screen and dims the town to 0.28', () => {
    const onPlay = APP.slice(APP.indexOf('const onPlay'), APP.indexOf('const onLive'))
    expect(onPlay).toContain('closePaper()')
    expect(onPlay.indexOf('closePaper()')).toBeLessThan(onPlay.indexOf('handle?.replay'))
  })

  // ★ ...and stops closing it once it no longer has to. Docked the Almanac is a 380px column
  // beside the town with the dim at 0, so putting it away costs the reader their place.
  it('★ leaves the Almanac up when it is docked, because a docked column dims nothing', () => {
    expect(playClosesPaper('sheet')).toBe(true)
    expect(playClosesPaper('docked')).toBe(false)
  })

  it('★ every way into the past but the drag is a play', () => {
    for (const page of ['pages/Chronicle', 'pages/Moments', 'game/Land', 'pages/Days']) {
      const s = src(`../paper/${page}.tsx`)
      expect(s, page).toContain('onPlay')
      expect(s, page).not.toContain('onJump')
    }
  })

  it('★ a deep link is the same bounded moment a click is, not a run at the live edge', () => {
    expect(APP).toContain('const next = pointPlay(at, store.liveEdge()')
    expect(APP).toContain('sock.replay(next.from)')
  })
})

// ★ `ClientReplay` carries no `until`, so an unbounded replay of day 3 of a nine-day town runs
// for 4.8 real hours. The end is watched client-side rather than grown into the protocol.
describe('★ a moment stops where the moment stops', () => {
  it('★ runs three sim-minutes before a point event to ten after', () => {
    expect(MOMENT_LEAD_TICKS).toBe(3)
    expect(MOMENT_TAIL_TICKS).toBe(10)
    expect(pointWindow(1500, EDGE)).toEqual({ from: 1497, until: 1510 })
  })

  it('★ a scene runs the minute before it opened to its own close', () => {
    expect(sceneWindow(1500, 1620, EDGE)).toEqual({ from: 1499, until: 1620 })
  })

  it('never asks for a minute before the town began or after the live edge', () => {
    expect(pointWindow(1, EDGE)).toEqual({ from: 0, until: 11 })
    expect(pointWindow(95, 100)).toEqual({ from: 92, until: 100 })
    expect(sceneWindow(0, 40, 20)).toEqual({ from: 0, until: 20 })
  })

  it('holds a still rather than inverting when the edge is behind the moment', () => {
    const w = pointWindow(500, 100)
    expect(w.until).toBeGreaterThanOrEqual(w.from)
  })

  it('★ ends on ARRIVAL, and the socket coalesces, so an overshoot still ends it', () => {
    const play = pointPlay(1500, EDGE, 'the first grave')
    expect(reachedEnd(play, 1509, true)).toBe(false)
    expect(reachedEnd(play, 1510, true)).toBe(true)
    expect(reachedEnd(play, 1514, true)).toBe(true)
  })

  it('a still already parked on the end tick is not an arrival to fire again', () => {
    const play = pointPlay(1500, EDGE, 'the first grave')
    expect(reachedEnd(play, 1510, false)).toBe(false)
  })

  it('★ costs the protocol nothing: pause is a scrub and resume is a replay', () => {
    const proto = src('../../../shared/src/protocol.ts')
    expect(proto).toContain("t: z.literal('replay'), from: tick, reqId")
    // the end lives in the viewer; the wire still carries a start and nothing else
    expect(proto).not.toMatch(/until[,:]/)
  })
})

// ★ `hold()` suspended the director for 20 s on ANY pointerdown on window, so the very click
// that opens a replay disabled the thing meant to shoot it. Naming the two surfaces to exempt
// then left everything else on the list, and muting the town took the camera off auto too.
describe('★ a click on the paper is a hand on the paper, not on the camera', () => {
  // the one question `hold` asks of an event, answered without a DOM
  const at = (...ancestors: string[]): Event =>
    ({
      type: 'pointerdown',
      target: { closest: (sel: string) => (ancestors.some((a) => sel.includes(a)) ? {} : null) },
    }) as never

  it('★ ignores the sheet, the signpost and every other piece of the town’s chrome', () => {
    expect(onCamera(at('.paper'))).toBe(false)
    expect(onCamera(at('.signpost'))).toBe(false)
    expect(onCamera(at('.sound-button'))).toBe(false)
  })

  it('★ still gives the town itself away: a pan or a click on the ground is a hand', () => {
    expect(onCamera(at('.stage-mount'))).toBe(true)
  })
})

describe('a recorded scene plays from its own opening to its own close', () => {
  const scene = {
    id: 7,
    day: 2,
    startTick: 3000,
    endTick: 3120,
    title: 'The well runs dry',
    cast: ['a1', 'a2'],
    location: 'the fork',
    kind: 'council' as const,
    stakes: 7,
    summary: null,
  }

  it('carries the scene’s own cast and title into the shot', () => {
    expect(momentPlay(scene, EDGE)).toEqual({
      from: 2999,
      until: 3120,
      cast: ['a1', 'a2'],
      title: 'The well runs dry',
      tick: 3000,
    })
  })

  it('reads the wire row by row, so one untitled scene is not the whole filmstrip', () => {
    expect(momentRows({ moments: [scene, { id: 8 }] })).toEqual([scene])
    expect(momentRows(null)).toBeNull()
  })
})
