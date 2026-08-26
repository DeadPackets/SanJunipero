import { describe, it, expect } from 'vitest'
import {
  BLOCK,
  STREET,
  PITCH,
  PLOT_OFFSETS,
  MAX_ALONG,
  MAX_DEEP,
  MIN_SEP,
  TOWN_FACINGS,
  ISO_HALF_W,
  ISO_HALF_H,
  screenOf,
  centreOf,
  riverCentre,
  isRiverWater,
  isRiverBank,
  RIVER_GROUND,
  DRY_GROUND,
  blockRect,
  blockTiles,
  blockIsPlattable,
  plotsOf,
  place,
  placedTiles,
  ringBlocks,
  plattedBlocks,
  freePlots,
  streetTiles,
  doorFrontOf,
  latticeFloor,
  closestPair,
  townErrors,
  townExtent,
  type Ground,
  type Plot,
} from './townGrammar.js'

// Not "this town has no overlaps" but "no town this grammar can generate has one": 2 496 pairings
// over a 3x3 patch, which covers the infinite lattice because it is periodic on PITCH in both axes.

describe('the constants are rulings, not dials', () => {
  // STREET was 2 and gave 71.6 px against a 72 px floor. maxDeep was unbounded and a 4×4 at a
  // block corner physically overlapped its neighbour. Each number here was paid for.
  it('names the lattice the reference implementation proved', () => {
    expect([BLOCK, STREET]).toEqual([16, 3])
    expect(PITCH).toBe(19)
    expect([...PLOT_OFFSETS]).toEqual([2, 9])
    expect([MAX_ALONG, MAX_DEEP]).toEqual([4, 2])
    expect(MIN_SEP).toBe(72)
  })

  // Moving equally in +dx and +dy is pure depth, which is why the grammar builds south and east.
  it('pins the projection every one of those numbers was measured in', () => {
    expect([ISO_HALF_W, ISO_HALF_H]).toEqual([16, 8])
    expect(screenOf(1, 0)).toEqual({ sx: 16, sy: 8 })
    expect(screenOf(0, 1)).toEqual({ sx: -16, sy: 8 })
    expect(screenOf(1, 1), 'equal +dx +dy is pure depth').toEqual({ sx: 0, sy: 16 })
  })

  // NE and NW are unauthored: the forge has no art for them, so the grammar cannot express
  // them at all. This is the type-level half; `place` is the value-level half.
  it('knows two facings and only two', () => {
    expect([...TOWN_FACINGS]).toEqual(['sw', 'se'])
  })
})

describe('the river the grid is not platted into', () => {
  it('is the reference meander, to the digit', () => {
    expect(riverCentre(0)).toBeCloseTo(-6, 10)
    expect(riverCentre(17)).toBeCloseTo(-6 + 5 * Math.sin(1) + 17 * 0.22, 10)
    expect(riverCentre(-22)).toBeCloseTo(-15.6498, 3)
    expect(riverCentre(37)).toBeCloseTo(6.2507, 3)
  })

  it('runs six tiles wide with a bank either side, and the two never overlap', () => {
    for (let dy = -40; dy <= 40; dy++)
      for (let dx = -40; dx <= 40; dx++)
        expect(isRiverWater(dx, dy) && isRiverBank(dx, dy), `${dx},${dy}`).toBe(false)
    expect(isRiverWater(-6, 0)).toBe(true)
    expect(isRiverWater(-3, 0)).toBe(false)
    expect(isRiverBank(-3, 0)).toBe(true)
    expect(isRiverBank(-1, 0)).toBe(false)
  })

  it('reports ground as one of three answers, and DRY_GROUND is dry everywhere', () => {
    expect(RIVER_GROUND(-6, 0)).toBe('water')
    expect(RIVER_GROUND(-3, 0)).toBe('bank')
    expect(RIVER_GROUND(20, 0)).toBe('dry')
    for (let dy = -30; dy <= 30; dy += 7)
      for (let dx = -30; dx <= 30; dx += 7) expect(DRY_GROUND(dx, dy)).toBe('dry')
  })
})

