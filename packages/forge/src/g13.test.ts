// GATE G13a — the automated half, in the addendum's own order. Forge may import shared, so
// this is where the template <-> library assertions live. Keyless, offline, zero spend.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROAD_AUTOTILE_KEYS, roadAutotile, resolveFurnishingKind,
  makeCityTemplate, growthPlots, structureTiles, doorTile, doorFrontTile, isRoadTile, key,
  PLAZA_CENTRE,
  CITY_FURNISHING_KINDS, CITY_BED_KIND, CITY_HEARTH_KIND, CITY_INTERIOR_SLOTS,
  WORLD_SIZE_GENESIS, T_WATER, parseLibraryItemManifest,
  type RoadAutotileKey,
} from '@sj/shared'
import { DEFAULT_FORGE_CONFIG } from './forgeConfig.js'
import { VisionVerdictSchema, deriveOverall, CRITERIA, NA_CRITERIA_BY_CLASS, type VisionCriteria } from './visionQa/verdict.js'
import { paintRoadAutotile, ROAD_BASE, ROAD_EDGE, ROAD_GRIT } from './roadTiles.js'
import { TilesetManifest } from './terrainManifest.js'
import { validateBuildingAlignment, footprintDiamond } from './alignment.js'
import { LIBRARY, libraryEntry } from './library/catalog.js'
import { registerLibraryEntry, ICON_SUFFIX } from './library/register.js'
import { AssetCodex } from './codex.js'
import { openForgeDb } from './db.js'
import type { RawImage } from './post/raw.js'

const SRC = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- 1. verdicts

const criterion = (score: number, pass = score >= 7) => ({ pass, score, evidence: 'fixture' })
const criteria = (over: Partial<Record<string, ReturnType<typeof criterion>>> = {}): VisionCriteria =>
  Object.fromEntries(CRITERIA.map(c => [c, over[c] ?? criterion(10)])) as VisionCriteria

describe('G13a.1 — verdict schema and derivation', () => {
  it('round-trips a verdict', () => {
    const v = {
      assetId: 'library:axe', model: 'google/gemini-3.7-flash', rubricVersion: 'v1',
      criteria: criteria(), overall: 'pass' as const, feedback: '',
    }
    expect(VisionVerdictSchema.parse(v)).toEqual(v)
    expect(() => VisionVerdictSchema.parse({ ...v, overall: 'maybe' })).toThrow()
  })

  it('derives the four outcomes exactly', () => {
    const o = { minScore: 7, maxRetries: 2 }
    // hard fail on a binary criterion, whatever the score says
    expect(deriveOverall(criteria({ singleFigure: criterion(10, false) }), { ...o, attempt: 1 })).toBe('retry')
    expect(deriveOverall(criteria({ density: criterion(6) }), { ...o, attempt: 1 })).toBe('retry')
    expect(deriveOverall(criteria(), { ...o, attempt: 1 })).toBe('pass')
    expect(deriveOverall(criteria({ density: criterion(6) }), { ...o, attempt: 3 })).toBe('blocked')
  })
})

// ---------------------------------------------------------------- 2. autotile

