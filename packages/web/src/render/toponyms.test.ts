import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { ZOOM_STOPS } from './camera.js'
import { AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, bandRatios } from './legibility.js'
import { TEXT_MIN_PX } from '../textFloor.js'
import { TOPONYM_FULL_SCALE, TOPONYM_LABEL_PX, toponymAlpha, toponymsOf } from './toponyms.js'

function carved(
  id: string,
  x: number,
  y: number,
  inscription?: { text: string; by: string },
  stage: 'construction' | 'complete' = 'complete',
  name?: string,
): WorldState['structures'][string] {
  return {
    id,
    kind: 'standing_stone',
    x,
    y,
    w: 1,
    h: 1,
    hp: 10,
    maxHp: 10,
    flammable: false,
    stage,
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
    ...(inscription === undefined ? {} : { inscription }),
    ...(name === undefined ? {} : { name }),
  }
}

const town = (structures: WorldState['structures']): WorldState => ({
  ...genesisState(DEFAULT_CONFIG),
  structures,
})

describe('toponymsOf — the names the town cut for itself', () => {
  it('takes the carved words verbatim, and where they were cut', () => {
    const state = town({
      s1: carved('s1', 4, 9, { text: 'the drowned ford', by: 'omar' }),
    })
    expect(toponymsOf(state)).toEqual([{ id: 's1', name: 'the drowned ford', x: 4, y: 9 }])
  })

  it('names nothing unmarked, nothing blank and nothing still going up', () => {
    const state = town({
      bare: carved('bare', 0, 0),
      blank: carved('blank', 1, 1, { text: '   ', by: 'omar' }),
      rising: carved('rising', 2, 2, { text: 'the new wall', by: 'omar' }, 'construction'),
    })
    expect(toponymsOf(state)).toEqual([])
  })

  it('answers in one order, so two calls place the same names in the same slots', () => {
    const state = town({
      z: carved('z', 0, 0, { text: 'last', by: 'o' }),
      a: carved('a', 1, 1, { text: 'first', by: 'o' }),
    })
    expect(toponymsOf(state).map((t) => t.id)).toEqual(['a', 'z'])
  })

  // The map and the minds have to read one set of names. A founding building nobody has ever
  // carved on has a name, and the map could not see it while it only read the carvings.
  it('★ shows what a place is CALLED, so a founding name reaches the map uncarved', () => {
    const s = town({ a: carved('a', 3, 4, undefined, 'complete', 'the old farmhouse') })
    expect(toponymsOf(s)).toEqual([{ id: 'a', name: 'the old farmhouse', x: 3, y: 4 }])
  })

  it('and the name outranks a carving that never became one', () => {
    const s = town({
      a: carved(
        'a',
        3,
        4,
        { text: 'I miss the sea', by: 'amara' },
        'complete',
        'the old farmhouse',
      ),
    })
    expect(toponymsOf(s)[0]!.name).toBe('the old farmhouse')
  })

  it('has nothing to say before the first snapshot', () => {
    expect(toponymsOf(null)).toEqual([])
  })
})

// ★ Eleven carved names stood at full alpha from the 0.5 stop in — that is, always — in caps on
// ink plates, so the loudest text in the product named the furniture.
describe('toponymAlpha — whole or gone, never between', () => {
  it('★ is gone at the overview and whole from the 2× stop in', () => {
    expect(TOPONYM_FULL_SCALE).toBe(2)
    expect(toponymAlpha(0.25)).toBe(0)
    expect(toponymAlpha(0.5)).toBe(0)
    expect(toponymAlpha(1)).toBe(0)
    expect(toponymAlpha(2)).toBe(1)
    expect(toponymAlpha(4)).toBe(1)
  })

  it('★ is 0 or 1 at every resting stop — a name at 0.5 alpha has no contrast ratio', () => {
    for (const stop of ZOOM_STOPS) expect([0, 1], `stop ${stop}`).toContain(toponymAlpha(stop))
  })

  it('fades over the transit rather than snapping on, so a zoom does not flash the names', () => {
    expect(toponymAlpha(1.5)).toBeCloseTo(0.5)
  })
})

// ★ A picked building wore three labels at once: its carved name, the nameplate under it and
// the hover plate. The nameplate is the one the viewer asked for, so it is the one that stands.
describe('★ one label for the thing that is picked', () => {
  it('★ hides its own carved name for whatever the viewer picked', () => {
    const SRC = readFileSync(new URL('./toponyms.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('scene.pickedId')
  })
})

describe('a carved name is readable where it is cut', () => {
  it('never renders below the chrome type floor', () => {
    expect(TOPONYM_LABEL_PX).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })

  it('clears AA against the ink it is cut into, in both halves of the day', () => {
    const r = bandRatios(LANDMARK_PLATE, LANDMARK_INK)
    expect(r.day).toBeGreaterThanOrEqual(AA_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(AA_RATIO)
  })
})

describe('a name stays with the thing it is cut into', () => {
  const src = readFileSync(new URL('./toponyms.ts', import.meta.url), 'utf8')

  // `placeTag` clamps into the view, so an anchor that has left the screen would drag its name
  // to an edge and leave it there with nothing under it.
  it('is not drawn once it is off its own leash', () => {
    expect(src).toContain('leashAt')
    expect(src).toMatch(/if \(!hits\(rect, leashAt\([\s\S]{0,80}cut\.node\.visible = false/)
  })

  // The glyph's own colour is the one channel this renderer is measured to drop.
  it('carries its ink as a drawn slab, never as a halo of glyphs', () => {
    expect(src).toContain('plate.fill(LANDMARK_INK)')
    expect(src).not.toContain('HALO')
  })
})
