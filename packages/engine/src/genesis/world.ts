import {
  CITY_ANCHOR_DEFAULT, FOUNDER_IDS, makeCityTemplate,
  type CityStructure, type SimConfig,
} from '@sj/shared'
import { GENESIS_FAUNA } from '../data/faunaDefs.js'
import { GENESIS_FORAGEABLES } from '../data/forageables.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { spoilageFor } from '../systems/spoilage.js'
import type { PendingEvent } from '../verbs.js'

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
const GENESIS_STRUCTURE_DEFS: Readonly<Record<string, Durability>> = {
  storehouse: { maxHp: 40, flammable: true },
  shed: { maxHp: 20, flammable: true },
  wagon: { maxHp: 15, flammable: true },
  fire_pit: { maxHp: 10, flammable: false },
  // The three dwellings the template places and nobody builds. `house` is absent on purpose:
  // it is buildable, so `genesisDurability` reads its 50 hp from `structures.recipes` instead.
  // More roof than a house, in proportion to the ground each stands on; all burn.
  cabin: { maxHp: 50, flammable: true },
  cottage: { maxHp: 60, flammable: true },
  farmhouse: { maxHp: 80, flammable: true },
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
    events.push({ type: 'structure_completed', payload: { id } })
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
