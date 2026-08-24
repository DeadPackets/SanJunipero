import {
  CITY_ANCHOR_DEFAULT, FOUNDER_IDS, isRoofedKind, makeCityTemplate,
  type CityStructure, type SimConfig,
} from '@sj/shared'
import { GENESIS_FAUNA } from '../data/faunaDefs.js'
import { GENESIS_FORAGEABLES } from '../data/forageables.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { spoilageFor } from '../systems/spoilage.js'
import { buildableRecipe, buildTicks, type PendingEvent } from '../verbs.js'

// The world on the morning of day one: ground authored from (x, y) arithmetic alone, then the
// city template baked in, then the ordered events that plant the town. NO RNG anywhere here —
// a genesis roll would need somewhere to be recorded, and `world_grown` is where that pattern
// belongs. Two calls with the same config are deep-equal, which is what lets replay start here.

const T_GRASS: TileId = 0, T_EARTH: TileId = 1, T_WATER: TileId = 2
const T_FOREST: TileId = 3, T_ROCK: TileId = 4, T_SAND: TileId = 5

// A straight main channel, because the city template lays its own bank and riverfront path
// against x 48..50 — a meander here would leave the bank hanging over open water.
export const GENESIS_RIVER_X = 49
export const GENESIS_FORK_Y = 20
export const GENESIS_LAKE = { x: 86, y: 20, rx: 9, ry: 6 } as const
export const GENESIS_HILL = { x: 22, y: 104, rx: 9, ry: 7 } as const
export const GENESIS_FOREST_X = 92

// The ford. One reach, four rows, a little north of where the town wakes up: a spit of sand
// reaches out from the near bank and the channel runs two tiles instead of three. It is the
// only place a six-plank deck can span, so the paths will converge on it and the bridge will
// go where feet already go — which is better world than a wider recipe would have been.
export const GENESIS_FORD = { x: GENESIS_RIVER_X + 1, y0: 50, y1: 53 } as const

const inFord = (x: number, y: number): boolean =>
  x === GENESIS_FORD.x && y >= GENESIS_FORD.y0 && y <= GENESIS_FORD.y1

// Structures the world places and nobody built. The template is the single source of every
// footprint; `structures.recipes` is the single source for the kinds that can also be built.
export const GENESIS_BUILDER_ID = 'genesis'
export type Durability = { maxHp: number; flammable: boolean }
// The storehouse and the three dwellings came OFF this table when `roofed` landed: they need a
// `structures.recipes` row to say they have a roof, and a row already carries hp and flammable,
// so keeping them here would have been the same two numbers written twice (G4).
const GENESIS_STRUCTURE_DEFS: Readonly<Record<string, Durability>> = {
  shed: { maxHp: 20, flammable: true },
  wagon: { maxHp: 15, flammable: true },
  fire_pit: { maxHp: 10, flammable: false },
}

/** What a genesis-placed structure is made of: a buildable kind takes its recipe, a placed-only
 *  kind takes the table above. `null` means nothing in the world knows how tough a `kind` is. */
export function genesisDurability(config: SimConfig, kind: string): Durability | null {
  const recipe = config.structures.recipes[kind]
  if (recipe !== undefined) return { maxHp: recipe.maxHp, flammable: recipe.flammable }
  return GENESIS_STRUCTURE_DEFS[kind] ?? null
}

// Integer ellipse test, so nothing here depends on floating-point rounding.
function inEllipse(x: number, y: number, e: { x: number; y: number; rx: number; ry: number }, grow = 0): boolean {
  const rx = e.rx + grow, ry = e.ry + grow
  const dx = x - e.x, dy = y - e.y
  return dx * dx * ry * ry + dy * dy * rx * rx <= rx * rx * ry * ry
}

// A ragged forest edge from a cheap deterministic wobble: no RNG, no stored noise field.
const forestEdgeAt = (y: number): number => GENESIS_FOREST_X + ((y * 7 + (y >> 3)) % 5) - 2

