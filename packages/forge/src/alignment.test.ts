import { describe, it, expect } from 'vitest'
import { DEFAULT_FORGE_CONFIG } from './forgeConfig.js'
import type { RawImage } from './post/raw.js'
import { footprintDiamond, validateBuildingAlignment, type AlignmentConfig } from './alignment.js'

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
