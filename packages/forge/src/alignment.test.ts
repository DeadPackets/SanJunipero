import { describe, it, expect } from 'vitest'
import { DEFAULT_FORGE_CONFIG } from './forgeConfig.js'
import type { RawImage } from './post/raw.js'
import {
  footprintDiamond, validateBuildingAlignment, testGridRender, toTargetCell,
  SEAT_CRITERION_PROMPT, GRID_MARGIN, DIAMOND_STROKE, type AlignmentConfig,
} from './alignment.js'
import { nativeDensityGate, spriteDensity } from './pixelGates.js'
import { targetSize } from './styleBible.js'

const CFG: AlignmentConfig = DEFAULT_FORGE_CONFIG.alignment
const FP = { w: 1, h: 1 }
const CELL = { w: 64, h: 64, feetY: 56 }        // real cells pad below the feet line (v4 manifests do)
const D = footprintDiamond(FP, CELL)            // nearVertexY 56, centerX 32, leftX 16, rightX 48

// A solid block `width` wide, centred on the diamond, 20 rows tall, bottom row at `bottomY`.
function block(bottomY: number, width: number): RawImage {
  const img: RawImage = { width: CELL.w, height: CELL.h, data: new Uint8ClampedArray(CELL.w * CELL.h * 4) }
  const x0 = Math.round(D.centerX - width / 2)
  for (let y = bottomY - 19; y <= bottomY; y++)
    for (let x = x0; x < x0 + width; x++) {
      if (y < 0 || y >= CELL.h || x < 0 || x >= CELL.w) continue
      const i = (y * CELL.w + x) * 4
      img.data[i] = 0xD4; img.data[i + 1] = 0xBC; img.data[i + 2] = 0x9E; img.data[i + 3] = 255
    }
  return img
}
const EXACT = D.rightX - D.leftX                // 32 px — a 1x1 diamond's full width

describe('footprintDiamond', () => {
  it('is exact for 1x1 on a 64x64 cell', () => {
    expect(footprintDiamond({ w: 1, h: 1 }, { w: 64, h: 64 }))
      .toEqual({ nearVertexY: 63, centerX: 32, leftX: 16, rightX: 48 })
  })
  it('is exact for 2x2 on a 128x128 cell', () => {
    expect(footprintDiamond({ w: 2, h: 2 }, { w: 128, h: 128 }))
      .toEqual({ nearVertexY: 127, centerX: 64, leftX: 32, rightX: 96 })
  })
  it('honours an explicit feet line when the cell declares one', () => {
    expect(footprintDiamond(FP, CELL).nearVertexY).toBe(56)
  })

  it('turns with the footprint: a transpose is a DIFFERENT diamond, not the same one', () => {
    const cell = { w: 192, h: 192 }
    const sw = footprintDiamond({ w: 4, h: 2 }, cell)
    const se = footprintDiamond({ w: 2, h: 4 }, cell)
    expect([sw.leftX, sw.rightX]).toEqual([32, 128])
    expect([se.leftX, se.rightX]).toEqual([64, 160])
    expect(sw).not.toEqual(se)
    // A square footprint is its own transpose, and must not move.
    expect(footprintDiamond({ w: 2, h: 2 }, cell)).toEqual(footprintDiamond({ w: 2, h: 2 }, cell))
    const sq = footprintDiamond({ w: 3, h: 3 }, cell)
    expect(sq.centerX - sq.leftX).toBe(sq.rightX - sq.centerX)
  })

  // Each of the three is a function of `w + h`, so a transpose gives it the identical number.
  it('names the size-only measures that a transpose slips straight past', () => {
    const a = { w: 4, h: 2 }, b = { w: 2, h: 4 }
    const tile = { w: 32, h: 16 }
    expect(spriteDensity({ canvas: { w: 192, h: 192 }, footprint: a, tile }))
      .toBe(spriteDensity({ canvas: { w: 192, h: 192 }, footprint: b, tile }))
    expect(nativeDensityGate({ name: 'x', canvas: { w: 192, h: 192 }, footprint: a, tile }).failures)
      .toEqual(nativeDensityGate({ name: 'x', canvas: { w: 192, h: 192 }, footprint: b, tile }).failures)
    expect(targetSize('building', a)).toEqual(targetSize('building', b))
    // The width of the diamond really is symmetric; where its near vertex sits is not.
    const cell = { w: 192, h: 192 }
    const sw = footprintDiamond(a, cell), se = footprintDiamond(b, cell)
    expect(sw.rightX - sw.leftX).toBe(se.rightX - se.leftX)
    expect(sw.leftX).not.toBe(se.leftX)
  })
})

