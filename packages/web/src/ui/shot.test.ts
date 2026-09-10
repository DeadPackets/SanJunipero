import { describe, expect, it } from 'vitest'
import { TWO_SHOT_MAX_STOP } from '../render/camera.js'
import type { Facing } from '../render/iso.js'
import { CUT_MIN_MS } from './directorCut.js'
import {
  CUT_BLACK_MS,
  CUT_FALL_MS,
  CUT_FALL_SCALE,
  CUT_MS,
  CUT_RISE_MS,
  CUT_RISE_SCALE,
  CUT_VIEWPORTS,
  DRIFT_MAX_PX,
  DRIFT_PX_PER_S,
  ESTABLISH_HOLD_MS,
  PEAK_PUSH_MS,
  PEAK_PUSH_STOPS,
  PEAK_TURN_HOLD_MS,
  REFRAME_MS,
  SHOT_MIN_HOLD_MS,
  SHOT_STOP,
  type Shot,
  type ShotKind,
  type ShotSpec,
  type ShotTarget,
  driftAt,
  holdState,
  moveFrame,
  nextShot,
  peakPushAt,
  planMove,
  pushedStop,
  shotKindFor,
  shotOnTurn,
  takeShot,
  travelViewports,
} from './shot.js'

/** The fake clock every test here runs on: nothing in `shot.ts` may read a real one. */
function clock(startMs = 10_000): { now: number; tick: (ms: number) => number } {
  const c = { now: startMs, tick: (ms: number) => (c.now += ms) }
  return c
}

const KINDS: readonly ShotKind[] = [
  'establish',
  'twoShot',
  'close',
  'follow',
  'single',
  'interior',
  'overview',
]

const CAST: ShotTarget = { at: 'cast', ids: ['nadia', 'yusuf'] }

const shotOf = (kind: ShotKind, nowMs: number): Shot =>
  takeShot({ kind, target: CAST, why: 'Nadia and Yusuf are falling out' }, nowMs)

// ── the grammar table ──────────────────────────────────────────────────────────────────────

describe('the stop each kind asks for', () => {
  it('is the one the grammar names, and the shot carries the clock it was taken on', () => {
    const c = clock()
    const want: Record<ShotKind, number> = {
      establish: 1,
      twoShot: 3,
      close: 4,
      follow: 2,
      single: 2,
      interior: 3,
      overview: 0.5,
    }
    for (const kind of KINDS) {
      const shot = shotOf(kind, c.now)
      expect(shot.stop, kind).toBe(want[kind])
      expect(SHOT_STOP[kind], kind).toBe(want[kind])
      expect(shot.startedMs, kind).toBe(c.now)
      c.tick(1000)
    }
  })

  it('caps a two-shot at 3 however tight the box fits, and keeps a wider fit', () => {
    const two = (fitted: 4 | 3 | 2 | 1): number =>
      takeShot({ kind: 'twoShot', target: CAST, why: 'they are talking', fitted }, 0).stop
    expect(two(4)).toBe(TWO_SHOT_MAX_STOP)
    expect(two(3)).toBe(3)
    expect(two(2)).toBe(2)
    expect(two(1)).toBe(1)
  })

  it('carries the beat it was cut for, or null when it answers to no beat', () => {
    expect(takeShot({ kind: 'close', target: CAST, why: 'a peak', beatId: 'b7' }, 0).beatId).toBe(
      'b7',
    )
    expect(takeShot({ kind: 'close', target: CAST, why: 'a peak' }, 0).beatId).toBeNull()
  })
})

// ── the hold ───────────────────────────────────────────────────────────────────────────────

