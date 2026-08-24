import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG, makeCityTemplate, CITY_DWELLING_KINDS, footprintFor, parseBuildingManifest,
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
  ONE_CELL_KINDS, SE_MIRROR_MIN_DISTANCE, STOREHOUSE_KIND, TWO_FACING_KINDS,
  facingPartitionIsTotal, mirrorFacingGate, requiredFacings, structureArtCoverage,
  worldStructureKinds,
} from './structureArt.js'

// ★ THE GATE THAT WOULD HAVE CAUGHT ALL OF THIS — AND THE BLIND SPOT IT SHIPPED WITH.
//
// A farmhouse stood in the town with no art for a whole merge train and CI stayed green. The
// founders' home registered under kind `hut` — a kind nothing places — and CI stayed green.
// Round 4 added the coverage law and both stopped.
//
// It then missed SIX MORE KINDS for the same reason in a different place: it asked only what
// `makeCityTemplate()` places. `bridge` is raised by an agent through the `build` verb,
// `grave` is laid by the world when somebody dies, and `wagon`, `shed`, `scaffolding` and
// `standing_stone` are stood by the gateway's own dev town. None of the six was in the
// template, so the gate never looked, stayed green, and all six drew a grey prism. Worse,
// `well` and `fire_pit` were EXEMPTED by name — and a human found them standing bare in the
// middle of the town square.
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
const RECIPES = DEFAULT_CONFIG.structures.recipes

/** The four the GATEWAY's fixture town stands. `@sj/forge` cannot import `@sj/gateway`, so the
 *  names are frozen here as data and `ingestArt.test.ts` asserts they are still that town's
 *  kinds — the two halves of one law, each next to the source it can see. */
const DEV_TOWN_KINDS = ['scaffolding', 'shed', 'standing_stone', 'wagon'] as const

const CREATABLE = worldStructureKinds({
  structures: TEMPLATE.structures, recipes: RECIPES, extra: DEV_TOWN_KINDS,
})

/** Where a kind's UNTURNED mass is stated — `w` along the street, `h` into the block. The
 *  template and the recipe table are both authorities and they agree on `house`; the dev town's
 *  four are asserted in the gateway, next to it.
 *
 *  ★ A TEMPLATE INSTANCE STATES ITS TURNED GROUND, so it is un-turned by its own facing before
 *  it can key a per-kind table. `footprintFor` is its own inverse. Reading `s.w`/`s.h` straight
 *  made this map last-instance-wins: the only farmhouse in the template faces SE, so the table
 *  said 2×4 and the SW cell that stands on 4×2 was graded against the wrong diamond. */
const untorn = (s: { w: number; h: number; facing: 'sw' | 'se' }) =>
  footprintFor({ w: s.w, h: s.h }, s.facing)
const AUTHORITATIVE_FOOTPRINT = new Map<string, { w: number; h: number }>([
  ...TEMPLATE.structures.map((s) => [s.kind, untorn(s)] as const),
  ...Object.entries(RECIPES).map(([k, r]) => [k, { w: r.w, h: r.h }] as const),
])