describe('validateBuildingAlignment', () => {
  it('GOOD: a base sitting exactly on the diamond passes', () => {
    const r = validateBuildingAlignment(block(D.nearVertexY, EXACT), FP, CFG, CELL)
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.measured).toEqual({ bottomY: 56, baseLeft: 16, baseRight: 47 })
  })

  it('FLOATING: a base 6px above the feet line fails and reports the delta', () => {
    const r = validateBuildingAlignment(block(D.nearVertexY - 6, EXACT), FP, CFG, CELL)
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toMatch(/feet line/)
    expect(r.failures.join(' ')).toContain('6')
    expect(r.measured.bottomY).toBe(50)
  })

  it('SUNKEN: pixels below the near vertex fail and are counted', () => {
    const r = validateBuildingAlignment(block(D.nearVertexY + 4, EXACT), FP, CFG, CELL)
    expect(r.ok).toBe(false)
    const msg = r.failures.join(' ')
    expect(msg).toMatch(/feet line|below/)
    expect(msg).toContain(`${4 * EXACT}`)        // 4 rows x 32 px below the line
  })

  it('OVERHANGING: a base 12px wider each side fails base-fit but passes the feet line', () => {
    const r = validateBuildingAlignment(block(D.nearVertexY, EXACT + 24), FP, CFG, CELL)
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toMatch(/base fit/)
    expect(r.failures.join(' ')).not.toMatch(/feet line/)
  })

  it('BOUNDARY: exactly the tolerance passes, one more pixel fails', () => {
    expect(validateBuildingAlignment(block(D.nearVertexY - CFG.feetTolerancePx, EXACT), FP, CFG, CELL).ok).toBe(true)
    expect(validateBuildingAlignment(block(D.nearVertexY - CFG.feetTolerancePx - 1, EXACT), FP, CFG, CELL).ok).toBe(false)
  })

  it('BOUNDARY: base fit allows a quarter tile of slop and no more', () => {
    const tol = CFG.baseFitToleranceQuarterTiles * 32 / 4      // 8 px
    expect(validateBuildingAlignment(block(D.nearVertexY, EXACT + 2 * tol), FP, CFG, CELL).ok).toBe(true)
    expect(validateBuildingAlignment(block(D.nearVertexY, EXACT + 2 * tol + 2), FP, CFG, CELL).ok).toBe(false)
  })

  it('an all-transparent image fails cleanly instead of throwing', () => {
    const empty: RawImage = { width: CELL.w, height: CELL.h, data: new Uint8ClampedArray(CELL.w * CELL.h * 4) }
    let r!: ReturnType<typeof validateBuildingAlignment>
    expect(() => { r = validateBuildingAlignment(empty, FP, CFG, CELL) }).not.toThrow()
    expect(r.ok).toBe(false)
    expect(r.failures).toContain('no opaque pixels')
  })

  it('AlignmentConfig is the forge config slice, not a re-declared shape', () => {
    const cfg: AlignmentConfig = DEFAULT_FORGE_CONFIG.alignment
    expect(cfg).toEqual({ feetTolerancePx: 2, baseFitToleranceQuarterTiles: 1 })
  })
})

