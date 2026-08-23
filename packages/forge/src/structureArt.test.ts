import { describe, expect, it } from 'vitest'
import {
  makeCityTemplate, CITY_DWELLING_KINDS, DWELLING_FOOTPRINTS, footprintFor, parseBuildingManifest,
} from '@sj/shared'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import { decodePng } from './post/raw.js'
import { alphaBinaryGate, nativeDensityGate, paletteGate } from './pixelGates.js'
import { TOWN_TILE } from './assetResolution.js'
import { buildingCellPx } from './reCell.js'
import {
  STRUCTURE_FACINGS, facingKind, listCommittedBuildings, registerCommittedBuildings,
  splitFacingKind,
} from './buildingArt.js'
import {
  BUILT_FORM_ONLY, SE_MIRROR_MIN_DISTANCE, STOREHOUSE_KIND, TWO_FACING_KINDS,
  exemptionIsClosed, mirrorFacingGate, requiredFacings, structureArtCoverage,
} from './structureArt.js'

// ★ THE GATE THAT WOULD HAVE CAUGHT ALL OF THIS.
//
// A farmhouse stood in the town with no art for a whole merge train and CI stayed green. The
// founders' home registered under kind `hut` — a kind nothing places — and CI stayed green.
// Neither is subtle; there was simply no test that put the template's kind list beside the
// codex's kind column and compared them.
//
// IT MUST NOT BE SATISFIABLE BY THE PROCEDURAL FALLBACK. `builtForm` answers EVERY kind, so a
// gate that asks "did something draw?" passes forever. Everything below is measured on the
// CODEX — the same `class`/`kind` columns `buildingArt()` resolves on — and `builtForm` never
// writes a codex row. `the fallback cannot satisfy this gate` states that in a test.

/** The registration the dev world does at boot, against a real codex. */
function registeredKinds(): string[] {
  const db = openForgeDb(':memory:')
  try {
    const codex = new AssetCodex(db)
    registerCommittedBuildings(codex)
    return codex.listSince(0)
      .filter((r) => r.status === 'ready' && r.class === 'building' && r.kind !== null)
      .map((r) => r.kind!)
  } finally {
    db.close()
  }
}

const TEMPLATE = makeCityTemplate()

