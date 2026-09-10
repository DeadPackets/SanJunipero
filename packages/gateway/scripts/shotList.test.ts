import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { type StakeScore, TICK_REAL_MS } from '@sj/shared'
import { quietRound } from '../../web/src/ui/autoCut.js'
import { cameraClaim } from '../../web/src/ui/directorCut.js'
import { type ShotRow, shotTape, summarise, tickFloor } from './shotList.js'

const row = (tick: number, dwellMs: number, over: Partial<ShotRow> = {}): ShotRow => ({
  tick,
  wallMs: tick * TICK_REAL_MS,
  kind: 'twoShot',
  target: 'Nadia, Yusuf',
  stop: 3,
  dwellMs,
  why: 'they are falling out',
  beatId: null,
  ...over,
})

describe('the shot list summary', () => {
  const span = { fromTick: 0, toTick: 600 }
  const rows: ShotRow[] = [
    row(10, 3000, { kind: 'establish', stop: 1 }),
    row(20, 9000),
    row(60, 6000, { kind: 'close', stop: 4 }),
    row(120, 24_000, { kind: 'overview', stop: 0.5 }),
    row(400, 12_000, { kind: 'follow', stop: 2 }),
  ]

  it('counts the shots against the sim-hours the span actually covers', () => {
    const s = summarise(rows, span, 0)
    expect(s.shots).toBe(5)
    expect(s.simHours).toBe(10)
    expect(s.perSimHour).toBe(0.5)
  })

  it('takes the median and the p90 by nearest rank, so both are dwells the town held', () => {
    const s = summarise(rows, span, 0)
    expect(s.medianDwellMs).toBe(9000)
    expect(s.p90DwellMs).toBe(24_000)
    const two = summarise([row(0, 1000), row(5, 2000)], span, 0)
    expect(two.medianDwellMs).toBe(1000)
    expect(two.p90DwellMs).toBe(2000)
  })

  it('names every kind of shot, including the ones the town never took', () => {
    const s = summarise(rows, span, 0)
    expect(s.kinds).toEqual({
      establish: 1,
      twoShot: 1,
      close: 1,
      follow: 1,
      single: 0,
      interior: 0,
      overview: 1,
    })
  })

  it('reports the floor refusals it was handed', () => {
    expect(summarise(rows, span, 17).refused).toBe(17)
  })

  it('counts the run up to the first shot as a stretch with no cut in it', () => {
    // 10 ticks before the first cut is 30 s of one picture, longer than the longest shot.
    expect(summarise(rows, span, 0).longestGapMs).toBe(30_000)
    expect(summarise(rows, { fromTick: 0, toTick: 405 }, 0).longestGapMs).toBe(30_000)
    const late = [row(2, 3000), row(20, 90_000)]
    expect(summarise(late, span, 0).longestGapMs).toBe(90_000)
  })

  it('answers over a log the camera never cut in', () => {
    const s = summarise([], { fromTick: 0, toTick: 120 }, 0)
    expect(s.shots).toBe(0)
    expect(s.perSimHour).toBe(0)
    expect(s.medianDwellMs).toBe(0)
    expect(s.p90DwellMs).toBe(0)
    expect(s.longestGapMs).toBe(120 * TICK_REAL_MS)
  })
})

const NOBODY: readonly string[] = []

const scored = (agentIds: string[], over: Partial<StakeScore> = {}): StakeScore => ({
  sceneId: 's1',
  agentIds,
  score: 5,
  why: 'they are falling out',
  ...over,
})

/** The camera the replay drives, over a clock made of ticks. */
const town = (): {
  tick: (
    at: number,
    of: {
      cut?: StakeScore | null
      outdoors?: string[]
      indoors?: Record<string, string>
      walking?: string[]
    },
  ) => void
  rows: (at: number) => ShotRow[]
  refused: () => number
} => {
  const floor = tickFloor()
  const round = quietRound()
  const tape = shotTape((id) => id.toUpperCase())
  return {
    tick(at, of) {
      const inside = of.indoors ?? {}
      const held = floor.hold(of.cut ?? null, at * TICK_REAL_MS)
      const claim = cameraClaim(
        null,
        NOBODY,
        new Set(Object.keys(inside)),
        { cut: held, quiet: false },
        false,
        round(of.outdoors ?? [], at),
        (id) => inside[id] ?? null,
      )
      tape.at(at, claim, { cut: held, walking: new Set(of.walking ?? []) })
    },
    rows: (at) => tape.close(at),
    refused: () => floor.refused(),
  }
}