export function genesisTerrainAt(x: number, y: number): TileId {
  if (inEllipse(x, y, GENESIS_LAKE)) return T_WATER
  if (inEllipse(x, y, GENESIS_LAKE, 2)) return T_SAND
  // the branch that leaves the main river for the lake, and the pool where it leaves
  if (Math.abs(y - GENESIS_FORK_Y) <= 1 && x >= GENESIS_RIVER_X && x <= GENESIS_LAKE.x) return T_WATER
  if (Math.abs(y - GENESIS_FORK_Y) <= 3 && Math.abs(x - GENESIS_RIVER_X) <= 3) return T_WATER
  // The spit comes before the channel and after the fork: it narrows the main river and
  // never the pool the branch leaves from.
  if (inFord(x, y)) return T_SAND
  if (Math.abs(x - GENESIS_RIVER_X) <= 1) return T_WATER
  if (inEllipse(x, y, GENESIS_HILL)) return T_ROCK
  if (inEllipse(x, y, GENESIS_HILL, 2)) return T_EARTH
  if (x >= forestEdgeAt(y)) return T_FOREST
  return T_GRASS
}

function makeTerrain(config: SimConfig, anchor: { x: number; y: number }): TileId[][] {
  const { w, h } = config.world.size
  const terrain = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => genesisTerrainAt(x, y)))
  // The template is part of the ground, not a change to it: no tile_changed at genesis.
  for (const t of makeCityTemplate(anchor).tiles) {
    const row = terrain[anchor.y + t.dy]
    if (row !== undefined && anchor.x + t.dx < w) row[anchor.x + t.dx] = t.to as TileId
  }
  return terrain
}

export type GenesisWorld = { terrain: TileId[][]; events: PendingEvent[] }

// ★ THE ABANDONED VILLAGE IS ABANDONED, AND THAT IS WHY THE FOUNDING HAS A WANT IN IT.
//
// Canon: the five walked up a single track into a village of eight dwellings, a storehouse, a
// well and a fire pit that somebody else built and left. What canon never said is how long ago
// they left. Every dwelling stood sound, so the valley handed five founders 21 bodies' worth of
// floor before the first tick — 4.2 times what the cast could use — and the only want this
// project models was answered at tick zero. Every production figure ever reported from here was
// measured in that town.
//
// So the roofs are down on all but two. What stands is walls, three quarters of the way up, on
// buildings a pair of hands can finish in a night — which is the whole reason this shape was
// chosen over shrinking the village: the founders' answer to the cold is the village itself,
// half-mended, and every tick of work pays back the same night.
//
// ★ WHY THESE TWO AND NOT THREE. The bar is `shelterLedger(...).per < 1.0`. Sound storehouse and
// sound cabin is 4 slots against 5 bodies — 0.8 — and it is the LOWEST value reachable without
// standing up a wall nobody can finish. Every fallen kind must be one `build` accepts, and the
// only other 2-slot kinds are the cabin and the storehouse themselves, both 2x2: making either
// buildable would mint a second name for `house`. A one-body want is worth more than a building
// that looks like an answer and refuses in words a mind cannot use.
export const GENESIS_SOUND_ROOFS: ReadonlySet<string> = new Set(['storehouse', 'cabin'])

/** Three quarters. A house is 2 880 ticks, so 720 are left — one night for one pair of hands,
 *  six sim-hours for two. A cottage leaves 1 080 and a farmhouse 1 440. */
export const GENESIS_ROOF_STOOD = 3 / 4

/** Did this kind's roof come down while the village stood empty? Only roofed kinds have a roof
 *  to lose, and only buildable ones may lose it — see the note above. */
export function roofFell(config: SimConfig, kind: string): boolean {
  if (!isRoofedKind(config, kind) || GENESIS_SOUND_ROOFS.has(kind)) return false
  if (buildableRecipe(config, kind) === null) {
    throw new Error(`genesis: a ${kind} would stand roofless and nobody could finish it`)
  }
  return true
}

// Six things a founder wakes up owning. The bread is three sim-days of food and is stamped
// like any other loaf, so the storehouse multiplier and the spoilage clock apply from tick 0.
const FOUNDER_KIT: ReadonlyArray<{ kind: string; qty: number }> = [
  { kind: 'axe', qty: 1 }, { kind: 'hoe', qty: 1 }, { kind: 'knife', qty: 1 },
  { kind: 'seed_pouch', qty: 1 }, { kind: 'waterskin', qty: 1 }, { kind: 'bread', qty: 3 },
]

// `wood`, not "timber": these are the kinds the build and craft recipes actually consume.
const STOREHOUSE_STOCK: ReadonlyArray<{ kind: string; qty: number }> = [
  { kind: 'wood', qty: 20 }, { kind: 'stone', qty: 12 }, { kind: 'rope', qty: 4 }, { kind: 'cloth', qty: 4 },
]

