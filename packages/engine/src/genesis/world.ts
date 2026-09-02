import {
  CITY_ANCHOR_DEFAULT,
  FOUNDER_IDS,
  FOUNDER_SEATS,
  expandItemKinds,
  isRoofedKind,
  makeCityTemplate,
  type CityStructure,
  type SimConfig,
} from '@sj/shared'
import { genesisTerrainAt } from '../geography.js'
import { FAUNA_YIELD, GENESIS_FAUNA } from '../data/faunaDefs.js'
import { FORAGEABLE_YIELD, GENESIS_FORAGEABLES } from '../data/forageables.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { spoilageFor } from '../systems/spoilage.js'
import { SEED_RECIPES, buildableRecipe, buildTicks, type PendingEvent } from '../verbs/index.js'

// The world on the morning of day one, authored from (x, y) arithmetic alone. NO RNG anywhere:
// two calls with the same config are deep-equal, which is what lets replay start here. The
// valley's own shape is `geography.js`, which the walk verb reads as well.

// Structures the world places and nobody built. The template is the single source of every
// footprint; `structures.recipes` is the single source for the kinds that can also be built.
export const GENESIS_BUILDER_ID = 'genesis'
export type Durability = { maxHp: number; flammable: boolean }
// shed must never get a structures.recipes row: it is in the frozen scripted world and an
// INTERIOR_KIND, but inputs would mint a 1x1 store and roofed:true would promise shelter it lacks.
const GENESIS_STRUCTURE_DEFS: Readonly<Record<string, Durability>> = {
  shed: { maxHp: 20, flammable: true },
  wagon: { maxHp: 15, flammable: true },
}

/** What a genesis-placed structure is made of: a buildable kind takes its recipe, a placed-only
 *  kind takes the table above. `null` means nothing in the world knows how tough a `kind` is. */
export function genesisDurability(config: SimConfig, kind: string): Durability | null {
  const recipe = config.structures.recipes[kind]
  if (recipe !== undefined) return { maxHp: recipe.maxHp, flammable: recipe.flammable }
  return GENESIS_STRUCTURE_DEFS[kind] ?? null
}

function makeTerrain(config: SimConfig, anchor: { x: number; y: number }): TileId[][] {
  const { w, h } = config.world.size
  const terrain = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => genesisTerrainAt(x, y)),
  )
  // The template is part of the ground, not a change to it: no tile_changed at genesis.
  for (const t of makeCityTemplate(anchor).tiles) {
    const row = terrain[anchor.y + t.dy]
    if (row !== undefined && anchor.x + t.dx < w) row[anchor.x + t.dx] = t.to as TileId
  }
  return terrain
}

export type GenesisWorld = { terrain: TileId[][]; events: PendingEvent[] }

// Forced, not chosen: roofFell throws on a roofed kind that is unbuildable and not sound, and
// those are exactly these two. Holds shelterLedger().per at 0.8 — 4 slots against 5 bodies.
export const GENESIS_SOUND_ROOFS: ReadonlySet<string> = new Set(['storehouse', 'cabin'])

/** Three quarters. A farmhouse leaves 1 440 ticks of roof to raise — one night for two pairs
 *  of hands, and the village's first shared project. */
export const GENESIS_ROOF_STOOD = 3 / 4

/** The one roof the village left unfinished: the farmhouse nobody is seated under. Every
 *  founder wakes under a whole one — the elder and the two singles in the cottage too — and a
 *  house nobody has to finish is a day spent on each other instead of on the weather. */
export const GENESIS_UNFINISHED_ROOFS: ReadonlySet<string> = new Set(['farmhouse'])

/** Did this kind's roof come down while the village stood empty? Only roofed kinds have a roof
 *  to lose, and only buildable ones may lose it — see the note above. */
export function roofFell(config: SimConfig, kind: string): boolean {
  if (!isRoofedKind(config, kind) || GENESIS_SOUND_ROOFS.has(kind)) return false
  if (buildableRecipe(config, kind) === null) {
    throw new Error(`genesis: a ${kind} would stand roofless and nobody could finish it`)
  }
  return GENESIS_UNFINISHED_ROOFS.has(kind)
}

// Six things a founder wakes up owning. The bread is six sim-days of food and is stamped
// like any other loaf, so the storehouse multiplier and the spoilage clock apply from tick 0.
const FOUNDER_KIT: readonly { kind: string; qty: number }[] = [
  { kind: 'axe', qty: 1 },
  { kind: 'hoe', qty: 1 },
  { kind: 'knife', qty: 1 },
  { kind: 'seed_pouch', qty: 1 },
  { kind: 'waterskin', qty: 1 },
  { kind: 'bread', qty: 6 },
]

// `wood`, not "timber": these are the kinds the build and craft recipes actually consume. The
// twenty loaves are the surplus D1 asks for: weeks of meals, so a day is free for other things.
const STOREHOUSE_STOCK: readonly { kind: string; qty: number }[] = [
  { kind: 'wood', qty: 60 },
  { kind: 'stone', qty: 24 },
  { kind: 'rope', qty: 8 },
  { kind: 'cloth', qty: 8 },
  { kind: 'bread', qty: 20 },
  { kind: 'fish', qty: 10 },
  { kind: 'seed_pouch', qty: 3 },
]

