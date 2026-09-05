import { describe, expect, it, vi } from 'vitest'
import {
  blockGroundOf,
  claimTownPlot,
  grammarOf,
  plotExtent,
  plotIsTaken,
  reachOnFoot,
  ringsStanding,
  townBoxOf,
  walkOnGround,
  worldOf,
  type Walk,
  type WorldRect,
} from './townPlot.js'
import {
  CITY_GROUND,
  DWELLING_FOOTPRINTS,
  GENESIS_WANTED,
  TOWN_RINGS_GENESIS,
  TOWN_SQUARE,
  cityPlacements,
  townOrigin,
  townSpan,
} from './cityTemplate.js'
import {
  BLOCK,
  MIN_SEP,
  PITCH,
  STREET,
  blockIsPlattable,
  centreOf,
  doorFrontOf,
  freePlots,
  place,
  placedTiles,
  plattedBlocks,
  plotsOf,
  streetTiles,
} from './townGrammar.js'

const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`

/** The genesis nine, as the world holds them: grammar rectangles shifted onto the square. */
function genesisStanding(): WorldRect[] {
  return cityPlacements().map((s) => ({
    ...worldOf(TOWN_SQUARE, { dx: s.dx, dy: s.dy }),
    w: s.w,
    h: s.h,
  }))
}

/** Raise `n` buildings of one mass through the claim, exactly as the engine does: each claim
 *  sees everything the ones before it put up, and nothing else. */
function raise(n: number, need = { along: 2, deep: 2 }, standing: WorldRect[] = genesisStanding()) {
  const built: {
    site: WorldRect
    door: { x: number; y: number }
    rings: number
    facing: string
  }[] = []
  for (let i = 0; i < n; i++) {
    const c = claimTownPlot({ square: TOWN_SQUARE, standing, need })
    if (c === null) break
    standing = [...standing, c.site]
    built.push({ site: c.site, door: c.door, rings: c.rings, facing: c.facing })
  }
  return { built, standing }
}

describe('the town, seen from the world', () => {
  it('grammar (0,0) is the square, and the genesis nine land where the grammar put them', () => {
    expect(worldOf(TOWN_SQUARE, { dx: 0, dy: 0 })).toEqual({ x: TOWN_SQUARE.x, y: TOWN_SQUARE.y })
    expect(grammarOf(TOWN_SQUARE, TOWN_SQUARE)).toEqual({ dx: 0, dy: 0 })
    // Round-trip on a tile that is nobody's origin, so an identity that only holds at (0,0)
    // cannot pass this.
    expect(worldOf(TOWN_SQUARE, grammarOf(TOWN_SQUARE, { x: 91, y: 40 }))).toEqual({ x: 91, y: 40 })
  })

  it('a plot the grammar has built on is taken, and one it has not is free', () => {
    const taken = plotIsTaken(TOWN_SQUARE, genesisStanding())
    const ring1 = freePlots(TOWN_RINGS_GENESIS, CITY_GROUND)
    expect(ring1).toHaveLength(20)
    expect(ring1.filter(taken)).toHaveLength(GENESIS_WANTED.length)
    expect(ring1.filter((p) => !taken(p))).toHaveLength(20 - GENESIS_WANTED.length)
  })

  it('the taken plots are exactly the nine the grammar claimed, slot for slot', () => {
    const taken = plotIsTaken(TOWN_SQUARE, genesisStanding())
    const byRect = freePlots(TOWN_RINGS_GENESIS, CITY_GROUND)
      .filter(taken)
      .map((p) => `${p.block.i},${p.block.j}/${p.slot}`)
      .sort()
    const byClaim = cityPlacements()
      .map((s) => `${s.block.i},${s.block.j}/${s.slot}`)
      .sort()
    expect(byRect).toEqual(byClaim)
  })

  it('★ a plot extent contains every building that plot can ever hold', () => {
    let checked = 0
    for (const p of freePlots(2, CITY_GROUND)) {
      const e = plotExtent(p)
      for (let along = 1; along <= p.maxAlong; along++)
        for (let deep = 1; deep <= p.maxDeep; deep++) {
          const s = place(p, 'x', along, deep, null)
          for (const t of placedTiles(s)) {
            expect(
              t.dx >= e.dx && t.dx < e.dx + e.w && t.dy >= e.dy && t.dy < e.dy + e.h,
              `${p.block.i},${p.block.j}/${p.slot} ${along}x${deep} at ${t.dx},${t.dy}`,
            ).toBe(true)
            checked++
          }
        }
    }
    // Non-vacuity: 76 plots at ring 2, eight legal masses each, 12 tiles per plot's worth.
    expect(checked).toBe(76 * (1 * 1 + 1 * 2 + 2 * 1 + 2 * 2 + 3 * 1 + 3 * 2 + 4 * 1 + 4 * 2))
  })
})

describe('★ a build takes a plot, and the plot is never the asker s', () => {
  it('ring 1 holds nine more, and the tenth crosses into ring 2', () => {
    const { built } = raise(12)
    expect(built).toHaveLength(12)
    expect(built.slice(0, 9).map((b) => b.rings)).toEqual(Array(9).fill(1))
    expect(built[9]!.rings).toBe(2)
  })

  it('every building any sequence of claims can raise keeps the grammar s floor', () => {
    const { built } = raise(60, { along: 2, deep: 2 })
    expect(built).toHaveLength(60)
    const all = [...genesisStanding(), ...built.map((b) => b.site)]
    // No two share a tile.
    const seen = new Set<string>()
    for (const s of all)
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          expect(seen.has(`${x},${y}`), `two buildings on ${x},${y}`).toBe(false)
          seen.add(`${x},${y}`)
        }
    // And no two centres come closer than the floor the grammar proved.
    const centre = (s: WorldRect) => centreOf({ dx: s.x, dy: s.y, w: s.w, h: s.h })
    let closest = Infinity
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const p = centre(all[i]!),
          q = centre(all[j]!)
        closest = Math.min(closest, Math.hypot(p.sx - q.sx, p.sy - q.sy))
      }
    expect(closest).toBeGreaterThanOrEqual(MIN_SEP)
  })

  it('every door the claim hands out opens onto a street of the town', () => {
    const { built } = raise(60)
    const rings = Math.max(...built.map((b) => b.rings))
    const roads = new Set(streetTiles(rings, CITY_GROUND).map((t) => key(worldOf(TOWN_SQUARE, t))))
    for (const b of built) expect(roads.has(key(b.door)), `door ${key(b.door)}`).toBe(true)
  })

  it('no building the claim hands out ever stands in the channel', () => {
    const { built } = raise(60)
    for (const b of built)
      for (let y = b.site.y; y < b.site.y + b.site.h; y++)
        for (let x = b.site.x; x < b.site.x + b.site.w; x++) {
          const g = grammarOf(TOWN_SQUARE, { x, y })
          expect(CITY_GROUND(g.dx, g.dy), `${x},${y}`).toBe('dry')
        }
  })

  it('is pure: two identical worlds claim the same plot, and no die is rolled', () => {
    const spy = vi.spyOn(Math, 'random')
    const a = raise(25)
    const b = raise(25)
    expect(a.built).toEqual(b.built)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuses, loudly and with null, a mass no plot in the town can hold', () => {
    expect(
      claimTownPlot({ square: TOWN_SQUARE, standing: [], need: { along: 5, deep: 1 } }),
    ).toBeNull()
    expect(
      claimTownPlot({ square: TOWN_SQUARE, standing: [], need: { along: 1, deep: 3 } }),
    ).toBeNull()
    expect(
      claimTownPlot({ square: TOWN_SQUARE, standing: [], need: { along: 0, deep: 1 } }),
    ).toBeNull()
    expect(
      claimTownPlot({ square: TOWN_SQUARE, standing: [], need: { along: 4, deep: 2 } }),
    ).not.toBeNull()
  })

  it('a thing standing across a plot takes it, even though the grammar never platted it', () => {
    const free = claimTownPlot({
      square: TOWN_SQUARE,
      standing: genesisStanding(),
      need: { along: 2, deep: 2 },
    })!
    const blocked = claimTownPlot({
      square: TOWN_SQUARE,
      standing: [...genesisStanding(), { x: free.site.x, y: free.site.y, w: 1, h: 1 }],
      need: { along: 2, deep: 2 },
    })!
    expect(blocked.site).not.toEqual(free.site)
  })
})

describe('how many rings are standing', () => {
  it('the genesis town stands at one ring', () => {
    expect(ringsStanding(TOWN_SQUARE, genesisStanding())).toBe(TOWN_RINGS_GENESIS)
  })

  it('rises to two the moment a building stands on a ring-2 plot, and not before', () => {
    const { built, standing } = raise(9)
    expect(ringsStanding(TOWN_SQUARE, standing)).toBe(1)
    expect(built[8]!.rings).toBe(1)
    const two = raise(10).standing
    expect(ringsStanding(TOWN_SQUARE, two)).toBe(2)
  })

  it('a bridge at the ford makes no ring — its block stands in the river', () => {
    // GENESIS_FORD is world x 50, y 50..53; the grammar puts that in block (-1, -2), which
    // `blockIsPlattable` refuses because the channel runs through it.
    const ford: WorldRect = { x: 50, y: 50, w: 1, h: 2 }
    expect(ringsStanding(TOWN_SQUARE, [...genesisStanding(), ford])).toBe(1)
    const g = grammarOf(TOWN_SQUARE, { x: ford.x, y: ford.y })
    expect([Math.floor(g.dx / PITCH), Math.floor(g.dy / PITCH)]).toEqual([-1, -2])
  })

  // The test above is vacuous alone: the real ford lands on no plot of its block, so the plot
  // test excludes it by itself. This is the case that needs the rule.
  it('★ nor does one standing exactly where an unplattable block s plot would be', () => {
    const deck: WorldRect = { x: 49, y: 54, w: 2, h: 1 }
    const g = grammarOf(TOWN_SQUARE, deck)
    expect([Math.floor(g.dx / PITCH), Math.floor(g.dy / PITCH)]).toEqual([-1, -2])
    expect(blockIsPlattable(-1, -2, CITY_GROUND)).toBe(false)
    // It really does sit on the plot — so only the plattable test can be what refuses it.
    expect(
      plotsOf(-1, -2).some((p) => {
        const e = plotExtent(p)
        return (
          e.dx < g.dx + deck.w && g.dx < e.dx + e.w && e.dy < g.dy + deck.h && g.dy < e.dy + e.h
        )
      }),
    ).toBe(true)
    expect(ringsStanding(TOWN_SQUARE, [...genesisStanding(), deck])).toBe(1)
  })
})

describe('★ the ground the town has laid, not the box of its roofs', () => {
  it('the town box is the whole extent, streets included, at every ring', () => {
    for (const rings of [1, 2, 3, 5]) {
      const box = townBoxOf(TOWN_SQUARE, rings)
      expect(box.dx1 - box.dx0 + 1).toBe(townSpan(rings))
      expect(box.dy1 - box.dy0 + 1).toBe(townSpan(rings))
      expect(box.dx0).toBe(TOWN_SQUARE.x - townOrigin(rings))
    }
  })

  it('★ it reaches PITCH + STREET past the last roof — the three tiles the built set misses', () => {
    const standing = genesisStanding()
    const lastRoof = Math.max(...standing.map((s) => s.y + s.h - 1))
    const ring2 = townBoxOf(TOWN_SQUARE, 2)
    expect(lastRoof).toBe(112)
    expect(ring2.dy1).toBe(134)
    expect(ring2.dy1 - lastRoof).toBe(PITCH + STREET)
    // And the ring-1 box already clears the last roof by STREET, which is where the deficit
    // comes from: a world that owes a pitch past the roofs owes three tiles too few.
    expect(townBoxOf(TOWN_SQUARE, 1).dy1 - lastRoof).toBe(STREET)
  })
})

describe('a block is laid out when its first building is raised', () => {
  const block = { i: -2, j: 0 }

  it('clears the block and paves its street ring, in world tiles', () => {
    const { cleared, paved } = blockGroundOf(TOWN_SQUARE, block)
    expect(cleared).toHaveLength(BLOCK * BLOCK)
    const c = new Set(cleared.map(key))
    const p = new Set(paved.map(key))
    // Disjoint: a street is never a block tile.
    for (const k of p) expect(c.has(k), k).toBe(false)
    // The ring is three deep on all four sides, minus nothing here (this block is dry).
    expect(p.size).toBe((BLOCK + 2 * STREET) ** 2 - BLOCK * BLOCK)
  })

  it('★ every door of every legal building on the block lands on the paving it lays', () => {
    let checked = 0
    for (const b of [block, { i: 1, j: 1 }, { i: 2, j: -2 }]) {
      const paved = new Set(blockGroundOf(TOWN_SQUARE, b).paved.map(key))
      for (const plot of plotsOf(b.i, b.j))
        for (let along = 1; along <= plot.maxAlong; along++)
          for (let deep = 1; deep <= plot.maxDeep; deep++) {
            const door = worldOf(TOWN_SQUARE, doorFrontOf(place(plot, 'x', along, deep, null)))
            expect(
              paved.has(key(door)),
              `${b.i},${b.j}/${plot.slot} ${along}x${deep} door ${key(door)}`,
            ).toBe(true)
            checked++
          }
    }
    expect(checked).toBe(3 * 4 * 8)
  })

  it('never paves the channel', () => {
    for (const b of [
      { i: -1, j: 0 },
      { i: 0, j: -1 },
      { i: -2, j: -2 },
    ]) {
      for (const t of blockGroundOf(TOWN_SQUARE, b).paved) {
        const g = grammarOf(TOWN_SQUARE, t)
        expect(CITY_GROUND(g.dx, g.dy), key(t)).not.toBe('water')
      }
    }
  })

  it('a new block s streets meet the ones already there', () => {
    const near = new Set(blockGroundOf(TOWN_SQUARE, { i: -1, j: 0 }).paved.map(key))
    const far = blockGroundOf(TOWN_SQUARE, { i: -2, j: 0 }).paved.map(key)
    expect(far.some((k) => near.has(k))).toBe(true)
  })
})

describe('the masses the town actually builds', () => {
  it('every dwelling footprint the template knows fits a plot', () => {
    for (const [kind, m] of Object.entries(DWELLING_FOOTPRINTS)) {
      const c = claimTownPlot({
        square: TOWN_SQUARE,
        standing: genesisStanding(),
        need: { along: m.w, deep: m.h },
      })
      expect(c, kind).not.toBeNull()
      expect(c!.site.w * c!.site.h, kind).toBe(m.w * m.h)
    }
  })
})

// The first plot ring 2 offers is block (-2,0), across the channel. The channel the grammar knows
// is three columns wide at every dy — a wall, not an obstacle — measured by the first test here.
const CHANNEL = [-17, -16, -15] as const

/** A walk with a deck laid over the named grammar tiles. A deck over water is not water; a
 *  deck anywhere else is a plank on the grass and changes nothing. */
const deck = (base: Walk, tiles: readonly { dx: number; dy: number }[]): Walk => {
  const on = new Set(tiles.map((t) => `${t.dx},${t.dy}`))
  return (dx, dy) => base(dx, dy) || on.has(`${dx},${dy}`)
}

const span = (dy: number, cols: readonly number[] = CHANNEL): { dx: number; dy: number }[] =>
  cols.map((dx) => ({ dx, dy }))

/** The blocks the claim will actually offer, in order, for a 2x2 — read off the claim itself, so
 *  a test cannot pass on a rule the running world does not use. */
const offered = (walk: Walk, n = 40, standing = genesisStanding()): string[] =>
  raiseWith(walk, n, standing).built.map((b) => {
    const g = grammarOf(TOWN_SQUARE, b.site)
    return `${Math.floor(g.dx / PITCH)},${Math.floor(g.dy / PITCH)}`
  })

function raiseWith(
  walk: Walk,
  n: number,
  standing: WorldRect[] = genesisStanding(),
  need = { along: 2, deep: 2 },
) {
  const built: { site: WorldRect; door: { x: number; y: number }; rings: number }[] = []
  for (let i = 0; i < n; i++) {
    const c = claimTownPlot({ square: TOWN_SQUARE, standing, need, walk })
    if (c === null) break
    standing = [...standing, c.site]
    built.push({ site: c.site, door: c.door, rings: c.rings })
  }
  return { built, standing }
}

describe('★ a plot you cannot walk to is not ground the town keeps for you', () => {
  const dry = walkOnGround(CITY_GROUND)

  it('the channel is a WALL, not an obstacle: there is no way round it inside the town', () => {
    // If any row of the town's box were dry across the channel, the far bank would already be
    // reachable and every test below would pass with the bridge doing nothing.
    const lo = -townOrigin(2),
      hi = lo + townSpan(2) - 1
    for (let dy = lo; dy <= hi; dy++)
      for (const dx of CHANNEL) expect(CITY_GROUND(dx, dy), `${dx},${dy}`).toBe('water')
    const reached = reachOnFoot(2, dry)
    expect(reached.has(-18, 0)).toBe(false)
    // And it is not that nothing is reached: the east of the town plainly is.
    expect(reached.size).toBeGreaterThan(2000)
  })

  it('the west of the river is platted, and the claim never offers it', () => {
    const platted = plattedBlocks(2, CITY_GROUND).map((b) => `${b.i},${b.j}`)
    const west = platted.filter((k) => Number(k.split(',')[0]) <= -2)
    expect(west).toHaveLength(5)
    // From an EMPTY town, so a block the genesis nine happen to have filled still shows up.
    const blocks = new Set(offered(dry, 80, []))
    for (const k of west) expect(blocks.has(k), k).toBe(false)
    for (const k of platted) if (!west.includes(k)) expect(blocks.has(k), k).toBe(true)
    // Non-vacuity: the grammar on its own WOULD have offered a west plot first at ring 2.
    expect(freePlots(2, CITY_GROUND).find((p) => p.block.i <= -2)!.block).toEqual({ i: -2, j: 0 })
  })

  it('so the twelfth building lands east of the water', () => {
    const { built } = raise(12)
    const twelfth = built[11]!
    expect(twelfth.rings).toBe(2)
    expect(grammarOf(TOWN_SQUARE, twelfth.site).dx).toBeGreaterThan(0)
    expect(built.every((b) => grammarOf(TOWN_SQUARE, b.site).dx > -19)).toBe(true)
  })

  // ★ THE RULING: A BRIDGE OPENS THE FAR BANK. The river stops being a wall and becomes a
  // problem the town can solve — which is the thing this world exists to watch.
  it('★ a deck across the channel opens the far bank, and it is the FIRST plot ring 2 offers', () => {
    const crossing = deck(dry, span(-3))
    const blocks = offered(crossing, 80)
    expect(blocks.slice(0, 9).every((k) => Number(k.split(',')[0]) > -2)).toBe(true)
    expect(blocks[9]).toBe('-2,0')
    // Every one of the five west blocks joins the town, not just the one the deck touches —
    // and the deck stands beside block (-1,-1), none of them.
    for (const k of ['-2,0', '-2,-1', '-2,1', '-2,-2', '-2,2']) expect(blocks, k).toContain(k)
  })

  it('★ and it is a CROSSING, not a teleport: a deck that stops short of the far bank opens nothing', () => {
    // Two of the three columns, laid from the near bank out. Feet reach the middle of the
    // river and stop there, which is what a deck one plank short of the far side is.
    const short = deck(dry, span(-3, [-15, -16]))
    expect(offered(short, 80).some((k) => Number(k.split(',')[0]) <= -2)).toBe(false)
    expect(reachOnFoot(2, short).has(-16, -3)).toBe(true)
    expect(reachOnFoot(2, short).has(-17, -3)).toBe(false)
    // A deck laid on dry ground is a plank in a meadow.
    expect(
      offered(deck(dry, span(-3, [10, 11, 12])), 80).some((k) => Number(k.split(',')[0]) <= -2),
    ).toBe(false)
  })

  it('★ and reachability is DERIVED: take the deck away and the far bank closes again', () => {
    const crossing = deck(dry, span(-3))
    expect(offered(crossing)).toContain('-2,0')
    expect(offered(dry)).not.toContain('-2,0')
    // Same call, same inputs but for the deck — nothing anywhere remembers that it was open.
    expect(reachOnFoot(2, crossing).has(-18, -3)).toBe(true)
    expect(reachOnFoot(2, dry).has(-18, -3)).toBe(false)
  })

  it('★ every plot the claim offers has a DOOR a body can stand on, over the water or not', () => {
    const crossing = deck(dry, span(-3))
    const reached = reachOnFoot(3, crossing)
    const { built } = raiseWith(crossing, 40)
    expect(built.length).toBeGreaterThanOrEqual(30)
    for (const b of built) {
      const g = grammarOf(TOWN_SQUARE, b.door)
      expect(reached.has(g.dx, g.dy), `door ${b.door.x},${b.door.y}`).toBe(true)
    }
    // …and at least eight of them are on the far side, so the loop above is not all east bank.
    expect(
      built.filter((b) => grammarOf(TOWN_SQUARE, b.site).dx < -17).length,
    ).toBeGreaterThanOrEqual(8)
  })
})
