import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS } from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import { paletteDistance } from './pixelGates.js'
import { decodePng, type RawImage } from './post/raw.js'
import { TERRAIN_TILE_H, TERRAIN_TILE_W, inTileDiamond } from './terrainTiles.js'
import {
  BORDER_TOLERANCE,
  CALM_ROAD_ID,
  CANDIDATE_MARGIN,
  MATERIAL_PX,
  ROAD_MATERIAL_ID,
  SEAM_TOLERANCE,
  DEFRAME_MAX_PASSES,
  TERRAIN_COMMISSIONS,
  TILING_CRITERION_PROMPT,
  borderReport,
  cropMargin,
  deframe,
  toMaterialGrid,
  materialVeto,
  seamlessMaterial,
  diamondFromMaterial,
  generationItems,
  materialFromCandidate,
  planTerrainProgram,
  seamReport,
  seasonTintFrom,
  selfTile3x3,
  stencilRoadTile,
  terrainAssetId,
  terrainBoilerplate,
} from './terrainGen.js'
import { paintRoadAutotile } from './roadTiles.js'

const PALETTE_HEXES = new Set(MASTER_PALETTE.map((h) => parseInt(h.slice(1), 16)))

// one assertion per image, not per pixel: names the first five offending offsets
function offenders(img: RawImage, opaque: boolean): string[] {
  const bad: string[] = []
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!
    if (opaque && a !== 255) bad.push(`alpha@${i}`)
    if (
      a !== 0 &&
      !PALETTE_HEXES.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)
    )
      bad.push(`hex@${i}`)
  }
  return bad.slice(0, 5)
}

// A HOMOGENEOUS stochastic material — what an image model actually returns. A synthetic torus
// (f(0) === f(px)) would also pass, but it cannot survive the margin crop real output requires.
function seamlessSquare(px = MATERIAL_PX): RawImage {
  const img: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  // two real MASTER_PALETTE greens, so quantizing is a no-op and the measurement is not
  // reading palette-snap noise: one base tone with an even sparse speckle of the other
  const base = [0x93, 0xb5, 0x73],
    speck = [0x6f, 0x94, 0x55]
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const h = (Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1)) >>> 0
      img.data.set([...(h % 8 === 0 ? speck : base), 255], (y * px + x) * 4)
    }
  }
  return img
}

// a square with a hard vertical discontinuity — the failure a seam check must catch
function seamedSquare(px = MATERIAL_PX): RawImage {
  const img = seamlessSquare(px)
  const band = Math.max(4, Math.round(px * 0.12))
  for (let y = 0; y < px; y++) {
    for (let x = px - band; x < px; x++) img.data.set([0, 0, 0, 255], (y * px + x) * 4)
  }
  return img
}

const bigCandidate = (make: (px: number) => RawImage, px = 512): RawImage => make(px)
// seamReport and borderReport are functions of a MATERIAL, so they are tested on one
// directly — the margin crop belongs to materialFromCandidate and is tested there
const asMaterial = (img: RawImage): RawImage => toMaterialGrid(img)

describe('planTerrainProgram', () => {
  const plan = planTerrainProgram()

  it('covers every TileId the engine can emit', () => {
    const kinds = new Set(plan.filter((p) => p.sort === 'ground').map((p) => p.kind))
    for (const k of TERRAIN_TILE_KINDS) expect(kinds, k).toContain(k)
  })

  it('is ONE material per ground — TERRAIN V2 has no per-tile variants to fill', () => {
    const variantsOf = (kind: string): number =>
      plan.filter((p) => p.sort === 'ground' && p.kind === kind).length
    for (const k of TERRAIN_TILE_KINDS) expect(variantsOf(k), k).toBe(1)
  })

  it('re-skins all fifteen road autotile keys', () => {
    const keys = plan.filter((p) => p.sort === 'road').map((p) => p.roadKey)
    expect(new Set(keys).size).toBe(ROAD_AUTOTILE_KEYS.length)
    for (const k of ROAD_AUTOTILE_KEYS) expect(keys).toContain(k)
  })

  it('replaces the D-3 placeholder seasonal sheets, one generated sheet per season', () => {
    const seasons = plan.filter((p) => p.sort === 'season').map((p) => p.season)
    expect([...seasons].sort()).toEqual([...SEASONS].sort())
  })

  it('names the shore treatment explicitly — the bank is where water meets ground', () => {
    const shore = plan.filter((p) => p.sort === 'ground' && /bank|shore/i.test(p.commission))
    expect(shore.length).toBeGreaterThan(0)
    const kinds = shore.flatMap((p) => (p.sort === 'ground' ? [p.kind] : []))
    expect(kinds.some((k) => k === 'sand' || k === 'earth')).toBe(true)
  })

  it('gives every item a unique, stable, ledger-safe asset id', () => {
    const ids = plan.map((p) => p.assetId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^terrain:[a-z0-9:\-]+$/)
    expect(planTerrainProgram().map((p) => p.assetId)).toEqual(ids) // pure
  })

  it('asks every commission through the same style boilerplate', () => {
    expect(terrainBoilerplate()).toMatch(/seamless/i)
    expect(terrainBoilerplate()).toMatch(/tile/i)
    for (const p of plan) expect(p.commission.length).toBeGreaterThan(20)
  })
})

