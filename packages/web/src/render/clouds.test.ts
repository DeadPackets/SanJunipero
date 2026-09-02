import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, dayPhaseFromTick } from '@sj/shared'
import {
  CLOUD_ALPHA,
  CLOUD_COUNT,
  CLOUD_DRIFT_PX_PER_S,
  CLOUD_H,
  CLOUD_W,
  CLOUD_WRAP_PX,
  cloudAt,
  cloudsShown,
} from './clouds.js'
import { wind } from './wind.js'

// ★ At the overview stop a swaying crown is twelve pixels and a bird is one, so an unattended
// frame held still for minutes at a time. A cloud shadow is the cheapest thing that changes a
// whole picture: no art, one multiply, and the widest surface the town has to cross.

describe('★ cloud shadows drift with the town’s own wind', () => {
  it('is three to five blobs, wider than they are tall like the ground they lie on', () => {
    expect(CLOUD_COUNT).toBeGreaterThanOrEqual(3)
    expect(CLOUD_COUNT).toBeLessThanOrEqual(5)
    expect(CLOUD_W).toBe(2 * CLOUD_H) // the 2:1 dimetric plane
  })

  it('★ advances with the wind vector, and the same wind moves every blob the same way', () => {
    const at = (drift: number) =>
      Array.from({ length: CLOUD_COUNT }, (_, i) => cloudAt(i, CLOUD_COUNT, drift).x)
    const before = at(0)
    const after = at(40)
    for (let i = 0; i < CLOUD_COUNT; i++) {
      expect(after[i]! - before[i]!, `blob ${i}`).toBeCloseTo(40)
    }
    // ...and a wind blowing the other way carries them back, once the wrap is unwound
    const step = (a: number, b: number): number =>
      (((b - a + CLOUD_WRAP_PX / 2) % CLOUD_WRAP_PX) + CLOUD_WRAP_PX) % CLOUD_WRAP_PX -
      CLOUD_WRAP_PX / 2
    const back = at(-40)
    for (let i = 0; i < CLOUD_COUNT; i++) {
      expect(step(before[i]!, back[i]!), `blob ${i}`).toBeCloseTo(-40)
    }
  })

  it('★ takes the drift from `wind`, in world pixels a second', () => {
    // one second of full wind is CLOUD_DRIFT_PX_PER_S; the wind itself is bounded to [-1, 1]
    for (const t of [0, 3.5, 11, 60, 999]) expect(Math.abs(wind(t))).toBeLessThanOrEqual(1)
    expect(CLOUD_DRIFT_PX_PER_S).toBeGreaterThan(0)
  })

  it('comes round rather than running out of town, and stays inside its own wrap', () => {
    for (const drift of [0, 700, 1400, 5000, -5000]) {
      for (let i = 0; i < CLOUD_COUNT; i++) {
        const { x, y } = cloudAt(i, CLOUD_COUNT, drift)
        expect(Math.abs(x), `blob ${i} at ${drift}`).toBeLessThanOrEqual(CLOUD_WRAP_PX / 2)
        expect(Math.abs(y)).toBeLessThanOrEqual(CLOUD_WRAP_PX / 2)
      }
    }
  })

  it('spreads them out: no two blobs sit on one lane or start on one spot', () => {
    const lanes = new Set(Array.from({ length: CLOUD_COUNT }, (_, i) => cloudAt(i, CLOUD_COUNT, 0).y))
    expect(lanes.size).toBe(CLOUD_COUNT)
    const starts = new Set(
      Array.from({ length: CLOUD_COUNT }, (_, i) => cloudAt(i, CLOUD_COUNT, 0).x),
    )
    expect(starts.size).toBe(CLOUD_COUNT)
  })

  it('is deterministic — two browsers on one tick see the same sky', () => {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      expect(cloudAt(i, CLOUD_COUNT, 123.5)).toEqual(cloudAt(i, CLOUD_COUNT, 123.5))
    }
  })

  it('lies lightly enough to read as weather rather than as ground', () => {
    expect(CLOUD_ALPHA).toBeLessThanOrEqual(0.15)
    expect(readFileSync(new URL('./clouds.ts', import.meta.url), 'utf8')).toContain(
      "node.blendMode = 'multiply'",
    )
  })
})

// ★ There is nothing to cast a shadow at night, and a darker patch on the blue wash is a stain.
describe('★ the layer draws nothing when there is no sun over the town', () => {
  it('★ is off at night and on through the lit hours', () => {
    const at = (hour: number): number => hour * 60
    expect(cloudsShown(at(22))).toBe(false)
    expect(cloudsShown(at(2))).toBe(false)
    expect(cloudsShown(at(12))).toBe(true)
    expect(cloudsShown(at(6))).toBe(true) // dawn
    expect(cloudsShown(at(19))).toBe(true) // dusk
  })

  it('★ takes the ONE phase derivation in the codebase, so the light and the shadow agree', () => {
    for (let tick = 0; tick < MINUTES_PER_DAY; tick += 7) {
      expect(cloudsShown(tick), `tick ${tick}`).toBe(dayPhaseFromTick(tick) !== 'night')
    }
  })

  it('holds still for a viewer who asked for stillness, rather than going away', () => {
    const SRC = readFileSync(new URL('./clouds.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('const still = !scene.wantsMotion()')
    expect(SRC).toContain('if (!still) driftPx +=')
  })
})