describe('the lattice', () => {
  it('plats blocks on the pitch, sixteen tiles of block and three of street', () => {
    expect(blockRect(0, 0)).toEqual({ dx0: 0, dy0: 0, dx1: 15, dy1: 15 })
    expect(blockRect(1, -1)).toEqual({ dx0: 19, dy0: -19, dx1: 34, dy1: -4 })
    expect(blockTiles(0, 0)).toHaveLength(BLOCK * BLOCK)
  })

  // Two plots on the south edge, two on the east, SE corner left as garden. Four, never five:
  // a plot at the corner is a building on two streets at once, and it overlapped.
  it('derives four plots from every block, south and east only', () => {
    const ps = plotsOf(0, 0)
    expect(ps.map((p) => p.slot)).toEqual(['s0', 's1', 'e0', 'e1'])
    expect(ps.filter((p) => p.face === 'sw')).toHaveLength(2)
    expect(ps.filter((p) => p.face === 'se')).toHaveLength(2)
    for (const p of ps) expect([p.maxAlong, p.maxDeep]).toEqual([MAX_ALONG, MAX_DEEP])
  })

  // The structural lemma the other proofs rest on: a plot is anchored to its street and the
  // building grows away from it, so a building's tiles are a subset of its own block's.
  it('never lets a legal building leave its own block', () => {
    let checked = 0
    for (const b of [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, -1],
      [3, -2],
    ] as const)
      for (const p of plotsOf(b[0], b[1])) {
        const own = new Set(blockTiles(b[0], b[1]).map((t) => `${t.dx},${t.dy}`))
        for (let along = 1; along <= MAX_ALONG; along++)
          for (let deep = 1; deep <= MAX_DEEP; deep++) {
            for (const t of placedTiles(place(p, 'x', along, deep, null))) {
              expect(
                own.has(`${t.dx},${t.dy}`),
                `${p.slot} ${along}×${deep} at ${t.dx},${t.dy}`,
              ).toBe(true)
              checked++
            }
          }
      }
    expect(checked).toBeGreaterThan(400)
  })

  // A rectangle in the array renders as a diamond on screen. `along` runs WITH the street and
  // `deep` into the block, so the same building on an east plot is that building turned.
  it('turns a building ninety degrees when the plot faces east', () => {
    const [s0, , e0] = plotsOf(0, 0) as [Plot, Plot, Plot, Plot]
    expect(place(s0, 'farmhouse', 4, 2, null)).toMatchObject({ w: 4, h: 2, facing: 'sw', dy: 14 })
    expect(place(e0, 'farmhouse', 4, 2, null)).toMatchObject({ w: 2, h: 4, facing: 'se', dx: 14 })
  })
})

describe('★ THE SPACING INVARIANT, PROVEN OVER THE WHOLE LATTICE', () => {
  const floor = latticeFloor()

  it('finds no physically overlapping pairing anywhere in the survey', () => {
    expect(floor.overlaps).toBe(0)
    expect(floor.pairings).toBeGreaterThan(2000)
  })

  it('puts the closest any two buildings can EVER be at 86.2 px, over a 72 px floor', () => {
    expect(floor.closest).toBeGreaterThan(MIN_SEP)
    expect(floor.closest).toBeCloseTo(86.1626, 3)
    expect(floor.worst).toBe('(0,0) s0 1×2  ↔  (-1,0) e1 4×1')
  })

  it('is not vacuous: a plot pitch the lattice does not use overlaps', () => {
    // The same survey with the two plots moved to offsets (2, 5) — a 3-tile pitch instead of
    // 7 — puts one building's tiles inside another's. The 7 is doing work.
    expect(latticeFloor([2, 5]).overlaps).toBeGreaterThan(0)
  })
})

describe('the genesis town and a grown one come out of ONE function', () => {
  const ring1 = plattedBlocks(1, RIVER_GROUND)
  const ring3 = plattedBlocks(3, RIVER_GROUND)

  it('reproduces the reference ruling at ring 1 and ring 3', () => {
    expect(ring1).toHaveLength(5)
    expect(freePlots(1, RIVER_GROUND)).toHaveLength(20)
    expect(ring3).toHaveLength(41)
    expect(freePlots(3, RIVER_GROUND)).toHaveLength(164)
  })

  it('never plats the square, at any ring', () => {
    for (let r = 0; r <= 5; r++)
      expect(plattedBlocks(r, RIVER_GROUND).some((b) => b.i === 0 && b.j === 0)).toBe(false)
  })

  it('offers plots nearest the square first, so the town densifies before it sprawls', () => {
    const ring = freePlots(3, RIVER_GROUND).map((p) =>
      Math.max(Math.abs(p.block.i), Math.abs(p.block.j)),
    )
    expect(ring).toEqual([...ring].sort((a, b) => a - b))
  })

  it('grows: every block ring 1 plats is still platted at ring 3', () => {
    const later = new Set(ring3.map((b) => `${b.i},${b.j}`))
    for (const b of ring1) expect(later.has(`${b.i},${b.j}`), `${b.i},${b.j}`).toBe(true)
  })

  it('counts the ring-N block set the ring rule promises', () => {
    expect(ringBlocks(0)).toEqual([{ i: 0, j: 0 }])
    expect(ringBlocks(1)).toHaveLength(8)
    expect(ringBlocks(3)).toHaveLength(24)
  })
})