describe('terrainAssetId', () => {
  it('is the codex kind for ground and the prefixed key for a road cell', () => {
    expect(terrainAssetId({ sort: 'ground', kind: 'grass', variant: 2 })).toBe('terrain:grass:2')
    expect(terrainAssetId({ sort: 'road', roadKey: 'cross' })).toBe('terrain:road:cross')
    expect(terrainAssetId({ sort: 'season', season: 'winter' })).toBe('terrain:season:winter')
  })
})

describe('materialFromCandidate', () => {
  it('lands a 512 generation on the material grid, palette-true and fully opaque', () => {
    const m = materialFromCandidate(bigCandidate(seamlessSquare))
    expect([m.width, m.height]).toEqual([MATERIAL_PX, MATERIAL_PX])
    expect(offenders(m, true)).toEqual([]) // ground is never see-through
  })

  it('is deterministic — the same candidate twice is byte-identical', () => {
    const a = materialFromCandidate(bigCandidate(seamlessSquare))
    const b = materialFromCandidate(bigCandidate(seamlessSquare))
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data))
  })
})

describe('seamReport', () => {
  it('passes a material whose opposing edges meet', () => {
    const r = seamReport(asMaterial(seamlessSquare(MATERIAL_PX)))
    expect(r.horizontalDelta).toBeLessThanOrEqual(SEAM_TOLERANCE)
    expect(r.verticalDelta).toBeLessThanOrEqual(SEAM_TOLERANCE)
    expect(r.pass).toBe(true)
  })

  it('catches a hard edge discontinuity', () => {
    const r = seamReport(asMaterial(seamedSquare(MATERIAL_PX)))
    expect(r.pass).toBe(false)
    expect(r.horizontalDelta).toBeGreaterThan(SEAM_TOLERANCE)
  })

  it('reports which axis broke, so the retry feedback can say so', () => {
    const r = seamReport(asMaterial(seamedSquare(MATERIAL_PX)))
    expect(r.worstAxis).toBe('horizontal')
    expect(r.note).toMatch(/left|right|horizontal/i)
  })

  it('is deterministic', () => {
    const m = asMaterial(seamlessSquare(MATERIAL_PX))
    expect(seamReport(m)).toEqual(seamReport(m))
  })
})

describe('materialVeto', () => {
  it('passes a material whose opposing edges meet', () => {
    expect(materialVeto(asMaterial(seamlessSquare(MATERIAL_PX)))).toBeNull()
  })

  it('speaks the seam note when the absolute wrap breaks', () => {
    expect(materialVeto(asMaterial(seamedSquare(MATERIAL_PX)))).toMatch(/left|right|horizontal/i)
  })

  // The one the absolute check cannot see: earth's wrap delta is 2.9 against a tolerance of 14,
  // and still 5x its own interior noise — a visible line on smooth ground.
  it('vetoes a wrap that is quiet in absolute terms and loud against its own grain', async () => {
    const earth = await decodePng(
      readFileSync(new URL('./fixtures/pixel-gates/terrain-earth-seamed.png', import.meta.url)),
    )
    expect(seamReport(earth).pass).toBe(true)
    expect(borderReport(earth).framed).toBe(false)
    expect(materialVeto(earth)).toMatch(/interior noise/)
  })
})