describe('G13a.2 — road autotiling', () => {
  it('is total over all sixteen neighbour combinations and hits all fifteen keys', () => {
    const seen = new Set<RoadAutotileKey>()
    for (let m = 0; m < 16; m++) {
      const k = roadAutotile({ n: !!(m & 1), e: !!(m & 2), s: !!(m & 4), w: !!(m & 8) })
      expect(ROAD_AUTOTILE_KEYS, `mask ${m}`).toContain(k)
      seen.add(k)
    }
    expect(seen.size).toBe(15)
    expect(ROAD_AUTOTILE_KEYS).toHaveLength(15)
  })

  it('draws an isolated tile as the stub that faces the camera', () => {
    expect(roadAutotile({ n: false, e: false, s: false, w: false })).toBe('cap-s')
  })

  it('refuses a manifest autotile block that is one tile short', () => {
    const base = {
      tileW: 32, tileH: 16, cols: 4, rows: 4, scaffolding: { file: 's.png' },
      seasons: Object.fromEntries((['spring', 'summer', 'autumn', 'winter'] as const)
        .map(s => [s, { file: `${s}.png`, tiles: Array.from({ length: 16 }, (_, i) => `t${i}`) }])),
    }
    const tiles = (n: number) => Object.fromEntries(ROAD_AUTOTILE_KEYS.slice(0, n).map((k, i) => [k, i]))
    expect(() => TilesetManifest.parse({ ...base, autotile: { road: { file: 'r.png', tiles: tiles(15) } } })).not.toThrow()
    expect(() => TilesetManifest.parse({ ...base, autotile: { road: { file: 'r.png', tiles: tiles(14) } } }))
      .toThrow(/all 15 road tiles required/)
    expect(() => TilesetManifest.parse(base), 'the block stays optional').not.toThrow()
  })

  it('paints all fifteen tiles palette-true', () => {
    const allowed = new Set([ROAD_BASE, ROAD_EDGE, ROAD_GRIT])
    for (const k of ROAD_AUTOTILE_KEYS) {
      const img = paintRoadAutotile(k)
      expect([img.width, img.height], k).toEqual([32, 16])
      let opaque = 0
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue
        opaque++
        const rgb = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!
        expect(allowed.has(rgb), `${k} paints #${rgb.toString(16)}`).toBe(true)
      }
      expect(opaque, k).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------- 3. city template

describe('G13a.3 — the city template', () => {
  const t = makeCityTemplate()

  it('parses Zod-strict, is deterministic, and stamps inside 128x128 at the genesis anchor', () => {
    expect(makeCityTemplate()).toEqual(t)
    for (const x of t.tiles) {
      expect(t.anchor.x + x.dx).toBeLessThan(WORLD_SIZE_GENESIS)
      expect(t.anchor.y + x.dy).toBeLessThan(WORLD_SIZE_GENESIS)
    }
    expect(t.structures).toHaveLength(11)
  })

  // The town has to WORK: every door must be walkable-to from the square.
  it('reaches every building door from the market square over the road grid', () => {
    const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
    const start = key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy)
    expect(roads.has(start)).toBe(true)
    const seen = new Set([start])
    const stack: [number, number][] = [[PLAZA_CENTRE.dx, PLAZA_CENTRE.dy]]
    while (stack.length) {
      const [dx, dy] = stack.pop()!
      for (const [nx, ny] of [[dx, dy - 1], [dx + 1, dy], [dx, dy + 1], [dx - 1, dy]] as [number, number][]) {
        const k = key(nx, ny)
        if (roads.has(k) && !seen.has(k)) { seen.add(k); stack.push([nx, ny]) }
      }
    }
    // The door is on the face the structure's FACING names, and half this town faces +x — a
    // reach test that only looked south found the storehouse's door in its own back wall.
    for (const s of t.structures) {
      const d = s.w === 1 && s.h === 1 ? doorTile(s) : doorFrontTile(s)
      const reached = seen.has(key(d.dx, d.dy))
        || [[d.dx, d.dy - 1], [d.dx + 1, d.dy], [d.dx, d.dy + 1], [d.dx - 1, d.dy]]
          .some(([x, y]) => seen.has(key(x!, y!)))
      expect(reached, `${s.kind} at ${key(s.dx, s.dy)} is cut off from the square`).toBe(true)
    }
  })

  // THE NO-BRIDGE LAW.
  it('carries no road over water', () => {
    const water = new Set(t.tiles.filter(x => x.to === T_WATER).map(x => key(x.dx, x.dy)))
    for (const x of t.tiles.filter(isRoadTile))
      expect(water.has(key(x.dx, x.dy)), key(x.dx, x.dy)).toBe(false)
  })

  it('clears growth plots that no structure stands on', () => {
    const built = new Set(t.structures.flatMap(s => structureTiles(s).map(c => key(c.dx, c.dy))))
    const plots = growthPlots(t)
    expect(plots.length).toBeGreaterThan(0)
    for (const p of plots) expect(built.has(key(p.dx, p.dy))).toBe(false)
  })

  // THE CROSS-PACKAGE CHECK the plan declared in Task 26 and closes here.
  it('furnishes only kinds the library actually holds', () => {
    for (const s of t.structures)
      for (const f of s.furnishings) {
        const kind = resolveFurnishingKind(f.kind)
        expect(libraryEntry(kind), `${s.kind} wants ${f.kind}`).not.toBeNull()
        expect(libraryEntry(kind)!.category, kind).toBe('furniture')
      }
  })

  it('agrees with shared stand-in lists that shared cannot check itself', () => {
    for (const k of CITY_FURNISHING_KINDS) {
      const e = libraryEntry(resolveFurnishingKind(k))
      expect(e, k).not.toBeNull()
      expect(e!.interior, k).toBeDefined()
      // every declared kind fits the interior slot grid the template lays out
      expect(e!.interior!.slots.w).toBeLessThanOrEqual(CITY_INTERIOR_SLOTS.w)
      expect(e!.interior!.slots.h).toBeLessThanOrEqual(CITY_INTERIOR_SLOTS.h)
    }
    expect(libraryEntry(CITY_BED_KIND)!.interior!.isBed).toBe(true)
    expect(libraryEntry(CITY_HEARTH_KIND)!.interior!.isHearth).toBe(true)
  })

  // Anchors alone can be distinct while the pieces overlap: a bed is two slots tall.
  it('lays no furnishing across another once the library slot sizes are applied', () => {
    for (const s of t.structures) {
      const filled = new Set<string>()
      for (const f of s.furnishings) {
        const slots = libraryEntry(resolveFurnishingKind(f.kind))!.interior!.slots
        for (let y = 0; y < slots.h; y++)
          for (let x = 0; x < slots.w; x++) {
            const k = key(f.slot.x + x, f.slot.y + y)
            expect(filled.has(k), `${s.kind}: ${f.kind} lies across ${k}`).toBe(false)
            filled.add(k)
          }
      }
    }
  })
})

// ---------------------------------------------------------------- 4. alignment

describe('G13a.4 — the alignment pixel half', () => {
  const CELL = { w: 64, h: 64, feetY: 56 }
  const D = footprintDiamond({ w: 1, h: 1 }, CELL)

  const block = (bottomY: number, width: number): RawImage => {
    const img: RawImage = { width: CELL.w, height: CELL.h, data: new Uint8ClampedArray(CELL.w * CELL.h * 4) }
    const x0 = Math.round(D.centerX - width / 2)
    for (let y = Math.max(0, bottomY - 19); y <= bottomY && y < CELL.h; y++)
      for (let x = x0; x < x0 + width && x < CELL.w; x++) img.data[(y * CELL.w + x) * 4 + 3] = 255
    return img
  }
  const run = (img: RawImage) => validateBuildingAlignment(img, { w: 1, h: 1 }, DEFAULT_FORGE_CONFIG.alignment, CELL)

  it('is exact on the four authored fixtures', () => {
    expect(run(block(56, 24)).ok, 'good').toBe(true)
    expect(run(block(50, 24)).failures.join(' '), 'floating').toMatch(/feet line/)
    expect(run(block(62, 24)).failures.join(' '), 'sunken').toMatch(/below the near vertex/)
    expect(run(block(56, 56)).failures.join(' '), 'overhanging').toMatch(/base fit/)
  })
})

// ---------------------------------------------------------------- 5. library codex

describe('G13a.5 — the library in the codex', () => {
  it('registers all fifty entries as two parseable rows each', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const png = Buffer.from('png')
    let n = 0
    for (const e of LIBRARY) {
      const { spriteRecord, iconRecord } = registerLibraryEntry(codex, e, {
        sprite: png, icon: png, score: 8, attempts: 1, costUsd: 0,
      })
      for (const r of [spriteRecord, iconRecord]) {
        const m = parseLibraryItemManifest(r.meta)
        expect(m, `${e.kind} ${r.kind}`).not.toBeNull()
        expect(m!.kind).toBe(e.kind)
        // every furniture record carries its interior meta, on BOTH rows
        expect(m!.interior !== undefined, `${e.kind} interior`).toBe(e.category === 'furniture')
        n++
      }
      expect(iconRecord.kind).toBe(`${e.kind}${ICON_SUFFIX}`)
      expect(iconRecord.widthPx).toBe(e.iconPx)
    }
    expect(n).toBe(100)
  })

  it('resolves the six C10 FurnishingKind originals', () => {
    for (const k of ['bed', 'hearth', 'table', 'shelf', 'crate', 'tools']) {
      const e = libraryEntry(resolveFurnishingKind(k))
      expect(e, k).not.toBeNull()
      expect(e!.category, k).toBe('furniture')
    }
  })
})

// ---------------------------------------------------------------- 6. lane law

describe('G13a.6 — the parallel-lane boundary', () => {
  const FORBIDDEN = ['@sj/engine', '@sj/gateway', '@sj/web', '@sj/agents', '@sj/arbiter', '@sj/narrator']
  const SHARED_MODULES = ['autotile.ts', 'interiorMeta.ts', 'cityTemplate.ts']

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(n => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
    })

  it('never lets forge or the new shared modules import a consumer lane', () => {
    const files = [
      ...walk(SRC),
      ...SHARED_MODULES.map(m => join(SRC, '..', '..', 'shared', 'src', m)),
    ]
    expect(files.length).toBeGreaterThan(30)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const pkg of FORBIDDEN) {
        // The import FORM, not the bare name — this file names all six in a list and still
        // has to be scanned like every other.
        const re = new RegExp(String.raw`(?:from|import|require)\s*\(?\s*['"]${pkg.replace('/', '\\/')}`)
        expect(re.test(src), `${f} imports ${pkg}`).toBe(false)
      }
    }
  })

  it('keeps the vision rubric N/A table honest about the classes it serves', () => {
    for (const klass of ['item', 'icon', 'building', 'character', 'portrait', 'terrain'])
      for (const c of NA_CRITERIA_BY_CLASS[klass] ?? [])
        expect(CRITERIA, `${klass} names ${c}`).toContain(c)
  })
})
