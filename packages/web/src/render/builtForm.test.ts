import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INTERIOR_KINDS } from '@sj/shared'
import { TILE_H, TILE_W } from './iso.js'
import {
  BUILT_FORM_ACCENTS,
  BUILT_FORM_DEFAULT_HEIGHT_TILES,
  BUILT_FORM_HEIGHT_TILES,
  BUILT_FORM_INK,
  BUILT_FORM_INSET_TILES,
  BUILT_FORM_RAMPS,
  BUILT_FORM_UNIT_PX,
  builtFormSpec,
  drawBuiltForm,
  footprintDiamond,
} from './builtForm.js'
import { buildingArt } from './textures.js'
import { BUILDING_PX_PER_TILE } from './textures.js'
import { TOWN_KINDS } from './landmarks.js'

// The forge's 40-colour master palette (packages/forge/src/palette.ts), restated because
// @sj/web cannot import it: forge pulls sharp and better-sqlite3.
const MASTER_PALETTE = [
  0xfff6e9, 0xf6e8d5, 0xe8d5bc, 0xd4bc9e, 0xb89d7e, 0xf2c879, 0xe0a95e, 0xc68a48, 0xa66e38,
  0x7e512b, 0xdce8c8, 0xb9d19a, 0x93b573, 0x6f9455, 0x4f7040, 0xf2c6c2, 0xe09e9b, 0xc47876,
  0x9e5a5c, 0xd6eaf2, 0xa8cfe0, 0x7fb0c9, 0x5a8cab, 0x3e6786, 0xe9e2da, 0xcfc6bc, 0xaba198,
  0x857d75, 0x5d5751, 0x43394a, 0x322b38, 0x241f2b, 0x171420, 0xf7a66b, 0xe8785a, 0x8a6fa8,
  0xf4e289, 0xf5d3b3, 0xd9a876, 0x9c6b47,
]

// Every structure kind this product can raise today.
const ALL_KINDS = [...new Set([...TOWN_KINDS, ...INTERIOR_KINDS, 'grave', 'bridge', 'cottage'])]
const SHAPES: Array<[number, number]> = [
  [1, 1],
  [2, 2],
  [1, 2],
  [2, 1],
  [3, 2],
  [2, 3],
  [4, 2],
]

const xsOf = (poly: number[]): number[] => poly.filter((_, i) => i % 2 === 0)
const ysOf = (poly: number[]): number[] => poly.filter((_, i) => i % 2 === 1)

// Art for the two new dwellings may land days after the template places them. Until it does
// the fallback IS the building, so it has to say something different about each one.
describe('the three dwellings read as three buildings even with no art', () => {
  it('gives each a distinct volume — no two share both a material and a height', () => {
    const seen = new Set<string>()
    for (const kind of ['house', 'cottage', 'longhouse']) {
      const h = BUILT_FORM_HEIGHT_TILES[kind] ?? BUILT_FORM_DEFAULT_HEIGHT_TILES
      const ramp = builtFormSpec(kind, 2, 2).faces[2].color
      expect(seen.has(`${ramp}:${h}`), kind).toBe(false)
      seen.add(`${ramp}:${h}`)
    }
  })
})

describe('footprintDiamond — the one ground-shape both the hit area and the form are cut from', () => {
  it('is the tile diamond for a 1×1, north vertex at the local origin', () => {
    expect(footprintDiamond(1, 1)).toEqual([0, 0, 16, 8, 0, 16, -16, 8])
  })

  it('grows with the footprint and never wider than the ground it stands on', () => {
    for (const [w, h] of SHAPES) {
      const xs = xsOf(footprintDiamond(w, h))
      expect(Math.max(...xs) - Math.min(...xs), `${w}×${h}`).toBe((w + h) * (TILE_W / 2))
      const ys = ysOf(footprintDiamond(w, h))
      expect(Math.max(...ys) - Math.min(...ys), `${w}×${h}`).toBe((w + h) * (TILE_H / 2))
    }
  })
})