describe('testGridRender (the picture the seat judge is shown)', () => {
  const sprite = block(63, EXACT)                      // 64x64, base on the cell's own feet line
  const px = (img: RawImage, x: number, y: number) => {
    const i = (y * img.width + x) * 4
    return `#${[0, 1, 2].map(k => img.data[i + k]!.toString(16).padStart(2, '0').toUpperCase()).join('')}`
  }

  it('adds a 32px margin on every side and is deterministic', () => {
    const a = testGridRender(sprite, FP)
    expect(GRID_MARGIN).toBe(32)
    expect(a.width).toBe(sprite.width + 2 * GRID_MARGIN)
    expect(a.height).toBe(sprite.height + 2 * GRID_MARGIN)
    expect(Array.from(a.data)).toEqual(Array.from(testGridRender(sprite, FP).data))
  })

  it('strokes the footprint diamond at its four vertices', () => {
    // an empty sprite, so nothing occludes the stroke — a seated building covers its own near vertex
    const bare: RawImage = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
    const out = testGridRender(bare, FP)
    const d = footprintDiamond(FP, { w: bare.width, h: bare.height })
    const halfH = (FP.w + FP.h) * 16 / 4
    const verts: [number, number][] = [
      [d.centerX, d.nearVertexY],                       // near / south
      [d.leftX, d.nearVertexY - halfH],                 // west
      [d.rightX, d.nearVertexY - halfH],                // east
      [d.centerX, d.nearVertexY - 2 * halfH],           // far / north
    ]
    for (const [x, y] of verts)
      expect(px(out, x + GRID_MARGIN, y + GRID_MARGIN), `vertex ${x},${y}`).toBe(DIAMOND_STROKE)
    expect(DIAMOND_STROKE).toBe('#E8785A')
  })

  it('preserves every opaque sprite pixel exactly', () => {
    const out = testGridRender(sprite, FP)
    for (let y = 0; y < sprite.height; y++)
      for (let x = 0; x < sprite.width; x++) {
        if (sprite.data[(y * sprite.width + x) * 4 + 3] === 0) continue
        expect(px(out, x + GRID_MARGIN, y + GRID_MARGIN), `sprite ${x},${y}`).toBe(px(sprite, x, y))
      }
  })
})

describe('toTargetCell', () => {
  // A native v4 cell: 800x800, the figure filling it, feet at the bottom-centre.
  const native: RawImage = { width: 800, height: 800, data: new Uint8ClampedArray(800 * 800 * 4) }
  for (let y = 100; y < 780; y++)
    for (let x = 200; x < 600; x++) {
      const i = (y * 800 + x) * 4
      native.data[i] = 200; native.data[i + 1] = 150; native.data[i + 2] = 100; native.data[i + 3] = 255
    }
  const man = { footprint: { w: 1, h: 1 }, cell: { w: 800, h: 800, feetX: 400, feetY: 779 } }

  it('rebuilds the 64px target cell a 1x1 building renders into', () => {
    const { img, cell } = toTargetCell(native, man)
    expect(img.width).toBe(64)
    expect(img.height).toBe(64)
    expect(cell).toEqual({ w: 64, h: 64, feetY: 62 })
  })

  it('centres the feet on the cell so the alignment law can be applied', () => {
    const { img, cell } = toTargetCell(native, man)
    const r = validateBuildingAlignment(img, man.footprint, CFG, cell)
    expect(r.ok, r.failures.join('; ')).toBe(true)
    expect(Math.abs((r.measured.baseLeft + r.measured.baseRight) / 2 - 32)).toBeLessThanOrEqual(1)
  })

  it('scales the target cell with the footprint — a 2x2 renders into 128px', () => {
    const { img, cell } = toTargetCell(native, { ...man, footprint: { w: 2, h: 2 } })
    expect(img.width).toBe(128)
    expect(cell.h).toBe(128)
  })
})

describe('SEAT_CRITERION_PROMPT', () => {
  it('names floating, sunken and skew', () => {
    const p = SEAT_CRITERION_PROMPT.toLowerCase()
    for (const w of ['floating', 'sunken', 'skew']) expect(p).toContain(w)
    expect(p).toContain('diamond')
  })
})