describe('every kind the WORLD CAN CREATE has a cell, in every facing it can stand in', () => {
  it('is measuring the world it thinks it is: four sources, not one', () => {
    expect([...new Set(TEMPLATE.structures.map((s) => s.kind))].sort())
      .toEqual(['cabin', 'cottage', 'farmhouse', 'fire_pit', 'house', 'storehouse', 'well'])
    // the buildable half and the world-places-it half of the recipe table
    expect(Object.keys(RECIPES).sort()).toEqual(['bridge', 'grave', 'house', 'lamp_post', 'well'])
    expect(CREATABLE).toEqual([
      'bridge', 'cabin', 'cottage', 'farmhouse', 'fire_pit', 'grave', 'house', 'lamp_post',
      'scaffolding', 'shed', 'standing_stone', 'storehouse', 'wagon', 'well',
    ])
    // and the per-kind mass above is a fact, not a coin toss: every instance of a kind must
    // un-turn to the SAME mass, or keying a map by kind silently keeps whichever came last.
    const byKind = new Map<string, Set<string>>()
    for (const s of TEMPLATE.structures) {
      byKind.set(s.kind, (byKind.get(s.kind) ?? new Set()).add(JSON.stringify(untorn(s))))
    }
    expect([...byKind].filter(([, m]) => m.size > 1).map(([k]) => k),
      'one kind, two masses — AUTHORITATIVE_FOOTPRINT would be last-instance-wins').toEqual([])
  })

  it('NO KIND IS EXEMPT: every creatable kind either turns or says why it cannot', () => {
    expect(facingPartitionIsTotal(CREATABLE)).toEqual([])
    // Named, so widening either list is a visible edit and not a quiet one.
    expect(TWO_FACING_KINDS).toEqual([...CITY_DWELLING_KINDS, STOREHOUSE_KIND, 'shed', 'wagon'])
    expect(Object.keys(ONE_CELL_KINDS).sort())
      .toEqual(['bridge', 'fire_pit', 'grave', 'lamp_post', 'scaffolding', 'standing_stone', 'well'])
    // and every reason is a sentence somebody wrote, not an empty string
    for (const [k, why] of Object.entries(ONE_CELL_KINDS)) {
      expect(why.length, `${k} has no reason`).toBeGreaterThan(20)
    }
  })

  it('the partition NAMES a kind that falls outside both lists', () => {
    expect(facingPartitionIsTotal([...CREATABLE, 'watchtower'])).toEqual([
      'watchtower is on neither list — say whether it turns, and if it does not, say why',
    ])
  })

  it('MISSING: no kind the world can create is left to the procedural block', () => {
    const { missing } = structureArtCoverage({
      structures: TEMPLATE.structures, registered: registeredKinds(), creatable: CREATABLE,
    })
    expect(missing, `the world can create these and no codex cell answers:\n  ${missing.join('\n  ')}`)
      .toEqual([])
  })

  it('ORPHAN: no cell is registered under a kind nothing can create', () => {
    const { orphans } = structureArtCoverage({
      structures: TEMPLATE.structures, registered: registeredKinds(), creatable: CREATABLE,
    })
    expect(orphans, `registered, but nothing in the world is ever this kind:\n  ${orphans.join('\n  ')}`)
      .toEqual([])
  })

  it('the fallback cannot satisfy this gate: builtForm writes no codex row', () => {
    // If the coverage were read off the renderer instead of the codex, an EMPTY codex would
    // pass, because builtForm draws every kind. It must not.
    const empty = structureArtCoverage({
      structures: TEMPLATE.structures, registered: [], creatable: CREATABLE,
    })
    expect(empty.missing.length).toBeGreaterThan(0)
    expect(empty.missing).toContain('house facing sw')
    expect(empty.missing).toContain('grave facing sw')
  })

  it('★ MUTATION: a new runtime kind with no art turns it RED, with no edit to this file', () => {
    // Stated as a DELTA, so it proves the same thing whether the tree is whole or already
    // broken: adding one buildable row to the config adds exactly one failure and no other.
    const registered = registeredKinds()
    const before = structureArtCoverage({
      structures: TEMPLATE.structures, registered, creatable: CREATABLE,
    })
    const after = structureArtCoverage({
      structures: TEMPLATE.structures,
      registered,
      creatable: worldStructureKinds({
        structures: TEMPLATE.structures,
        recipes: { ...RECIPES, watchtower: {} },
        extra: DEV_TOWN_KINDS,
      }),
    })
    expect(after.missing.filter((m) => !before.missing.includes(m)))
      .toEqual(['watchtower facing sw'])
  })

  it('a kind the template stands but the recipe table has never heard of is still covered', () => {
    // fire_pit is template-only; the old gate would have dropped it into the exemption.
    expect(requiredFacings(TEMPLATE.structures, CREATABLE).get('fire_pit'))
      .toEqual(new Set(['sw']))
    expect(requiredFacings(TEMPLATE.structures, CREATABLE).get('shed'))
      .toEqual(new Set(['sw', 'se']))
    expect(requiredFacings(TEMPLATE.structures, CREATABLE).size).toBe(CREATABLE.length)
  })
})