describe('a hold shorter than minHoldMs is refused', () => {
  it('gives every shot the floor the grammar names it', () => {
    for (const kind of KINDS) {
      const shot = shotOf(kind, 4200)
      expect(shot.minHoldMs, kind).toBe(SHOT_MIN_HOLD_MS[kind])
      expect(holdState(shot, 4200 + shot.minHoldMs), kind).not.toBe('locked')
    }
  })

  it('refuses every cut across an establishing shot until 3200 ms have run', () => {
    const c = clock()
    const shot = shotOf('establish', c.now)
    expect(shot.minHoldMs).toBe(ESTABLISH_HOLD_MS)
    const refused: number[] = []
    while (c.now - shot.startedMs < ESTABLISH_HOLD_MS) {
      if (holdState(shot, c.now) === 'locked') refused.push(c.now)
      c.tick(16)
    }
    expect(refused.length).toBeGreaterThan(190)
    expect(holdState(shot, shot.startedMs + 3199)).toBe('locked')
    expect(holdState(shot, shot.startedMs + 3200)).toBe('free')
    expect(ESTABLISH_HOLD_MS).toBe(3200)
  })

  it('holds a scene-length shot to the town’s own cut floor', () => {
    for (const kind of ['twoShot', 'single', 'interior'] as const) {
      const shot = shotOf(kind, 500)
      expect(shot.minHoldMs, kind).toBe(CUT_MIN_MS)
      expect(holdState(shot, 500 + CUT_MIN_MS - 1), kind).toBe('locked')
      expect(holdState(shot, 500 + CUT_MIN_MS), kind).toBe('free')
    }
  })

  it('never locks a follow or an overview: one ends at its handover, one at the viewer', () => {
    for (const kind of ['follow', 'overview'] as const) {
      const shot = shotOf(kind, 0)
      expect(shot.minHoldMs, kind).toBe(0)
      expect(holdState(shot, 0), kind).toBe('free')
      expect(holdState(shot, 10), kind).toBe('free')
    }
  })
})

// The 6 s close ceiling was read by nobody: `nextShot` refuses a cut on 'locked' alone, so the
// state it answered past six seconds took the identical path 'free' took.
describe('a shot ends when the world moves on, never on a clock of its own', () => {
  it('outlives its own push before it may be cut', () => {
    const shot = shotOf('close', 0)
    expect(shot.minHoldMs).toBe(PEAK_PUSH_MS)
    expect(holdState(shot, PEAK_PUSH_MS - 1)).toBe('locked')
    expect(holdState(shot, PEAK_PUSH_MS)).toBe('free')
  })

  it('★ keeps an hour-long shot of every kind, so long as the world asks for the same one', () => {
    const away: ShotSpec = { kind: 'follow', target: { at: 'body', id: 'omar' }, why: '' }
    for (const kind of KINDS) {
      const shot = shotOf(kind, 0)
      const same: ShotSpec = { kind, target: shot.target, why: shot.why }
      expect(holdState(shot, 3_600_000), kind).toBe('free')
      expect(nextShot(shot, same, 3_600_000), kind).toBe(shot)
      expect(nextShot(shot, away, 3_600_000), kind).not.toBe(shot)
    }
  })
})

// ── the motion choice ──────────────────────────────────────────────────────────────────────