describe('every kind the town stands has a cell, in every facing it stands in', () => {
  it('the exemption is closed: no kind that must carry art can be waived into builtForm', () => {
    expect(exemptionIsClosed()).toEqual([])
    // Named, so widening it is a visible edit and not a quiet one.
    expect(BUILT_FORM_ONLY).toEqual(['well', 'fire_pit'])
    expect(TWO_FACING_KINDS).toEqual([...CITY_DWELLING_KINDS, STOREHOUSE_KIND])
  })

  it('is measuring the town it thinks it is', () => {
    const kinds = [...new Set(TEMPLATE.structures.map((s) => s.kind))].sort()
    expect(kinds).toEqual(['cabin', 'cottage', 'farmhouse', 'fire_pit', 'house', 'storehouse', 'well'])
    expect(requiredFacings(TEMPLATE.structures).size).toBe(kinds.length - BUILT_FORM_ONLY.length)
  })

  it('MISSING: no kind the template places is left to the procedural block', () => {
    const { missing } = structureArtCoverage({
      structures: TEMPLATE.structures, registered: registeredKinds(),
    })
    expect(missing, `these stand in the town with no codex cell:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('ORPHAN: no cell is registered under a kind nothing places', () => {
    const { orphans } = structureArtCoverage({
      structures: TEMPLATE.structures, registered: registeredKinds(),
    })
    expect(orphans, `registered, but nothing in the town is this kind:\n  ${orphans.join('\n  ')}`).toEqual([])
  })

  it('the fallback cannot satisfy this gate: builtForm writes no codex row', () => {
    // If the coverage were read off the renderer instead of the codex, an EMPTY codex would
    // pass, because builtForm draws every kind. It must not.
    const empty = structureArtCoverage({ structures: TEMPLATE.structures, registered: [] })
    expect(empty.missing.length).toBeGreaterThan(0)
    expect(empty.missing).toContain('house facing sw')
  })
})

// ★ THE RED PROOF, FROZEN. Fixing `ingestArt` ended the live failure, so the exact shape of
// the defect is kept here as data: the codex holds `hut`, the template stands `house`, and
// this gate reports BOTH halves. Same technique the rejected farmland_0 fixture uses.
describe('the pre-fix tree, as a fixture', () => {
  const PRE_TASK_1_REGISTERED = ['hut']  // ingestArt.ts:121,125 before the fix

  it('reports the missing home AND the orphan hut', () => {
    const c = structureArtCoverage({
      structures: TEMPLATE.structures, registered: PRE_TASK_1_REGISTERED,
    })
    expect(c.missing).toContain('house facing sw')
    expect(c.orphans).toEqual(['hut'])
    // and the three that had never had art at all
    for (const k of ['cottage', 'cabin', 'farmhouse']) expect(c.missing).toContain(`${k} facing sw`)
  })

  it('and passes only when the cell is re-keyed onto the kind the template places', () => {
    const fixed = ['house', 'house:se', 'cottage', 'cottage:se', 'cabin', 'cabin:se',
      'farmhouse', 'farmhouse:se', 'storehouse', 'storehouse:se']
    const c = structureArtCoverage({ structures: TEMPLATE.structures, registered: fixed })
    expect(c.missing).toEqual([])
    expect(c.orphans).toEqual([])
  })
})

describe('the facing rides in the kind', () => {
  it('SW keeps the bare kind so nothing already resolving breaks', () => {
    expect(facingKind('house', 'sw')).toBe('house')
    expect(facingKind('house', 'se')).toBe('house:se')
    expect(splitFacingKind('house')).toEqual({ kind: 'house', facing: 'sw' })
    expect(splitFacingKind('house:se')).toEqual({ kind: 'house', facing: 'se' })
  })

  it('and a colon that is not a facing is left alone', () => {
    expect(splitFacingKind('character:omar')).toEqual({ kind: 'character:omar', facing: 'sw' })
    expect(splitFacingKind('road:nsew')).toEqual({ kind: 'road:nsew', facing: 'sw' })
  })
})

describe('the committed cells', () => {
  const cells = listCommittedBuildings()

  it('ship one directory per kind and facing', () => {
    const want = TWO_FACING_KINDS.flatMap((k) => STRUCTURE_FACINGS.map((f) => facingKind(k, f))).sort()
    expect(cells.map((c) => c.codexKind).sort()).toEqual(want)
  })

  it.each(cells.map((c) => [c.dir, c] as const))('%s clears the pixel bar', async (_dir, c) => {
    const img = await decodePng(c.png)
    // ★ A TURNED BUILDING TURNS ITS GROUND. `DWELLING_FOOTPRINTS` is the UNTURNED mass — `w`
    // along the street, `h` into the block — and reading it straight for an SE cell is the
    // mistake `footprintFor` exists to prevent. It is the mistake this line used to make:
    // `farmhouse-se` declared 4×2 and stands on 2×4, and every gate downstream graded the
    // diamond it was told about rather than the one the building covers.
    const mass = c.kind === STOREHOUSE_KIND ? { w: 2, h: 2 } : DWELLING_FOOTPRINTS[c.kind as never]
    const fp = footprintFor(mass, c.facing)
    expect(c.manifest.footprint, `${c.dir} declares the ground it does not stand on`).toEqual(fp)
    const cellPx = buildingCellPx(c.manifest.footprint)
    expect([img.width, img.height], 'authored at the size the 4x stop draws').toEqual([cellPx, cellPx])
    expect(alphaBinaryGate(img).failures).toEqual([])
    expect(paletteGate(img).failures).toEqual([])
    expect(nativeDensityGate({
      name: c.dir, canvas: { w: img.width, h: img.height },
      footprint: c.manifest.footprint, tile: TOWN_TILE,
    }).failures).toEqual([])
    // the renderer needs the manifest to parse, or it draws at natural size with no anchor
    expect(parseBuildingManifest(JSON.stringify(c.manifest))).not.toBeNull()
  })

  it('turn the building instead of flipping it', async () => {
    const bySW = new Map(cells.filter((c) => c.facing === 'sw').map((c) => [c.kind, c]))
    const pairs = await Promise.all(cells.filter((c) => c.facing === 'se').map(async (se) => ({
      kind: se.kind,
      sw: await decodePng(bySW.get(se.kind)!.png),
      se: await decodePng(se.png),
    })))
    expect(pairs.length).toBe(TWO_FACING_KINDS.length)
    const r = mirrorFacingGate(pairs)
    expect(r.failures, r.measured.map((m) => `${m.kind} ${m.distance.toFixed(4)}`).join(', ')).toEqual([])
    expect(SE_MIRROR_MIN_DISTANCE).toBeGreaterThan(0)
  })
})