// ★ THE RED PROOF, FROZEN. Fixing the content ends the live failure, so the exact shape of
// each defect is kept here as data. Same technique the rejected farmland_0 fixture uses.
describe('the pre-fix trees, as fixtures', () => {
  it('round 3: reports the missing home AND the orphan hut', () => {
    const c = structureArtCoverage({
      structures: TEMPLATE.structures, registered: ['hut'], creatable: CREATABLE,
    })
    expect(c.missing).toContain('house facing sw')
    expect(c.orphans).toEqual(['hut'])
    for (const k of ['cottage', 'cabin', 'farmhouse']) expect(c.missing).toContain(`${k} facing sw`)
  })

  it('★ round 4: the ten dwelling cells were green and SIX KINDS still had no art', () => {
    const ROUND_4_REGISTERED = [
      'cabin', 'cabin:se', 'cottage', 'cottage:se', 'farmhouse', 'farmhouse:se',
      'house', 'house:se', 'storehouse', 'storehouse:se',
    ]
    // Round 4's own gate — template only, well and fire_pit exempted — reported nothing.
    const blind = structureArtCoverage({
      structures: TEMPLATE.structures.filter((s) => s.kind !== 'well' && s.kind !== 'fire_pit'),
      registered: ROUND_4_REGISTERED,
    })
    expect(blind.missing).toEqual([])

    // The widened one names every kind the user and the boot log actually found bare.
    const c = structureArtCoverage({
      structures: TEMPLATE.structures, registered: ROUND_4_REGISTERED, creatable: CREATABLE,
    })
    expect(c.missing).toEqual([
      'bridge facing sw',      // an agent builds this at the ford
      'fire_pit facing sw',    // EXEMPTED by name, and bare in the middle of the town square
      'grave facing sw',       // the world lays this when somebody dies
      'lamp_post facing sw',   // the night-light lane added a kind, and the gate found it
      'scaffolding facing sw', // the dev town stands these four
      'shed facing sw', 'shed facing se',
      'standing_stone facing sw',
      'wagon facing sw', 'wagon facing se',
      'well facing sw',        // EXEMPTED by name, and bare in the middle of the town square
    ])
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

  it('ship one directory per kind and facing the world needs', () => {
    const want = [...requiredFacings(TEMPLATE.structures, CREATABLE)]
      .flatMap(([k, fs]) => [...fs].map((f) => facingKind(k, f))).sort()
    expect(cells.map((c) => c.codexKind).sort()).toEqual(want)
  })

  it.each(cells.map((c) => [c.dir, c] as const))('%s clears the pixel bar', async (_dir, c) => {
    const img = await decodePng(c.png)
    // ★ A TURNED BUILDING TURNS ITS GROUND, AND EVERY CREATABLE KIND IS ASKED. The mass is the
    // UNTURNED one — `w` along the street, `h` into the block — so an SE cell is graded against
    // it TURNED. Reading the mass straight is the mistake `footprintFor` exists to prevent:
    // `farmhouse-se` declared 4×2 and stands on 2×4, and every gate downstream graded the
    // diamond it was told about rather than the one the building covers.
    const mass = AUTHORITATIVE_FOOTPRINT.get(c.kind)
    // the four dev-town kinds are asserted against TOWN_STRUCTURES in the gateway's own test
    if (mass !== undefined) {
      expect(c.manifest.footprint, `${c.dir} declares the ground it does not stand on`)
        .toEqual(footprintFor(mass, c.facing))
    }
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
    expect(pairs.map((p) => p.kind).sort()).toEqual([...TWO_FACING_KINDS].sort())
    const r = mirrorFacingGate(pairs)
    expect(r.failures, r.measured.map((m) => `${m.kind} ${m.distance.toFixed(4)}`).join(', ')).toEqual([])
    expect(SE_MIRROR_MIN_DISTANCE).toBeGreaterThan(0)
  })
})