function plannedPayload(
  config: SimConfig, s: CityStructure, id: string, anchor: { x: number; y: number },
): Record<string, unknown> {
  const durability = genesisDurability(config, s.kind)
  if (durability === null) throw new Error(`genesis: no durability known for a ${s.kind}`)
  return {
    id, kind: s.kind, x: anchor.x + s.dx, y: anchor.y + s.dy, w: s.w, h: s.h,
    maxHp: durability.maxHp,
    flammable: durability.flammable,
    builderId: GENESIS_BUILDER_ID,
    // Absent, never null: an unowned building is the hash-stable shape C9 landed.
    ...(s.owner === null ? {} : { owner: s.owner }),
  }
}

export function makeGenesisWorld(config: SimConfig, opts: { anchor?: { x: number; y: number } } = {}): GenesisWorld {
  const anchor = opts.anchor ?? CITY_ANCHOR_DEFAULT
  const terrain = makeTerrain(config, anchor)
  const template = makeCityTemplate(anchor)
  const events: PendingEvent[] = []

  // Only ever read for the spoilage day, which is 0 — but read through the one function that
  // knows how a kind spoils, so genesis food and foraged food are stamped by the same law.
  const at0: WorldState = genesisState(config, terrain)

  let nextId = 1
  const mint = (prefix: string) => `${prefix}_${nextId++}`
  const structureIdByIndex: string[] = []

  template.structures.forEach((s, i) => {
    const id = mint('structure')
    structureIdByIndex[i] = id
    events.push({ type: 'structure_planned', payload: plannedPayload(config, s, id, anchor) })
    if (!roofFell(config, s.kind)) {
      events.push({ type: 'structure_completed', payload: { id } })
      return
    }
    // Walls, and no roof on them. `structure_progressed` is the same event a builder's own
    // hands emit, so what a founder finds standing and what a founder leaves standing are the
    // same thing, and finishing one costs labour and NOTHING ELSE — resuming a site never
    // spends materials a second time.
    const stood = Math.floor(buildTicks(config, s.kind) * GENESIS_ROOF_STOOD)
    if (stood > 0) events.push({ type: 'structure_progressed', payload: { id, ticks: stood } })
  })

  // The kind is READ from the template, never retyped here (C8 global constraint C14).
  const houseIdByOwner = new Map<string, string>()
  template.structures.forEach((s, i) => {
    if (s.kind === 'house' && s.owner !== null) houseIdByOwner.set(s.owner, structureIdByIndex[i]!)
  })
  const storehouseIndex = template.structures.findIndex((s) => s.kind === 'storehouse')
  if (storehouseIndex < 0) throw new Error('genesis: the city template has no storehouse to stock')

  const spawnItem = (kind: string, qty: number, structureId: string, owner?: string): void => {
    events.push({
      type: 'item_spawned',
      payload: {
        id: mint('item'), kind, qty, loc: { t: 'structure', id: structureId },
        ...(owner === undefined ? {} : { owner }),
        ...spoilageFor(at0, kind, config),
      },
    })
  }

  for (const founder of FOUNDER_IDS) {
    const houseId = houseIdByOwner.get(founder)
    if (houseId === undefined) throw new Error(`genesis: no house for founder ${founder}`)
    for (const item of FOUNDER_KIT) spawnItem(item.kind, item.qty, houseId, founder)
  }
  for (const item of STOREHOUSE_STOCK) spawnItem(item.kind, item.qty, structureIdByIndex[storehouseIndex]!)

  // The herd, the warren and the schools are already here on the morning of day one — the
  // ones east of the water among them, which nobody can reach until somebody builds a bridge.
  for (const f of GENESIS_FAUNA) {
    events.push({
      type: 'fauna_spawned',
      payload: { id: mint('fauna'), kind: f.kind, x: f.x, y: f.y, ...(f.stock === undefined ? {} : { stock: f.stock }) },
    })
  }

  // Berries by the meadow, mushrooms — safe and pale together — at the forest edge, herbs by
  // the river, clay at the bank, stone at the hill. Which mushroom kills is not written here.
  for (const n of GENESIS_FORAGEABLES) {
    events.push({
      type: 'forageable_spawned',
      // The authored abundance rides the spawn, so the ground knows what to climb back to.
      payload: { id: mint('node'), kind: n.kind, x: n.x, y: n.y, stock: n.stock, fullStock: n.stock },
    })
  }

  return { terrain, events }
}