// An image model does not return a torus, so the wrap is made true by CONSTRUCTION instead.
describe('seamlessMaterial', () => {
  // The four offenders as they shipped BEFORE the construction landed, frozen: a gate proven
  // against the live content directory stops being proven the moment the content is fixed.
  const offender = async (name: string): Promise<RawImage> =>
    decodePng(
      readFileSync(new URL(`./fixtures/pixel-gates/terrain-${name}-seamed.png`, import.meta.url)),
    )

  it('closes the wrap on the material with the loudest seam of the thirteen', async () => {
    const rock = await offender('rock')
    expect(materialVeto(rock)).toMatch(/interior noise/)
    expect(materialVeto(seamlessMaterial(rock))).toBeNull()
  })

  // road is cobbles, not grain: rolling by exactly half lands its border mid-course and the
  // wrap stays broken at 16 and 26. The offset has to be chosen, not assumed.
  it('closes a structured material too, where a half roll does not', async () => {
    const road = await offender('road')
    expect(materialVeto(road)).not.toBeNull()
    expect(materialVeto(seamlessMaterial(road))).toBeNull()
  })

  // Palette-TRUE was the quantize's signature. The wrap blends two rolled copies, so the material
  // keeps the model's own colours and is only measured for its DISTANCE to the palette.
  it('keeps the material opaque, near the palette and the same size', async () => {
    const m = seamlessMaterial(await offender('farmland'))
    expect([m.width, m.height]).toEqual([MATERIAL_PX, MATERIAL_PX])
    expect(offenders(m, true).filter((o) => o.startsWith('alpha'))).toEqual([])
    expect(paletteDistance(m)).toBeLessThan(20)
  })

  it('is deterministic', async () => {
    const m = await offender('sand')
    expect(Buffer.from(seamlessMaterial(m).data)).toEqual(Buffer.from(seamlessMaterial(m).data))
  })
})

describe('selfTile3x3', () => {
  it('builds the composite the vision judge scores tiling on', () => {
    const m = materialFromCandidate(bigCandidate(seamlessSquare))
    const grid = selfTile3x3(m)
    expect([grid.width, grid.height]).toEqual([MATERIAL_PX * 3, MATERIAL_PX * 3])
    // the centre cell is the material verbatim — a judge sees the real pixels, not a resample
    for (let y = 0; y < MATERIAL_PX; y++) {
      for (let x = 0; x < MATERIAL_PX; x++) {
        const s = (y * MATERIAL_PX + x) * 4
        const d = ((y + MATERIAL_PX) * grid.width + x + MATERIAL_PX) * 4
        expect(grid.data[d]).toBe(m.data[s])
      }
    }
  })

  it('is what the tiling criterion prompt tells the judge it is looking at', () => {
    expect(TILING_CRITERION_PROMPT).toMatch(/3\s*[x×]\s*3/i)
    expect(TILING_CRITERION_PROMPT).toMatch(/seam|repeat|grid/i)
  })
})

describe('diamondFromMaterial', () => {
  const tile = diamondFromMaterial(materialFromCandidate(bigCandidate(seamlessSquare)))

  it('is one 32x16 dimetric diamond at the manifest tile size', () => {
    expect([tile.width, tile.height]).toEqual([TERRAIN_TILE_W, TERRAIN_TILE_H])
  })

  it('is opaque exactly inside the diamond and clear exactly outside it', () => {
    for (let y = 0; y < TERRAIN_TILE_H; y++) {
      for (let x = 0; x < TERRAIN_TILE_W; x++) {
        const a = tile.data[(y * TERRAIN_TILE_W + x) * 4 + 3]
        expect(a, `${x},${y}`).toBe(inTileDiamond(x, y) ? 255 : 0)
      }
    }
  })

  it('fills the four edge midpoints and clears the four square corners (alignment law)', () => {
    const at = (x: number, y: number): number => tile.data[(y * TERRAIN_TILE_W + x) * 4 + 3]!
    for (const [x, y] of [
      [16, 0],
      [16, 15],
      [0, 7],
      [31, 7],
    ] as const)
      expect(at(x, y)).toBe(255)
    for (const [x, y] of [
      [0, 0],
      [31, 0],
      [0, 15],
      [31, 15],
    ] as const)
      expect(at(x, y)).toBe(0)
  })

  it('stays palette-true through the cut', () => {
    expect(offenders(tile, false)).toEqual([])
  })

  it('is deterministic', () => {
    const m = materialFromCandidate(bigCandidate(seamlessSquare))
    expect(Buffer.from(diamondFromMaterial(m).data)).toEqual(
      Buffer.from(diamondFromMaterial(m).data),
    )
  })
})

describe('TERRAIN_COMMISSIONS', () => {
  it('speaks about ground, never about the machine that draws it', () => {
    for (const text of Object.values(TERRAIN_COMMISSIONS)) {
      expect(text).not.toMatch(/\b(ai|model|prompt|render|png|pixel art generator)\b/i)
    }
  })
})