/** The item kinds this world puts in a hand that no config row names: the kit, the stock, what
 *  the ground and the animals yield, and both sides of the recipes that live in code. The art
 *  gates add it to `configItemKinds`, so a kind nobody drew is a red test and not a checkerboard. */
export function seededItemKinds(): string[] {
  const kinds: string[] = []
  for (const i of [...FOUNDER_KIT, ...STOREHOUSE_STOCK]) kinds.push(i.kind)
  kinds.push(...Object.values(FORAGEABLE_YIELD))
  for (const drops of Object.values(FAUNA_YIELD)) for (const d of drops) kinds.push(d.kind)
  for (const r of Object.values(SEED_RECIPES)) kinds.push(...Object.keys(r.inputs), r.output.kind)
  return expandItemKinds(kinds)
}

function plannedPayload(
  config: SimConfig,
  s: CityStructure,
  id: string,
  anchor: { x: number; y: number },
): Record<string, unknown> {
  const durability = genesisDurability(config, s.kind)
  if (durability === null) throw new Error(`genesis: no durability known for a ${s.kind}`)
  return {
    id,
    kind: s.kind,
    x: anchor.x + s.dx,
    y: anchor.y + s.dy,
    w: s.w,
    h: s.h,
    maxHp: durability.maxHp,
    flammable: durability.flammable,
    builderId: GENESIS_BUILDER_ID,
    // Absent, never null: an unowned building is the hash-stable shape.
    ...(s.owner === null ? {} : { owner: s.owner }),
    ...(s.name === undefined ? {} : { name: s.name }),
  }
}

/** They founded this village, so they know where its roofs are without walking past them.
 *  Emit AFTER the founders are spawned: `places_seen` folds onto an agent that has to exist. */
export function foundersKnowTheVillage(
  founderIds: readonly string[],
  structureIds: readonly string[],
): PendingEvent[] {
  if (structureIds.length === 0) return []
  return founderIds.map((agentId) => ({ type: 'places_seen', payload: { agentId, structureIds } }))
}

export function makeGenesisWorld(
  config: SimConfig,
  opts: { anchor?: { x: number; y: number } } = {},
): GenesisWorld {
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
    // structure_progressed is the same event a builder's own hands emit, so finishing one costs
    // labour and nothing else — resuming a site never spends materials a second time.
    const stood = Math.floor(buildTicks(config, s.kind) * GENESIS_ROOF_STOOD)
    if (stood > 0) events.push({ type: 'structure_progressed', payload: { id, ticks: stood } })
  })

  // The roof is READ off the template by the name its seat carries, never retyped here.
  const roofIdByName = new Map<string, string>()
  template.structures.forEach((s, i) => {
    if (s.name !== undefined) roofIdByName.set(s.name, structureIdByIndex[i]!)
  })
  const storehouseIndex = template.structures.findIndex((s) => s.kind === 'storehouse')
  if (storehouseIndex < 0) throw new Error('genesis: the city template has no storehouse to stock')

  const spawnItem = (kind: string, qty: number, structureId: string, owner?: string): void => {
    events.push({
      type: 'item_spawned',
      payload: {
        id: mint('item'),
        kind,
        qty,
        loc: { t: 'structure', id: structureId },
        ...(owner === undefined ? {} : { owner }),
        ...spoilageFor(at0, kind, config),
      },
    })
  }

  for (const founder of FOUNDER_IDS) {
    const roofId = roofIdByName.get(FOUNDER_SEATS[founder])
    if (roofId === undefined) throw new Error(`genesis: no roof for founder ${founder}`)
    for (const item of FOUNDER_KIT) spawnItem(item.kind, item.qty, roofId, founder)
  }
  for (const item of STOREHOUSE_STOCK)
    spawnItem(item.kind, item.qty, structureIdByIndex[storehouseIndex]!)

  // The herd, the warren and the schools are already here on the morning of day one — the
  // ones east of the water among them, which nobody can reach until somebody builds a bridge.
  for (const f of GENESIS_FAUNA) {
    events.push({
      type: 'fauna_spawned',
      payload: {
        id: mint('fauna'),
        kind: f.kind,
        x: f.x,
        y: f.y,
        ...(f.stock === undefined ? {} : { stock: f.stock }),
      },
    })
  }

  // Berries by the meadow, mushrooms — safe and pale together — at the forest edge, herbs by
  // the river, clay at the bank, stone at the hill. Which mushroom kills is not written here.
  for (const n of GENESIS_FORAGEABLES) {
    events.push({
      type: 'forageable_spawned',
      // The authored abundance rides the spawn, so the ground knows what to climb back to.
      payload: {
        id: mint('node'),
        kind: n.kind,
        x: n.x,
        y: n.y,
        stock: n.stock,
        fullStock: n.stock,
      },
    })
  }

  return { terrain, events }
}