describe('the motion choice flips at 1.2 viewports', () => {
  const screen = { w: 1000, h: 1000 }

  it('measures travel in screens', () => {
    expect(travelViewports(1000, 0, screen)).toBeCloseTo(1)
    expect(travelViewports(0, 500, screen)).toBeCloseTo(0.5)
    expect(travelViewports(0, 0, screen)).toBe(0)
    expect(travelViewports(100, 100, { w: 0, h: 0 })).toBe(0)
  })

  it('reframes under the flip and cuts at it and over it', () => {
    const at = (v: number): string => planMove(v * screen.w, 0, screen).how
    expect(at(0.01)).toBe('reframe')
    expect(at(1.19)).toBe('reframe')
    expect(at(1.2)).toBe('cut')
    expect(at(1.21)).toBe('cut')
    expect(at(3)).toBe('cut')
    expect(CUT_VIEWPORTS).toBe(1.2)
  })

  it('spends 620 ms on a reframe and 310 ms on a cut', () => {
    expect(planMove(100, 0, screen)).toEqual({ how: 'reframe', ms: REFRAME_MS })
    expect(planMove(3000, 0, screen)).toEqual({ how: 'cut', ms: CUT_MS })
    expect([REFRAME_MS, CUT_FALL_MS, CUT_BLACK_MS, CUT_RISE_MS]).toEqual([620, 90, 40, 180])
    expect(CUT_MS).toBe(310)
  })

  it('eases a reframe all the way across and never goes dark doing it', () => {
    const c = clock()
    const move = planMove(300, 0, screen)
    const started = c.now
    let last = -1
    let moved = 0
    while (c.now - started < REFRAME_MS) {
      const f = moveFrame(move, started, c.now)
      expect(f.alpha).toBe(1)
      expect(f.scale).toBe(1)
      expect(f.done).toBe(false)
      expect(f.at).toBeGreaterThanOrEqual(last)
      if (f.at > last) moved++
      last = f.at
      c.tick(16)
    }
    expect(moved).toBeGreaterThan(30)
    expect(moveFrame(move, started, started).at).toBe(0)
    expect(moveFrame(move, started, started + REFRAME_MS)).toEqual({
      at: 1,
      scale: 1,
      alpha: 1,
      done: true,
    })
  })

  it('falls, goes black, and arrives on the far side of a cut', () => {
    const c = clock()
    const move = planMove(3000, 0, screen)
    const started = c.now
    let black = 0
    let before = 0
    let after = 0
    while (c.now - started < CUT_MS) {
      const f = moveFrame(move, started, c.now)
      if (f.alpha === 0) black++
      if (f.at === 0) before++
      else after++
      c.tick(10)
    }
    expect(black).toBeGreaterThan(0)
    expect(before).toBeGreaterThan(0)
    expect(after).toBeGreaterThan(0)

    expect(moveFrame(move, started, started).scale).toBe(1)
    const fell = moveFrame(move, started, started + CUT_FALL_MS - 1)
    expect(fell.scale).toBeLessThan(1)
    expect(fell.scale).toBeGreaterThanOrEqual(CUT_FALL_SCALE)
    expect(fell.alpha).toBeLessThan(0.1)

    const dark = moveFrame(move, started, started + CUT_FALL_MS + 1)
    expect(dark).toEqual({ at: 0, scale: CUT_FALL_SCALE, alpha: 0, done: false })

    const arrive = moveFrame(move, started, started + CUT_FALL_MS + CUT_BLACK_MS)
    expect(arrive.at).toBe(1)
    expect(arrive.scale).toBe(CUT_RISE_SCALE)
    expect(arrive.alpha).toBe(0)

    expect(moveFrame(move, started, started + CUT_MS)).toEqual({
      at: 1,
      scale: 1,
      alpha: 1,
      done: true,
    })
  })
})

// ── what a held shot does while it holds ───────────────────────────────────────────────────

describe('the drift under a held shot', () => {
  it('moves 3.5 world px a second along the facing, and nowhere on a body with none', () => {
    const c = clock()
    const shot = shotOf('twoShot', c.now)
    c.tick(1000)
    const d = driftAt(shot, 'se', c.now)
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(3.5)
    c.tick(1000)
    expect(Math.hypot(...Object.values(driftAt(shot, 'se', c.now)))).toBeCloseTo(7)
    expect(DRIFT_PX_PER_S).toBe(3.5)
    expect(driftAt(shot, null, c.now)).toEqual({ dx: 0, dy: 0 })
    expect(driftAt(shot, 'se', shot.startedMs - 500)).toEqual({ dx: 0, dy: 0 })
  })

  it('drifts the way the body faces, and the opposite way for the opposite facing', () => {
    const shot = shotOf('follow', 0)
    const sign = (f: Facing): [number, number] => {
      const d = driftAt(shot, f, 1000)
      return [Math.sign(d.dx), Math.sign(d.dy)]
    }
    expect(sign('se')).toEqual([1, 1])
    expect(sign('sw')).toEqual([-1, 1])
    expect(sign('ne')).toEqual([1, -1])
    expect(sign('nw')).toEqual([-1, -1])
  })
})