describe('generationItems', () => {
  const plan = planTerrainProgram()
  const gen = generationItems(plan)

  it('pays for one road surface, not fifteen — a lattice must be ONE road', () => {
    expect(gen.filter((p) => p.sort === 'road')).toHaveLength(0)
    expect(gen.some((p) => p.assetId === ROAD_MATERIAL_ID)).toBe(true)
    expect(
      plan.filter((p) => p.sort === 'road').every((p) => p.generateFrom === ROAD_MATERIAL_ID),
    ).toBe(true)
  })

  it('is every ground, the calm ribbon material, and every season', () => {
    // +1 for road-calm: TERRAIN V2.1 gives thin runs their own quieter surface
    expect(gen).toHaveLength(TERRAIN_TILE_KINDS.length + 1 + 4)
    expect(new Set(gen.map((p) => p.sort))).toEqual(new Set(['ground', 'material', 'season']))
    expect(gen.filter((p) => p.sort === 'material').map((p) => p.assetId)).toEqual([CALM_ROAD_ID])
  })

  it('names a material that the program actually generates for every derived piece', () => {
    const generated = new Set(gen.map((p) => p.assetId))
    for (const p of plan) {
      if (p.generateFrom === undefined) continue
      expect(generated, `${p.assetId} is cut from a material nobody generates`).toContain(
        p.generateFrom,
      )
    }
  })
})

describe('stencilRoadTile', () => {
  const material = materialFromCandidate(bigCandidate(seamlessSquare))

  it("keeps C13's road geometry exactly, pixel for pixel", () => {
    for (const key of ['cross', 'straight-ns', 'cap-w', 't-no-e'] as const) {
      const stencil = paintRoadAutotile(key)
      const out = stencilRoadTile(material, key)
      for (let i = 3; i < out.data.length; i += 4) {
        expect(out.data[i], `${key} @${i}`).toBe(stencil.data[i] === 0 ? 0 : 255)
      }
    }
  })

  it('fills every shape from the SAME surface, so the lattice is one road', () => {
    const a = stencilRoadTile(material, 'cross')
    const b = stencilRoadTile(material, 'straight-ns')
    const bad: string[] = []
    let compared = 0
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i + 3] === 0 || b.data[i + 3] === 0) continue
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2]
      )
        bad.push(`px ${i}`)
      compared++
    }
    expect(bad.slice(0, 5)).toEqual([])
    expect(compared).toBeGreaterThan(50)
  })

  it('is palette-true and deterministic', () => {
    const t = stencilRoadTile(material, 'cross')
    for (let i = 0; i < t.data.length; i += 4) {
      if (t.data[i + 3] === 0) continue
      expect(PALETTE_HEXES).toContain((t.data[i]! << 16) | (t.data[i + 1]! << 8) | t.data[i + 2]!)
    }
    expect(Buffer.from(t.data)).toEqual(Buffer.from(stencilRoadTile(material, 'cross').data))
  })
})

describe('seasonTintFrom', () => {
  const summer = materialFromCandidate(bigCandidate(seamlessSquare))

  it('is a no-op against itself — summer grades to summer', () => {
    const t = seasonTintFrom(summer, summer)
    expect(t.r).toBeCloseTo(1, 5)
    expect(t.g).toBeCloseTo(1, 5)
    expect(t.b).toBeCloseTo(1, 5)
  })

  it('reads the grade off the generated art, and never runs away', () => {
    const dark: RawImage = {
      width: summer.width,
      height: summer.height,
      data: new Uint8ClampedArray(summer.data),
    }
    for (let i = 0; i < dark.data.length; i += 4) {
      dark.data[i] = 0
      dark.data[i + 1] = 0
      dark.data[i + 2] = 0
    }
    const t = seasonTintFrom(dark, summer)
    expect(t.r).toBeGreaterThanOrEqual(0.6) // clamped, never a black sheet
    expect(t.r).toBeLessThan(1)
  })
})