describe('a structure kind with no art still reads as a built thing', () => {
  it('gives EVERY kind a form — this is the hole the plaza fell into', () => {
    for (const kind of ALL_KINDS) {
      const form = builtFormSpec(kind, 1, 1)
      expect(form.faces.length, kind).toBe(3)
      expect(form.heightPx, kind).toBeGreaterThan(0)
    }
  })

  it('gives a kind nobody has ever heard of a form too — the hole recurs', () => {
    for (const kind of ['obelisk', 'dovecote', '', 'kind_with_a_very_long_name']) {
      const form = builtFormSpec(kind, 1, 1)
      expect(form.faces.length, kind).toBe(3)
      expect(form.heightPx, kind).toBe(BUILT_FORM_DEFAULT_HEIGHT_TILES * BUILT_FORM_UNIT_PX)
    }
  })

  it('paints nothing that is not a MASTER_PALETTE member', () => {
    for (const kind of [...ALL_KINDS, 'obelisk']) {
      const form = builtFormSpec(kind, 2, 2)
      for (const face of [form.plinth, ...form.faces, form.accent]) {
        expect(MASTER_PALETTE, `${kind} — 0x${face.color.toString(16)}`).toContain(face.color)
      }
      expect(form.silhouette).toHaveLength(12) // six points around the outside
      expect(form.nearEdge).toHaveLength(4)
      expect(MASTER_PALETTE).toContain(form.ink)
    }
    for (const ramp of Object.values(BUILT_FORM_RAMPS)) {
      for (const c of Object.values(ramp)) expect(MASTER_PALETTE).toContain(c)
    }
    for (const c of Object.values(BUILT_FORM_ACCENTS)) expect(MASTER_PALETTE).toContain(c)
    expect(MASTER_PALETTE).toContain(BUILT_FORM_INK)
  })

  it('never paints a checkerboard: no two adjacent faces share a colour', () => {
    for (const kind of ALL_KINDS) {
      const [left, right, top] = builtFormSpec(kind, 2, 2).faces
      expect(left!.color, kind).not.toBe(right!.color)
      expect(right!.color, kind).not.toBe(top!.color)
      expect(top!.color, kind).not.toBe(left!.color)
    }
  })

  it('stands INSIDE its own footprint — a form can never reach a neighbour', () => {
    for (const [w, h] of SHAPES) {
      const ground = footprintDiamond(w, h)
      const halfW = (Math.max(...xsOf(ground)) - Math.min(...xsOf(ground))) / 2
      for (const kind of ALL_KINDS) {
        const form = builtFormSpec(kind, w, h)
        const xs = [form.plinth, ...form.faces, form.accent].flatMap((f) => xsOf(f.poly))
        expect(Math.max(...xs), `${kind} ${w}×${h}`).toBeLessThanOrEqual(halfW)
        expect(Math.min(...xs), `${kind} ${w}×${h}`).toBeGreaterThanOrEqual(-halfW)
      }
    }
  })

  it('rises upward and never overhangs further than the art law allows', () => {
    for (const [w, h] of SHAPES) {
      for (const kind of ALL_KINDS) {
        const form = builtFormSpec(kind, w, h)
        const ys = [...form.faces, form.accent].flatMap((f) => ysOf(f.poly))
        expect(Math.min(...ys), `${kind} ${w}×${h}`).toBeLessThan(0)
        // the same ceiling the hi-res building art answers to: a (w+h)·32 px square
        expect(-Math.min(...ys), `${kind} ${w}×${h}`).toBeLessThanOrEqual(
          (w + h) * BUILDING_PX_PER_TILE,
        )
      }
    }
  })

  it('is deterministic — two calls agree, and the kind alone decides', () => {
    expect(builtFormSpec('well', 1, 1)).toEqual(builtFormSpec('well', 1, 1))
    expect(builtFormSpec('obelisk', 1, 1)).toEqual(builtFormSpec('obelisk', 1, 1))
  })

  it('reads the two plaza monuments as low civic stonework, not as houses', () => {
    const well = builtFormSpec('well', 1, 1)
    const firePit = builtFormSpec('fire_pit', 1, 1)
    const house = builtFormSpec('house', 1, 1)
    expect(well.heightPx).toBeLessThan(house.heightPx)
    expect(firePit.heightPx).toBeLessThan(well.heightPx)
    expect(well.plinth.color).toBe(BUILT_FORM_RAMPS.stone.plinth)
    expect(well.accent.color).toBe(BUILT_FORM_ACCENTS.well)
    expect(firePit.accent.color).toBe(BUILT_FORM_ACCENTS.fire_pit)
  })

  it('keeps every named height inside the table it is read from', () => {
    for (const [kind, tiles] of Object.entries(BUILT_FORM_HEIGHT_TILES)) {
      expect(builtFormSpec(kind, 1, 1).heightPx, kind).toBe(tiles * BUILT_FORM_UNIT_PX)
    }
    expect(BUILT_FORM_INSET_TILES).toBeGreaterThan(0)
    expect(BUILT_FORM_INSET_TILES).toBeLessThan(0.5)
  })
})

describe('drawBuiltForm', () => {
  type Op = { op: string; arg: unknown }
  const painter = (log: Op[]): Parameters<typeof drawBuiltForm>[0] => ({
    clear: () => log.push({ op: 'clear', arg: null }),
    poly: (p) => log.push({ op: 'poly', arg: p }),
    fill: (c) => log.push({ op: 'fill', arg: c }),
    stroke: (s) => log.push({ op: 'stroke', arg: s }),
  })

  it('clears first, fills plinth → faces → accent, then rims the silhouette', () => {
    const log: Op[] = []
    const form = builtFormSpec('well', 1, 1)
    drawBuiltForm(painter(log), form)
    expect(log[0]!.op).toBe('clear')
    expect(log.filter((o) => o.op === 'fill').map((o) => o.arg)).toEqual([
      form.plinth.color,
      ...form.faces.map((f) => f.color),
      form.accent.color,
    ])
    // the outer outline, the plinth and the one near vertical edge — NOT every face, which
    // drew a wireframe box that read as glass
    expect(log.filter((o) => o.op === 'stroke')).toHaveLength(3)
    for (const s of log.filter((o) => o.op === 'stroke')) {
      expect((s.arg as { color: number }).color).toBe(BUILT_FORM_INK)
    }
  })
})

describe('THE PLAZA REGRESSION — no structure kind may render as missing art', () => {
  it('resolves a kind with no codex record to NO ART, never to the checkerboard', () => {
    for (const kind of ALL_KINDS) {
      expect(buildingArt([], kind, 1, 1).url, kind).toBeNull()
    }
  })

  it('leaves no path in the renderer that can still reach the placeholder building png', () => {
    const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('placeholder/building')
    // and the fallback is actually wired: the form is drawn where the art would have been
    expect(src).toContain('drawBuiltForm')
  })
})