describe('the push over a peak', () => {
  it('reaches a fifth of a stop at 2400 ms, never sooner and never more', () => {
    const c = clock()
    const shot = shotOf('close', c.now)
    let last = -1
    while (c.now - shot.startedMs < 2400) {
      const p = peakPushAt(shot, c.now)
      expect(p).toBeGreaterThanOrEqual(last)
      expect(p).toBeLessThan(0.2)
      last = p
      c.tick(16)
    }
    expect(peakPushAt(shot, shot.startedMs)).toBe(0)
    expect(peakPushAt(shot, shot.startedMs - 100)).toBe(0)
    expect(peakPushAt(shot, shot.startedMs + 2400)).toBeCloseTo(0.2)
    expect(peakPushAt(shot, shot.startedMs + 60_000)).toBeCloseTo(0.2)
    expect(peakPushAt(shot, shot.startedMs + 1200)).toBeGreaterThan(0)
    expect([PEAK_PUSH_MS, PEAK_PUSH_STOPS]).toEqual([2400, 0.2])
  })
})

// ── which shot a scene asks for ────────────────────────────────────────────────────────────

describe('which kind a live scene asks for', () => {
  const scene = (over: Partial<Parameters<typeof shotKindFor>[0]> = {}): ShotKind =>
    shotKindFor({ opening: false, peak: false, indoors: false, walking: false, cast: 2, ...over })

  it('★ takes the interior for a council indoors, where the street shows three closed doors', () => {
    expect(scene({ indoors: true })).toBe('interior')
    expect(scene({ indoors: true, peak: true, opening: true })).toBe('interior')
    expect(SHOT_STOP.interior).toBe(3)
  })

  it('opens a thread on an establishing shot and peaks on a close', () => {
    expect(scene({ opening: true })).toBe('establish')
    expect(scene({ peak: true })).toBe('close')
  })

  it('follows one body walking, and frames two together', () => {
    expect(scene({ walking: true, cast: 1 })).toBe('follow')
    expect(scene({ walking: true, cast: 2 })).toBe('twoShot')
    expect(scene()).toBe('twoShot')
  })

  // ★ 379 of 832 replayed rows read `twoShot` when a large share were the quiet round on ONE
  // standing face: a lone still body fell past every branch and took the two-shot's name.
  it('★ gives one body standing still its own kind, and a scene-length floor', () => {
    expect(scene({ walking: false, cast: 1 })).toBe('single')
    expect(scene({ walking: false, cast: 0 })).toBe('single')
    const shot = shotOf('single', 1000)
    expect(shot.stop).toBe(2)
    expect(holdState(shot, 1000 + CUT_MIN_MS - 1)).toBe('locked')
    expect(holdState(shot, 1000 + CUT_MIN_MS)).toBe('free')
  })

  it('never takes the overview by itself: that shot belongs to the viewer and the day', () => {
    for (const opening of [true, false]) {
      for (const peak of [true, false]) {
        for (const indoors of [true, false]) {
          for (const walking of [true, false]) {
            for (const cast of [0, 1, 2, 5]) {
              expect(shotKindFor({ opening, peak, indoors, walking, cast })).not.toBe('overview')
            }
          }
        }
      }
    }
  })
})

// ── the shot on screen ─────────────────────────────────────────────────────────────────────