// ── the three invariants the brief names, each proven for EVERY plot the grammar can produce ──

const EVERY_SIZE: ReadonlyArray<{ along: number; deep: number }> = Array.from(
  { length: MAX_ALONG * MAX_DEEP },
  (_, n) => ({ along: (n % MAX_ALONG) + 1, deep: Math.floor(n / MAX_ALONG) + 1 }),
)

/** every legal building on every plot the grammar offers out to `rings` */
function everyBuilding(rings: number, ground: Ground) {
  return freePlots(rings, ground).flatMap((p) =>
    EVERY_SIZE.map((s) => place(p, 'x', s.along, s.deep, null)),
  )
}

describe('★ NO BUILDING CAN EVER STAND ON WATER', () => {
  it('holds for every legal building on every plot, out to ring 4', () => {
    let checked = 0
    for (const b of everyBuilding(4, RIVER_GROUND))
      for (const t of placedTiles(b)) {
        expect(RIVER_GROUND(t.dx, t.dy), `a building at ${t.dx},${t.dy}`).toBe('dry')
        checked++
      }
    expect(checked).toBe(8520)
  })

  // The lemma is what makes this hold at every ring: a block is platted only if every one of its
  // tiles is dry, so the property belongs to the plat rule and not to a ring count.
  it('holds against an adversarial river the reference never drew', () => {
    const stripes: Ground = (dx, dy) => ((dx * 7 + dy * 13) % 23 === 0 ? 'water' : 'dry')
    let wet = 0
    for (const b of everyBuilding(3, stripes))
      for (const t of placedTiles(b)) if (stripes(t.dx, t.dy) !== 'dry') wet++
    expect(wet).toBe(0)
    // and the adversarial ground really does refuse blocks, so the check is not vacuous
    expect(plattedBlocks(3, stripes).length).toBeLessThan(plattedBlocks(3, DRY_GROUND).length)
  })

  it('refuses a block the moment one of its tiles is wet', () => {
    const oneTile: Ground = (dx, dy) => (dx === 5 && dy === 5 ? 'water' : 'dry')
    expect(blockIsPlattable(0, 0, oneTile)).toBe(false)
    expect(blockIsPlattable(1, 0, oneTile)).toBe(true)
  })

  // The bank is the wet earth beside the channel and nothing is platted on it either; excluding
  // it costs the town nothing at ring 1 or ring 3.
  it('refuses the bank as well as the channel', () => {
    const bank: Ground = (dx, dy) => (dx === 5 && dy === 5 ? 'bank' : 'dry')
    expect(blockIsPlattable(0, 0, bank)).toBe(false)
  })
})