describe('the cut floor the replay reads', () => {
  it('counts one refusal for a want it turns away, however many ticks that want stands', () => {
    const floor = tickFloor()
    expect(floor.hold(scored(['a']), 0)?.agentIds).toEqual(['a'])
    // 8s of floor is two whole ticks: the same want is offered and turned away on both.
    expect(floor.hold(scored(['b']), 1 * TICK_REAL_MS)?.agentIds).toEqual(['a'])
    expect(floor.hold(scored(['b']), 2 * TICK_REAL_MS)?.agentIds).toEqual(['a'])
    expect(floor.refused()).toBe(1)
    expect(floor.hold(scored(['b']), 3 * TICK_REAL_MS)?.agentIds).toEqual(['b'])
    expect(floor.refused()).toBe(1)
  })

  it('counts a second refusal when the want the gateway is holding out changes', () => {
    const floor = tickFloor()
    floor.hold(scored(['a']), 0)
    floor.hold(scored(['b']), 1 * TICK_REAL_MS)
    floor.hold(scored(['c']), 2 * TICK_REAL_MS)
    expect(floor.refused()).toBe(2)
  })
})

describe('the camera the replay drives', () => {
  // ★ WHAT WAS LEARNED: this used to end on two rows and a 3 s dwell, because the tape closed a
  // shot the browser would have kept. The gateway's floor really is off a round turn, but the shot
  // on screen holds its own 8 s, so the round waits and the table stops reporting a cut nobody saw.
  it('★ turns the quiet round without the gateway floor, but not inside the shot own floor', () => {
    const t = town()
    t.tick(0, { cut: scored(['a', 'b']), outdoors: ['a', 'b', 'c'] })
    t.tick(1, { outdoors: ['a', 'b', 'c'] })
    expect(
      t.rows(2).map((r) => r.target),
      'the two-shot is still up at 3 s',
    ).toEqual(['A, B'])
    expect(t.refused(), 'and the gateway floor turned nothing away').toBe(0)

    const later = town()
    later.tick(0, { cut: scored(['a', 'b']), outdoors: ['a', 'b', 'c'] })
    later.tick(3, { outdoors: ['a', 'b', 'c'] })
    const rows = later.rows(4)
    expect(
      rows.map((r) => r.target),
      'past the floor the round takes the camera',
    ).toEqual(['A, B', 'A'])
    expect(rows[0]!.dwellMs, 'and the two-shot held every millisecond of it').toBe(3 * TICK_REAL_MS)
  })

  it('holds one face for the whole turn while the street around it changes', () => {
    const t = town()
    for (let at = 60; at < 120; at++)
      t.tick(at, { outdoors: at < 90 ? ['a', 'b', 'c'] : ['b', 'c', 'd'] })
    t.tick(120, { outdoors: ['b', 'c', 'd'] })
    const rows = t.rows(121)
    expect(rows.map((r) => r.target)).toEqual(['B', 'D'])
    expect(rows[0]!.dwellMs).toBe(60 * TICK_REAL_MS)
  })

  it('holds the shot that is up when the town claims the camera, and opens on one', () => {
    const opening = town()
    opening.tick(0, {})
    expect(opening.rows(1).map((r) => r.kind)).toEqual(['overview'])

    const t = town()
    t.tick(0, { outdoors: ['a'] })
    for (let at = 1; at < 5; at++) t.tick(at, {})
    const rows = t.rows(5)
    expect(rows.map((r) => r.target)).toEqual(['A'])
    expect(rows[0]!.dwellMs).toBe(5 * TICK_REAL_MS)
  })

  it('does not cut because a body it is already on started walking', () => {
    const t = town()
    t.tick(0, { outdoors: ['a'] })
    t.tick(1, { outdoors: ['a'], walking: ['a'] })
    const rows = t.rows(2)
    expect(rows.map((r) => r.target)).toEqual(['A'])
    expect(rows[0]!.dwellMs).toBe(2 * TICK_REAL_MS)
  })

  it('takes an interior of the room a cut cast has walked into', () => {
    const t = town()
    t.tick(0, { cut: scored(['a', 'b']), indoors: { a: 'house1', b: 'house1' } })
    const rows = t.rows(1)
    expect(rows.map((r) => [r.kind, r.target])).toEqual([['interior', 'A, B']])
  })

  it('stands where the cast fits, not where the grammar would stand', () => {
    const tape = shotTape((id) => id)
    tape.at(
      0,
      { by: 'cut', cast: ['a', 'b'] },
      { cut: scored(['a', 'b'], { sceneId: null }), walking: new Set(), fitted: 1 },
    )
    expect(tape.close(1)[0]!.stop).toBe(1)
  })
})

describe('the run refuses to fold a world it was not told the shape of', () => {
  it('will not run without the config the log does not record', () => {
    let code = 0
    let err = ''
    try {
      execFileSync('npx', ['tsx', 'packages/gateway/scripts/directorTopFive.ts', 'world.db'], {
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (e) {
      const fail = e as { status?: number; stderr?: string }
      code = fail.status ?? 0
      err = fail.stderr ?? ''
    }
    expect(code).toBe(1)
    expect(err).toContain('--config=')
  }, 60_000)
})