// ★ 102 of 832 replayed shots, 12 per cent, held for less than the town's own 8 s cut floor:
// the floor was offered the gateway's CUT alone, so a round turn and a stand-down walked under it.
describe('★ a shot inside its own floor is not replaced', () => {
  const spec = (
    kind: ShotKind,
    who: string,
  ): { kind: ShotKind; target: ShotTarget; why: string } =>
    kind === 'single'
      ? { kind, target: { at: 'body', id: who }, why: 'the round turns' }
      : { kind, target: { at: 'cast', ids: who.split(' ') }, why: 'they are talking' }

  it('★ turns a round away until the shot it would displace has run its 8 s', () => {
    const c = clock()
    const first = nextShot(null, spec('single', 'nadia'), c.now)
    expect(first?.kind).toBe('single')
    let on = first
    const refused: number[] = []
    while (c.now - first!.startedMs < CUT_MIN_MS) {
      on = nextShot(on, spec('single', 'yusuf'), c.now)
      if (on === first) refused.push(c.now)
      c.tick(500)
    }
    expect(refused.length).toBe(16)
    expect(on).toBe(first)
    const landed = nextShot(on, spec('single', 'yusuf'), first!.startedMs + CUT_MIN_MS)
    expect(landed).not.toBe(first)
    expect(landed?.target).toEqual({ at: 'body', id: 'yusuf' })
    expect(landed?.startedMs).toBe(first!.startedMs + CUT_MIN_MS)
  })

  it('★ holds the picture through a stand-down, and lets go once the floor has run', () => {
    const c = clock()
    const on = nextShot(null, spec('twoShot', 'nadia yusuf'), c.now)
    c.tick(CUT_MIN_MS - 1)
    expect(nextShot(on, null, c.now)).toBe(on)
    c.tick(1)
    expect(nextShot(on, null, c.now)).toBeNull()
  })

  it('keeps the shot it is already on rather than restarting its clock', () => {
    const c = clock()
    const on = nextShot(null, spec('twoShot', 'nadia yusuf'), c.now)
    c.tick(20_000)
    const same = nextShot(on, spec('twoShot', 'nadia yusuf'), c.now)
    expect(same).toBe(on)
    expect(same?.startedMs).toBe(on?.startedMs)
  })

  it('★ never makes a hand on the lens wait: a pin lands under a locked two-shot', () => {
    const c = clock()
    const on = nextShot(null, spec('twoShot', 'nadia yusuf'), c.now)
    c.tick(200)
    expect(nextShot(on, spec('single', 'omar'), c.now)).toBe(on)
    const pinned = nextShot(on, spec('single', 'omar'), c.now, true)
    expect(pinned).not.toBe(on)
    expect(pinned?.target).toEqual({ at: 'body', id: 'omar' })
    expect(pinned?.startedMs).toBe(c.now)
  })

  it('lets a follow and an overview go at once: neither holds on a clock', () => {
    const c = clock()
    const follow = nextShot(null, spec('follow', 'nadia'), c.now)
    c.tick(1)
    expect(nextShot(follow, spec('follow', 'yusuf'), c.now)).not.toBe(follow)
  })
})

describe('a held camera drifts, and never past one tile', () => {
  it('★ stops at a tile however long the shot holds', () => {
    const shot = shotOf('twoShot', 0)
    const far = driftAt(shot, 'se', 60_000)
    expect(Math.hypot(far.dx, far.dy)).toBeCloseTo(DRIFT_MAX_PX)
    expect(DRIFT_MAX_PX).toBe(32)
    // Uncapped this is 60 s x 3.5 px, which walks the subject out of the frame.
    expect(60 * DRIFT_PX_PER_S).toBe(210)
    const further = driftAt(shot, 'se', 600_000)
    expect(further).toEqual(far)
    const inside = driftAt(shot, 'se', 5000)
    expect(Math.hypot(inside.dx, inside.dy)).toBeCloseTo(17.5)
  })
})

describe('the stop a close is on', () => {
  it('★ opens one rung wide and arrives at its own stop when the push has run', () => {
    const c = clock()
    const shot = shotOf('close', c.now)
    expect(shot.stop).toBe(4)
    const seen = new Set<number>()
    while (c.now - shot.startedMs < PEAK_PUSH_MS) {
      seen.add(pushedStop(shot, c.now))
      c.tick(16)
    }
    expect([...seen]).toEqual([3])
    expect(pushedStop(shot, shot.startedMs + PEAK_PUSH_MS - 1)).toBe(3)
    expect(pushedStop(shot, shot.startedMs + PEAK_PUSH_MS)).toBe(4)
    expect(pushedStop(shot, shot.startedMs + 60_000)).toBe(4)
  })

  it('leaves every other kind on its own stop from the first frame', () => {
    for (const kind of KINDS) {
      if (kind === 'close') continue
      const shot = shotOf(kind, 0)
      expect(pushedStop(shot, 0), kind).toBe(shot.stop)
      expect(pushedStop(shot, 9000), kind).toBe(shot.stop)
    }
  })
})

