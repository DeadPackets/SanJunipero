import { describe, expect, it } from 'vitest'
import { ROAD_AUTOTILE_KEYS, SEASONS, TERRAIN_TILE_KINDS } from '@sj/shared'
import { MASTER_PALETTE } from './palette.js'
import type { RawImage } from './post/raw.js'
import { TERRAIN_TILE_H, TERRAIN_TILE_W, inTileDiamond } from './terrainTiles.js'
import {
  MATERIAL_PX, ROAD_MATERIAL_ID, SEAM_TOLERANCE, TERRAIN_COMMISSIONS, TILING_CRITERION_PROMPT,
  diamondFromMaterial, generationItems, materialFromCandidate, planTerrainProgram, seamReport,
  seasonTintFrom, selfTile3x3, stencilRoadTile, terrainAssetId, terrainBoilerplate,
} from './terrainGen.js'
import { paintRoadAutotile } from './roadTiles.js'

const PALETTE_HEXES = new Set(MASTER_PALETTE.map((h) => parseInt(h.slice(1), 16)))

// a square whose opposing edges match exactly — the ideal a generated material is judged against
function seamlessSquare(px = MATERIAL_PX): RawImage {
  const img: RawImage = { width: px, height: px, data: new Uint8ClampedArray(px * px * 4) }
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      // a torus function: f(0) === f(px) in both axes, so left==right and top==bottom
      const v = 128 + 60 * Math.sin((2 * Math.PI * x) / px) * Math.cos((2 * Math.PI * y) / px)
      img.data.set([v, v, v, 255], (y * px + x) * 4)
    }
  }
  return img
}

// a square with a hard vertical discontinuity — the failure a seam check must catch
function seamedSquare(px = MATERIAL_PX): RawImage {
  const img = seamlessSquare(px)
  for (let y = 0; y < px; y++) {
    for (let x = px - 3; x < px; x++) img.data.set([0, 0, 0, 255], (y * px + x) * 4)
  }
  return img
}

const bigCandidate = (make: (px: number) => RawImage, px = 512): RawImage => make(px)

describe('planTerrainProgram', () => {
  const plan = planTerrainProgram()

  it('covers every TileId the engine can emit', () => {
    const kinds = new Set(plan.filter((p) => p.sort === 'ground').map((p) => p.kind))
    for (const k of TERRAIN_TILE_KINDS) expect(kinds, k).toContain(k)
  })

  it('gives grass real variety and every other ground at least one tile', () => {
    const variantsOf = (kind: string): number =>
      plan.filter((p) => p.sort === 'ground' && p.kind === kind).length
    expect(variantsOf('grass')).toBeGreaterThanOrEqual(2)
    expect(variantsOf('grass')).toBeLessThanOrEqual(4)
    for (const k of TERRAIN_TILE_KINDS) expect(variantsOf(k), k).toBeGreaterThanOrEqual(1)
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
    expect(planTerrainProgram().map((p) => p.assetId)).toEqual(ids)   // pure
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
    for (let i = 0; i < m.data.length; i += 4) {
      expect(m.data[i + 3]).toBe(255)          // ground is never see-through
      expect(PALETTE_HEXES).toContain((m.data[i]! << 16) | (m.data[i + 1]! << 8) | m.data[i + 2]!)
    }
  })

  it('is deterministic — the same candidate twice is byte-identical', () => {
    const a = materialFromCandidate(bigCandidate(seamlessSquare))
    const b = materialFromCandidate(bigCandidate(seamlessSquare))
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data))
  })
})

describe('seamReport', () => {
  it('passes a material whose opposing edges meet', () => {
    const r = seamReport(materialFromCandidate(bigCandidate(seamlessSquare)))
    expect(r.horizontalDelta).toBeLessThanOrEqual(SEAM_TOLERANCE)
    expect(r.verticalDelta).toBeLessThanOrEqual(SEAM_TOLERANCE)
    expect(r.pass).toBe(true)
  })

  it('catches a hard edge discontinuity', () => {
    const r = seamReport(materialFromCandidate(bigCandidate(seamedSquare)))
    expect(r.pass).toBe(false)
    expect(r.horizontalDelta).toBeGreaterThan(SEAM_TOLERANCE)
  })

  it('reports which axis broke, so the retry feedback can say so', () => {
    const r = seamReport(materialFromCandidate(bigCandidate(seamedSquare)))
    expect(r.worstAxis).toBe('horizontal')
    expect(r.note).toMatch(/left|right|horizontal/i)
  })

  it('is deterministic', () => {
    const m = materialFromCandidate(bigCandidate(seamlessSquare))
    expect(seamReport(m)).toEqual(seamReport(m))
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
    for (const [x, y] of [[16, 0], [16, 15], [0, 7], [31, 7]] as const) expect(at(x, y)).toBe(255)
    for (const [x, y] of [[0, 0], [31, 0], [0, 15], [31, 15]] as const) expect(at(x, y)).toBe(0)
  })

  it('stays palette-true through the cut', () => {
    for (let i = 0; i < tile.data.length; i += 4) {
      if (tile.data[i + 3] === 0) continue
      expect(PALETTE_HEXES).toContain((tile.data[i]! << 16) | (tile.data[i + 1]! << 8) | tile.data[i + 2]!)
    }
  })

  it('is deterministic', () => {
    const m = materialFromCandidate(bigCandidate(seamlessSquare))
    expect(Buffer.from(diamondFromMaterial(m).data)).toEqual(Buffer.from(diamondFromMaterial(m).data))
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
    expect(plan.filter((p) => p.sort === 'road').every((p) => p.generateFrom === ROAD_MATERIAL_ID)).toBe(true)
  })

  it('is every ground variant plus every season, and nothing else', () => {
    expect(gen).toHaveLength(11 + 4)
    expect(new Set(gen.map((p) => p.sort))).toEqual(new Set(['ground', 'season']))
  })

  it('names a material that the program actually generates for every derived piece', () => {
    const generated = new Set(gen.map((p) => p.assetId))
    for (const p of plan) {
      if (p.generateFrom === undefined) continue
      expect(generated, `${p.assetId} is cut from a material nobody generates`).toContain(p.generateFrom)
    }
  })
})

describe('stencilRoadTile', () => {
  const material = materialFromCandidate(bigCandidate(seamlessSquare))

  it('keeps C13\'s road geometry exactly, pixel for pixel', () => {
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
    let compared = 0
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i + 3] === 0 || b.data[i + 3] === 0) continue
      expect(a.data[i], `px ${i}`).toBe(b.data[i])
      expect(a.data[i + 1]).toBe(b.data[i + 1])
      expect(a.data[i + 2]).toBe(b.data[i + 2])
      compared++
    }
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
    const dark: RawImage = { width: summer.width, height: summer.height, data: new Uint8ClampedArray(summer.data) }
    for (let i = 0; i < dark.data.length; i += 4) {
      dark.data[i] = 0; dark.data[i + 1] = 0; dark.data[i + 2] = 0
    }
    const t = seasonTintFrom(dark, summer)
    expect(t.r).toBeGreaterThanOrEqual(0.6)     // clamped, never a black sheet
    expect(t.r).toBeLessThan(1)
  })
})
