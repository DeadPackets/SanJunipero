import { describe, expect, it } from 'vitest'
import { bigTown } from './bigTown.js'
import { bodyDepthBox, structureDepthBox, tileDepthBox, type DepthBox } from './depth.js'
import { CULL_MARGIN_PX, boxInView, cullByBox, type ViewRect } from './cull.js'

const VIEW: ViewRect = { x: 0, y: 0, w: 800, h: 600 }

/** The AABB the renderer will actually paint — the cull's own margin plays no part in it. */
function drawnIntersectsView(b: DepthBox, v: ViewRect): boolean {
  return b.sx1 >= v.x && b.sx0 <= v.x + v.w && b.sy1 >= v.y && b.sy0 <= v.y + v.h
}

describe('boxInView — the visible rect, and the overhang a footprint cannot see', () => {
  it('keeps a box wholly inside the view', () => {
    expect(boxInView(tileDepthBox('t', 10, 10), VIEW)).toBe(true)
  })

  it('drops a box far outside it', () => {
    const far = structureDepthBox('far', { x: 400, y: 400, w: 2, h: 2 })
    expect(boxInView(far, VIEW)).toBe(false)
  })

  it('★ keeps a building whose FOOTPRINT is off screen and whose ROOF is not', () => {
    // A 4×2 sprite is drawn to a (4+2)·32 = 192 px square anchored at its base diamond, so it
    // reaches 192 px ABOVE the ground it stands on. Cull on the footprint and this one pops in.
    const b = structureDepthBox('roof', { x: 20, y: 20, w: 4, h: 2 })
    const ground = b.sy0 + 192
    // The bottom edge sits 150 px above the building's ground — further than CULL_MARGIN_PX,
    // so only the overhang in the box itself can save this one.
    const below: ViewRect = { x: b.sx0 - 100, y: ground - 650, w: 800, h: 500 }
    const bottom = below.y + below.h
    expect(b.sy0).toBeLessThan(bottom)                        // the roof is inside
    expect(ground - bottom).toBeGreaterThan(CULL_MARGIN_PX)   // the ground is well outside
    expect(boxInView(b, below)).toBe(true)
  })

  it('is inclusive at the margin and exclusive one pixel past it', () => {
    const at: DepthBox = { ...tileDepthBox('a', 0, 0), sx0: -CULL_MARGIN_PX - 10, sx1: -CULL_MARGIN_PX, sy0: 0, sy1: 10 }
    const past: DepthBox = { ...at, sx1: -CULL_MARGIN_PX - 1 }
    expect(boxInView(at, VIEW)).toBe(true)
    expect(boxInView(past, VIEW)).toBe(false)
  })

  it('takes the margin it is given rather than only its own', () => {
    const b: DepthBox = { ...tileDepthBox('a', 0, 0), sx0: -50, sx1: -40, sy0: 0, sy1: 10 }
    expect(boxInView(b, VIEW, 0)).toBe(false)
    expect(boxInView(b, VIEW, 40)).toBe(true)
  })
})

describe('cullByBox', () => {
  const entries = [
    { box: tileDepthBox('in', 10, 10) },
    { box: structureDepthBox('out', { x: 500, y: 500, w: 2, h: 2 }) },
    { box: bodyDepthBox('body', 12, 12) },
  ]

  it('splits the set and loses none of it', () => {
    const c = cullByBox(entries, VIEW)
    expect(c.drawn.map((e) => e.box.id)).toEqual(['in', 'body'])
    expect(c.hidden.map((e) => e.box.id)).toEqual(['out'])
    expect(c.drawn.length + c.hidden.length).toBe(entries.length)
  })

  it('keeps arrival order inside each half, so the depth seed is untouched', () => {
    const many = bigTown(1).map((s) => ({ box: structureDepthBox(s.id, s) }))
    const c = cullByBox(many, { x: -4000, y: -4000, w: 8000, h: 8000 })
    expect(c.drawn.map((e) => e.box.id)).toEqual(many.map((e) => e.box.id))
  })
})

// ── THE POPPING TEST ──────────────────────────────────────────────────────────────────────
// A pop is a drawable whose painted pixels are already inside the view while the cull still
// calls it hidden.

describe('nothing ever pops in at an edge', () => {
  const boxes = bigTown(2).map((s) => structureDepthBox(s.id, s))

  for (const [name, axis] of [['panning east', 'x'], ['panning south', 'y']] as const) {
    it(`${name}: no box is hidden while any of its painted pixels are on screen`, () => {
      const offenders: string[] = []
      for (let step = -2000; step <= 2000; step += 17) {
        const view: ViewRect =
          axis === 'x' ? { x: step, y: 0, w: 800, h: 600 } : { x: 0, y: step, w: 800, h: 600 }
        for (const b of boxes) {
          if (drawnIntersectsView(b, view) && !boxInView(b, view)) {
            offenders.push(`${b.id} at ${axis}=${step}`)
          }
        }
      }
      expect(offenders.slice(0, 5), `${offenders.length} pops`).toEqual([])
    })
  }

  it('holds for bodies too, which are drawn from their feet', () => {
    const bodies = Array.from({ length: 200 }, (_, i) => bodyDepthBox(`b${i}`, i * 3, (i * 7) % 90))
    for (let step = -1500; step <= 1500; step += 13) {
      const view: ViewRect = { x: step, y: step / 2, w: 800, h: 600 }
      for (const b of bodies) {
        if (drawnIntersectsView(b, view)) expect(boxInView(b, view), `${b.id} at ${step}`).toBe(true)
      }
    }
  })
})

describe('the cull is a view, never a record', () => {
  it('decides from geometry alone — same boxes and view, same answer, every time', () => {
    const boxes = bigTown(1).map((s) => structureDepthBox(s.id, s))
    const once = boxes.filter((b) => boxInView(b, VIEW)).map((b) => b.id)
    const twice = boxes.filter((b) => boxInView(b, VIEW)).map((b) => b.id)
    expect(twice).toEqual(once)
  })
})