// The push had nothing to push over: a close arrived at 4 in its first 2400 ms and then sat
// there for whatever the gateway's score happened to be. A give_way after three presses is the
// world's own record of a scene turning, and it is the moment the camera exists to be on.
describe('★ a turn the world recorded', () => {
  const TURN = { sceneId: 'sc_1' }

  it('★ pushes the camera in again, from the turn and not from the shot', () => {
    const c = clock()
    const shot = shotOf('close', c.now)
    c.tick(5000)
    expect(pushedStop(shot, c.now), 'the first push had long since arrived').toBe(4)
    const turned = shotOnTurn(shot, 'sc_1', TURN, c.now)
    expect(pushedStop(turned, c.now)).toBe(3)
    expect(pushedStop(turned, c.now + PEAK_PUSH_MS - 1)).toBe(3)
    expect(pushedStop(turned, c.now + PEAK_PUSH_MS)).toBe(4)
    expect(peakPushAt(turned, c.now + PEAK_PUSH_MS)).toBeCloseTo(PEAK_PUSH_STOPS)
    expect(turned.startedMs, 'the drift keeps its own origin').toBe(shot.startedMs)
  })

  it('★ holds fourteen seconds from the turn, so the camera stays for the aftermath', () => {
    const c = clock()
    const shot = shotOf('close', c.now)
    c.tick(5000)
    expect(holdState(shot, c.now), 'an unturned close is replaceable from 2.4 s').toBe('free')
    const turned = shotOnTurn(shot, 'sc_1', TURN, c.now)
    expect(holdState(turned, c.now)).toBe('locked')
    expect(holdState(turned, c.now + PEAK_TURN_HOLD_MS - 1)).toBe('locked')
    expect(holdState(turned, c.now + PEAK_TURN_HOLD_MS)).not.toBe('locked')
    expect(PEAK_TURN_HOLD_MS).toBe(14_000)
  })

  // ★ `holdState` asked a 6 s close ceiling before the floor, so a shot told to hold 14 s went
  // free at six and the aftermath was cut away from at the same 6 s it always had been. The
  // ceiling is gone; the rule it broke is asserted where a caller reads it.
  it('★ is not cut short six seconds in, by any ceiling', () => {
    const c = clock()
    const two = shotOf('twoShot', c.now)
    const turned = shotOnTurn(two, 'sc_1', TURN, c.now)
    expect(turned.kind, 'a turn IS the peak, and the camera answers a peak with a close').toBe(
      'close',
    )
    expect(turned.stop).toBe(4)
    const away: ShotSpec = { kind: 'single', target: { at: 'body', id: 'omar' }, why: '' }
    expect(holdState(turned, c.now + 6000)).toBe('locked')
    expect(nextShot(turned, away, c.now + 6000)).toBe(turned)
    expect(nextShot(turned, away, c.now + PEAK_TURN_HOLD_MS)).not.toBe(turned)
  })

  it('★ moves nothing at all when it lands in a scene the camera is not on', () => {
    const c = clock()
    const shot = shotOf('close', c.now)
    c.tick(5000)
    expect(shotOnTurn(shot, 'sc_1', { sceneId: 'sc_2' }, c.now)).toBe(shot)
    expect(shotOnTurn(shot, null, TURN, c.now)).toBe(shot)
    expect(pushedStop(shotOnTurn(shot, 'sc_1', { sceneId: 'sc_2' }, c.now), c.now)).toBe(4)
  })

  it('★ never holds a hand on the lens for an aftermath it did not ask to watch', () => {
    const c = clock()
    const turned = shotOnTurn(shotOf('close', c.now), 'sc_1', TURN, c.now)
    c.tick(100)
    const away: ShotSpec = { kind: 'single', target: { at: 'body', id: 'omar' }, why: '' }
    expect(nextShot(turned, away, c.now)).toBe(turned)
    const byHand = nextShot(turned, away, c.now, true)
    expect(byHand).not.toBe(turned)
    expect(byHand?.target).toEqual({ at: 'body', id: 'omar' })
    expect(byHand?.startedMs).toBe(c.now)
  })
})
