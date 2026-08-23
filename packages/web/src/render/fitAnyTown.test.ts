import { describe, expect, it } from 'vitest'
import {
  FIT_MARGIN_PX, ZOOM_STOPS, drawnBoundsOf, fitStop, fitsAt, tooBigToFit,
} from './camera.js'
import { bigTown, bigTownScreenSize } from './bigTown.js'

/** The audit's stage, less the 56 px the control bar takes off the bottom (task 77). */
const STAGE = { w: 1728, h: 880 - 56 }

// ── ★ "THE WHOLE TOWN" MUST MEAN A TOWN OF ANY SIZE ───────────────────────────────────────
//
// The control exists and the stop ladder stopped at 0.5. Measured on the ring grammar, 0.5
// holds two rings and no more: a three-ring town is 4224 × 2112 px, and half of that is
// 2112 × 1056 against 1680 × 776 of usable stage. `fitStop` fell to 0.5, the town did not fit,
// and nothing said so — the viewer pressed "The whole town" and got most of the town.
//
// THE CHOICE, and why it is not a continuous scale. P18: rest stops stay exact so the pixel
// grid stays exact. 0.25 is 1/4 — four world px become one screen px with no resampling — so
// it joins the ladder without touching the NEAREST law. A fitted scale of, say, 0.387 would
// resample every sprite in the town into shimmer, on the surface people watch.
//
// AND WHY THE LADDER STOPS THERE. 0.25 holds four rings, 640 buildings. Below it the
// interface fails before the picture does: the ≥24 screen px hit floor is a WORLD size of
// 24 / z, so at 0.125 a door's target is 192 world px — six tiles wide, swallowing its
// neighbours. A view whose controls do not work is not a wider view. Past four rings the
// answer is navigation, and `tooBigToFit` is how the bar says so out loud.

describe('the stop ladder', () => {
  it('gained one stop below the old floor, and it is an exact reciprocal', () => {
    expect(ZOOM_STOPS[0]).toBe(0.25)
    for (const z of ZOOM_STOPS) expect(Number.isInteger(z) || Number.isInteger(1 / z)).toBe(true)
  })

  it('is still strictly increasing, and still ends at 4', () => {
    for (let i = 1; i < ZOOM_STOPS.length; i++) expect(ZOOM_STOPS[i]!).toBeGreaterThan(ZOOM_STOPS[i - 1]!)
    expect(ZOOM_STOPS.at(-1)).toBe(4)
  })
})

describe('fitsAt — the predicate the fit and the refusal both read', () => {
  const box = drawnBoundsOf(bigTown(1))

  it('agrees with fitStop: the stop it picks fits, and the next one up does not', () => {
    for (const rings of [1, 2, 3, 4]) {
      const b = drawnBoundsOf(bigTown(rings))
      const stop = fitStop(b, STAGE)
      const nextUp = ZOOM_STOPS[ZOOM_STOPS.indexOf(stop) + 1]
      if (fitsAt(b, STAGE, stop)) {
        if (nextUp !== undefined) expect(fitsAt(b, STAGE, nextUp), `${rings} rings`).toBe(false)
      }
    }
  })

  it('keeps FIT_MARGIN_PX on every side', () => {
    // whichever axis binds first is the one the margin is measured on
    const exact = Math.min(
      (STAGE.w - 2 * FIT_MARGIN_PX) / (box.maxX - box.minX),
      (STAGE.h - 2 * FIT_MARGIN_PX) / (box.maxY - box.minY),
    )
    expect(fitsAt(box, STAGE, exact)).toBe(true)
    expect(fitsAt(box, STAGE, exact * 1.001)).toBe(false)
  })
})

describe('★ how far out the camera goes, said in ring counts', () => {
  const fitsWhole = (rings: number): boolean => {
    const b = drawnBoundsOf(bigTown(rings))
    return fitsAt(b, STAGE, fitStop(b, STAGE))
  }

  it('holds a four-ring town — 640 buildings — in one view, and not a five-ring one', () => {
    expect(bigTown(4)).toHaveLength(640)
    expect(fitsWhole(4)).toBe(true)
    expect(fitsWhole(5)).toBe(false)
  })

  it('★ says so honestly when a town has outgrown the widest stop', () => {
    // ten rings: 3520 buildings over 12 768 × 6384 px. A quarter of that is 3192 × 1596
    // against 1680 × 776 — it does not fit and no stop on this ladder can make it.
    const ten = drawnBoundsOf(bigTown(10))
    expect(bigTownScreenSize(10).w).toBeGreaterThan(12_000)
    expect(tooBigToFit(ten, STAGE)).toBe(true)
    expect(fitStop(ten, STAGE)).toBe(ZOOM_STOPS[0])
  })

  it('says nothing of the sort about a town that does fit', () => {
    expect(tooBigToFit(drawnBoundsOf(bigTown(1)), STAGE)).toBe(false)
    expect(tooBigToFit(drawnBoundsOf(bigTown(4)), STAGE)).toBe(false)
  })

  it('the refusal and the fit can never disagree — one predicate, both answers', () => {
    for (const rings of [1, 2, 3, 4, 5, 6, 10]) {
      const b = drawnBoundsOf(bigTown(rings))
      expect(tooBigToFit(b, STAGE), `${rings} rings`).toBe(!fitsAt(b, STAGE, fitStop(b, STAGE)))
    }
  })

  it('never throws on a town of no size at all', () => {
    const empty = drawnBoundsOf([])
    expect(tooBigToFit(empty, STAGE)).toBe(false)
    expect(fitsAt(empty, STAGE, 1)).toBe(true)
  })
})