// A tile can wrap PERFECTLY and still be useless: a drawn frame matches itself across the wrap, so
// `seamReport` reads 0.0 while the material renders as a grid of framed cards.
describe('borderReport', () => {
  const framed = (px = MATERIAL_PX, ring = 2): RawImage => {
    const img = seamlessSquare(px)
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        if (x >= ring && y >= ring && x < px - ring && y < px - ring) continue
        img.data.set([120, 40, 160, 255], (y * px + x) * 4) // a violet rim
      }
    }
    return img
  }

  it('passes a material whose edge looks like its middle', () => {
    const r = borderReport(asMaterial(seamlessSquare(MATERIAL_PX)))
    expect(r.framed).toBe(false)
    expect(r.ringDelta).toBeLessThanOrEqual(BORDER_TOLERANCE)
  })

  it('catches a drawn frame that the SEAM check cannot see', () => {
    const m = asMaterial(framed())
    // the frame wraps perfectly — left edge equals right edge — so the seam check is happy
    expect(seamReport(m).pass).toBe(true)
    // and the border check is not
    expect(borderReport(m).framed).toBe(true)
    expect(borderReport(m).ringDelta).toBeGreaterThan(BORDER_TOLERANCE)
  })

  it('tells the model exactly what to remove', () => {
    const note = borderReport(asMaterial(framed())).note
    expect(note).toMatch(/border|frame|rim|outline/i)
    expect(note).toMatch(/run right off all four sides/i)
  })

  it('is deterministic', () => {
    const m = asMaterial(seamlessSquare(MATERIAL_PX))
    expect(borderReport(m)).toEqual(borderReport(m))
  })
})

describe('cropMargin', () => {
  // the rim a model actually drew: ~4% of a 512 square, which is 20px
  const framedBig = (px = 512, rim = 20): RawImage => {
    const img = seamlessSquare(px)
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        if (x >= rim && y >= rim && x < px - rim && y < px - rim) continue
        img.data.set([120, 40, 160, 255], (y * px + x) * 4)
      }
    }
    return img
  }

  it('cuts the outer margin off both axes', () => {
    const c = cropMargin(seamlessSquare(512))
    const cut = Math.round(512 * CANDIDATE_MARGIN)
    expect([c.width, c.height]).toEqual([512 - 2 * cut, 512 - 2 * cut])
  })

  it('removes a drawn rim the prompt could not talk the model out of', () => {
    // straight through, the rim survives into the material and the frame check catches it
    const uncropped = asMaterial(framedBig())
    expect(borderReport(uncropped).framed).toBe(true)
    // through the real path, the rim is gone before anything measures it
    expect(borderReport(materialFromCandidate(framedBig())).framed).toBe(false)
  })

  it('leaves an unframed candidate alone enough to still wrap', () => {
    expect(seamReport(materialFromCandidate(bigCandidate(seamlessSquare))).pass).toBe(true)
  })

  it('never crops a small image out of existence', () => {
    const tiny: RawImage = { width: 4, height: 4, data: new Uint8ClampedArray(64) }
    expect(cropMargin(tiny).width).toBeGreaterThan(0)
  })

  it('fills every cell even when the crop leaves less than the material grid', () => {
    // an integer step silently left the right and bottom edges BLACK here
    const small = materialFromCandidate(seamlessSquare(40))
    for (let i = 0; i < small.data.length; i += 4) {
      const black = small.data[i] === 0 && small.data[i + 1] === 0 && small.data[i + 2] === 0
      expect(black, `black cell at ${i / 4}`).toBe(false)
    }
  })
})

describe('deframe', () => {
  const framedMaterial = (rim: number): RawImage => {
    const px = MATERIAL_PX
    const img = seamlessSquare(px)
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        if (x >= rim && y >= rim && x < px - rim && y < px - rim) continue
        img.data.set([0x43, 0x39, 0x4a, 255], (y * px + x) * 4) // an ink rim
      }
    }
    return toMaterialGrid(img)
  }

  it('leaves a clean material completely alone, at zero passes', () => {
    const clean = toMaterialGrid(seamlessSquare(MATERIAL_PX))
    const r = deframe(clean)
    expect(r.passes).toBe(0)
    expect(Buffer.from(r.material.data)).toEqual(Buffer.from(clean.data))
  })

  it('cuts a rim the 8% crop could not reach', () => {
    const framed = framedMaterial(5)
    expect(borderReport(framed).framed).toBe(true)
    const r = deframe(framed)
    expect(borderReport(r.material).framed).toBe(false)
    expect(r.passes).toBeGreaterThan(0)
    expect(r.material.width).toBe(MATERIAL_PX) // still on the material grid
  })

  it('gives up rather than looping, and says how hard it tried', () => {
    const allRim: RawImage = {
      width: MATERIAL_PX,
      height: MATERIAL_PX,
      data: new Uint8ClampedArray(MATERIAL_PX * MATERIAL_PX * 4),
    }
    for (let i = 0; i < allRim.data.length; i += 4) allRim.data.set([0x43, 0x39, 0x4a, 255], i)
    expect(deframe(allRim).passes).toBeLessThanOrEqual(DEFRAME_MAX_PASSES)
  })

  it('is deterministic', () => {
    const f = framedMaterial(5)
    expect(Buffer.from(deframe(f).material.data)).toEqual(Buffer.from(deframe(f).material.data))
  })
})