describe('★ EVERY DOOR FRONTS A ROAD', () => {
  // A door onto a non-road is this project's most repeated root cause, four times over — so it is
  // asserted for every plot the grammar can produce, not the ones a fixture happened to build.
  for (const rings of [1, 2, 3]) {
    it(`holds for every legal building on every plot at ring ${rings}`, () => {
      const road = new Set(streetTiles(rings, RIVER_GROUND).map((t) => `${t.dx},${t.dy}`))
      const all = everyBuilding(rings, RIVER_GROUND)
      expect(all.length).toBeGreaterThan(0)
      for (const b of all) {
        const d = doorFrontOf(b)
        expect(
          road.has(`${d.dx},${d.dy}`),
          `${b.facing} door at ${d.dx},${d.dy} fronts no road`,
        ).toBe(true)
      }
    })
  }

  it('puts the door on the +y face when SW and the +x face when SE', () => {
    const [s0, , e0] = plotsOf(0, 0) as [Plot, Plot, Plot, Plot]
    expect(doorFrontOf(place(s0, 'x', 3, 2, null))).toEqual({ dx: 3, dy: 16 })
    expect(doorFrontOf(place(e0, 'x', 3, 2, null))).toEqual({ dx: 16, dy: 3 })
  })

  // A special case that widened the main street once ran a phantom road row at y = -3 through the
  // frontage of block (0,-1). There is none here, and this is the guard that keeps it so.
  it('never lays a street tile on a block, at any ring', () => {
    const onBlock = new Set(
      plattedBlocks(3, RIVER_GROUND).flatMap((b) =>
        blockTiles(b.i, b.j).map((t) => `${t.dx},${t.dy}`),
      ),
    )
    for (const t of streetTiles(3, RIVER_GROUND))
      expect(onBlock.has(`${t.dx},${t.dy}`), `a street on a block at ${t.dx},${t.dy}`).toBe(false)
  })

  it('never lays a street tile on water', () => {
    for (const t of streetTiles(3, RIVER_GROUND)) expect(isRiverWater(t.dx, t.dy)).toBe(false)
  })
})

describe('the town is as large as it has grown', () => {
  it('measures its extent from the built set, never from a map size', () => {
    const built = [
      place(plotsOf(0, -1)[0]!, 'house', 2, 2, null),
      place(plotsOf(1, 1)[2]!, 'house', 2, 2, null),
    ]
    const e = townExtent(built)
    expect(e.tiles).toEqual({ dx0: 2, dy0: -5, dx1: 34, dy1: 22 })
    expect(e.screen).toEqual({
      sx0: screenOf(2, 22).sx,
      sy0: screenOf(2, -5).sy,
      sx1: screenOf(34, -5).sx,
      sy1: screenOf(34, 22).sy,
    })
    expect(centreOf(built[0]!)).toEqual(screenOf(3, -4))
    expect(townExtent([]).tiles).toBeNull()
  })

  it('spaces the reference towns exactly as the reference measured them', () => {
    expect(closestPair(referenceTown(1))).toBeCloseTo(125.2198, 3)
    expect(closestPair(referenceTown(3, 30))).toBeCloseTo(100.2397, 3)
  })

  it('finds no error at all in either reference town', () => {
    expect(townErrors(referenceTown(1), streetTiles(1, RIVER_GROUND))).toEqual([])
    expect(townErrors(referenceTown(3, 30), streetTiles(3, RIVER_GROUND))).toEqual([])
  })

  it('finds errors when a building is planted in the river, so the check is not vacuous', () => {
    const bad = [...referenceTown(1), place(plotsOf(0, 0)[0]!, 'house', 2, 2, null)]
    expect(townErrors(bad, streetTiles(1, RIVER_GROUND)).length).toBeGreaterThan(0)
  })
})

// The reference's own genesis and grown towns, rebuilt here from the exported grammar so the
// numbers above are measured on the same buildings the Python measured.
const REFERENCE_GENESIS: ReadonlyArray<[string, number, number, string | null]> = [
  ['storehouse', 2, 2, null],
  ['house', 2, 2, 'amara'],
  ['house', 2, 2, 'yusuf'],
  ['cottage', 3, 2, null],
  ['house', 2, 2, 'nadia'],
  ['cabin', 2, 2, null],
  ['house', 2, 2, 'omar'],
  ['house', 2, 2, 'salma'],
  ['farmhouse', 4, 2, null],
]
const REFERENCE_LATER: ReadonlyArray<[string, number, number]> = [
  ['house', 2, 2],
  ['cabin', 2, 2],
  ['cottage', 3, 2],
  ['storehouse', 2, 2],
  ['workshop', 2, 2],
  ['house', 2, 2],
  ['barn', 4, 2],
  ['house', 2, 2],
]

function referenceTown(rings: number, extra = 0) {
  const ps = freePlots(rings, RIVER_GROUND)
  const out = REFERENCE_GENESIS.map(([kind, along, deep, owner], n) =>
    place(ps[n]!, kind, along, deep, owner),
  )
  for (let k = 0; k < extra; k++) {
    const p = ps[REFERENCE_GENESIS.length + k]
    if (p === undefined) break
    const [kind, along, deep] = REFERENCE_LATER[k % REFERENCE_LATER.length]!
    out.push(place(p, kind, along, deep, null))
  }
  return out
}
