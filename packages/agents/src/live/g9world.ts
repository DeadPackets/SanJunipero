import { MINUTES_PER_DAY, type SimConfig } from '@sj/shared'
import type { TileId } from '@sj/engine'

// The G9b town as world content: its ground, its food loop, and the makings of a
// craft lying where hands can reach them. Everything here is a fact of the world —
// tiles, structures, crops, items. Nothing here is advice to a mind: what the town
// does with a clay bank and a nearly-spent axe is the town's business.
//
// This is the live gate's own fixture; the golden fixture is `@sj/engine`'s
// `scripted.ts` and shares nothing with it.

export const MAP_N = 32

export type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }

// A house apiece, in a row at y=10, each 2x2, each door the tile south of its
// centre. Five founders, five owned houses: run 4 refused 93 sleeps 82 times for
// want of a bed, and an exhaustion run is no fairer an emergence sample than a
// famine one.
export function house(n: number): Box {
  return { id: `structure_${n}`, kind: 'house', x: 2 + n * 4, y: 10, w: 2, h: 2 }
}
export const HOUSES: Box[] = [house(1), house(2), house(3), house(4), house(5)]

// The tile a body stands on to step through a door — the engine derives the same
// one from the footprint; `g9world.test.ts` holds the two together.
export function houseDoor(box: Box): { x: number; y: number } {
  return { x: box.x + Math.floor((box.w - 1) / 2), y: box.y + box.h }
}

export const STOREHOUSE: Box = { id: 'structure_6', kind: 'storehouse', x: 12, y: 15, w: 2, h: 2 }
export const HEARTH: Box = { id: 'structure_7', kind: 'campfire', x: 17, y: 15, w: 1, h: 1 }
// A fish trap standing in the creek. It is the town's one landmark *on* the water:
// perception names a structure and the open tile beside it, so the water's own
// coordinates arrive without anyone being told where the river is.
export const WEIR: Box = { id: 'structure_8', kind: 'weir', x: 18, y: 17, w: 1, h: 1 }

// A creek off the eastern river, two steps south of the hearth.
export const CREEK: Array<[number, number]> = [
  ...Array.from({ length: 13 }, (_, i): [number, number] => [16 + i, 17]),
  [16, 18], [17, 18],
]

// A stand of trees at the town's eastern edge — foraging range, not a forest march.
export const COPSE: Array<[number, number]> = [
  [25, 9], [25, 10], [25, 11], [25, 12], [26, 9], [26, 10], [26, 11], [26, 12],
]

// The field south of the houses. `plantedDaysAgo` backdates the sowing: the town has
// been farming, so the run opens on standing grain and the rest comes ripe during it.
// `null` is tilled ground left open — somewhere to put the next handful of seed.
export const PLOTS: Array<{ x: number; y: number; plantedDaysAgo: number | null }> = [
  { x: 9, y: 14, plantedDaysAgo: 8 },
  { x: 11, y: 14, plantedDaysAgo: 8 },
  { x: 13, y: 14, plantedDaysAgo: null },
  { x: 15, y: 14, plantedDaysAgo: 8 },
  { x: 17, y: 14, plantedDaysAgo: null },
  { x: 19, y: 14, plantedDaysAgo: 6 },
  { x: 21, y: 14, plantedDaysAgo: 5 },
]

export const CROP_KIND = 'wheat'

// Materials in the open, each within sight of a house and on ground a body can stand on.
export const MATERIAL_PILES: Array<{ kind: string; qty: number; x: number; y: number }> = [
  { kind: 'clay', qty: 12, x: 17, y: 16 },
  { kind: 'clay', qty: 8, x: 20, y: 16 },
  { kind: 'fiber', qty: 8, x: 12, y: 13 },
  { kind: 'fiber', qty: 6, x: 20, y: 13 },
  { kind: 'branch', qty: 10, x: 24, y: 11 },
  { kind: 'branch', qty: 6, x: 16, y: 13 },
  { kind: 'stone', qty: 8, x: 15, y: 13 },
  { kind: 'stone', qty: 6, x: 19, y: 16 },
]

// What every pair of hands starts with. The arbiter is told what the asker holds,
// so an empty inventory is a town that can attempt nothing.
export const CARRIED_MATERIALS: Array<{ kind: string; qty: number }> = [
  { kind: 'clay', qty: 2 },
  { kind: 'fiber', qty: 2 },
]

// The joiner's axe, two uses from firewood.
export const WORN_TOOL = { kind: 'worn axe', qty: 1, durability: 2, owner: 'bex' }

export const BREAD_PER_MIND = 2

export function makeTerrain(): TileId[][] {
  const map: TileId[][] = Array.from({ length: MAP_N }, (_, y) =>
    Array.from({ length: MAP_N }, (_, x): TileId => (x >= 29 ? 2 : y <= 2 ? 3 : 0)),
  )
  for (const [x, y] of CREEK) map[y]![x] = 2
  for (const [x, y] of COPSE) map[y]![x] = 3
  for (const p of PLOTS) map[p.y]![p.x] = 6
  return map
}

// A body loses `hungerDecayPerTick` every tick of the run and wins back
// `eatRestoreHunger` per meal: the pantry is sized off the clock, not off a guess.
export function mealsPerMind(config: SimConfig, totalTicks: number): number {
  return Math.ceil((config.needs.hungerDecayPerTick * totalTicks) / config.needs.eatRestoreHunger)
}

// Whatever those mouths need beyond what they carry, the storehouse holds.
export function storehouseBread(
  config: SimConfig, totalTicks: number, mindCount: number, carryingMinds: number,
): number {
  return Math.max(0, mindCount * mealsPerMind(config, totalTicks) - carryingMinds * BREAD_PER_MIND)
}

export type GenesisEvent = { type: string; payload: Record<string, unknown> }

export type GenesisMind = {
  id: string; name: string; sex: 'f' | 'm'; ageDays: number; x: number; y: number; houseIndex: number
}

// The town as it stands on the morning of day zero. Ordered: ground first, then
// the bodies on it, then what they own.
export function townGenesisEvents(opts: {
  config: SimConfig
  totalTicks: number
  minds: GenesisMind[]
  // Mouths that will exist before the run ends — the staged birth — counted into the pantry.
  unbornMinds?: number
}): GenesisEvent[] {
  const { config, totalTicks, minds } = opts
  const events: GenesisEvent[] = []
  const emit = (type: string, payload: Record<string, unknown>): void => { events.push({ type, payload }) }

  for (const box of HOUSES) {
    const owner = minds.find((m) => HOUSES[m.houseIndex]?.id === box.id)?.id ?? null
    emit('structure_planned', { ...box, maxHp: 50, flammable: true, builderId: owner, ...(owner === null ? {} : { owner }) })
    emit('structure_completed', { id: box.id })
  }
  for (const m of minds) {
    emit('agent_spawned', { id: m.id, name: m.name, x: m.x, y: m.y, ageDays: m.ageDays, sex: m.sex })
  }
  const builder = minds[1]?.id ?? minds[0]!.id
  emit('structure_planned', { ...STOREHOUSE, maxHp: 60, flammable: true, builderId: builder })
  emit('structure_completed', { id: STOREHOUSE.id })
  emit('structure_planned', { ...HEARTH, maxHp: 100000, flammable: true, builderId: 'dov' })
  emit('structure_completed', { id: HEARTH.id })
  emit('fire_ignited', { structureId: HEARTH.id, cause: 'the stove is lit' })
  emit('structure_planned', { ...WEIR, maxHp: 30, flammable: false, builderId: 'esen' })
  emit('structure_completed', { id: WEIR.id })

  let itemNo = 0
  const item = (payload: Record<string, unknown>): void => {
    itemNo += 1
    emit('item_spawned', { id: `item_${itemNo}`, qty: 1, ...payload })
  }

  for (const m of minds) {
    item({ kind: 'bread', qty: BREAD_PER_MIND, loc: { t: 'agent', id: m.id }, owner: m.id })
    for (const c of CARRIED_MATERIALS) item({ kind: c.kind, qty: c.qty, loc: { t: 'agent', id: m.id }, owner: m.id })
  }
  item({ ...WORN_TOOL, loc: { t: 'agent', id: WORN_TOOL.owner }, crafterMark: WORN_TOOL.owner })

  // Things with a name on them, in plain sight: ownership has to reach the prose.
  item({ kind: 'plank', qty: 3, loc: { t: 'tile', x: 16, y: 12 }, owner: 'bex', crafterMark: 'bex' })
  item({ kind: 'fish', qty: 2, loc: { t: 'agent', id: 'esen' }, owner: 'esen', spoilage: { spawnDay: 0, days: 2 } })
  item({ kind: 'pot', qty: 1, loc: { t: 'agent', id: 'dov' }, owner: 'dov' })
  item({ kind: 'wood', qty: 6, loc: { t: 'agent', id: 'dov' }, owner: 'dov' })

  const mouths = minds.length + (opts.unbornMinds ?? 0)
  item({
    kind: 'bread', qty: storehouseBread(config, totalTicks, mouths, minds.length),
    loc: { t: 'structure', id: STOREHOUSE.id }, owner: minds[0]!.id,
  })
  // Seed grain: last season's, kept dry indoors, and the only way to sow the spare plots.
  item({ kind: CROP_KIND, qty: 6, loc: { t: 'structure', id: STOREHOUSE.id }, owner: minds[0]!.id })

  for (const pile of MATERIAL_PILES) {
    item({ kind: pile.kind, qty: pile.qty, loc: { t: 'tile', x: pile.x, y: pile.y } })
  }

  // The field. A backdated sowing is a fact about the past, so the stage the crop
  // has already reached is stated with it rather than waited for.
  const def = config.crops[CROP_KIND]!
  let cropNo = 0
  for (const plot of PLOTS) {
    if (plot.plantedDaysAgo === null) continue
    cropNo += 1
    const id = `crop_${cropNo}`
    emit('crop_planted', { id, kind: CROP_KIND, x: plot.x, y: plot.y, plantedDay: -plot.plantedDaysAgo })
    const stage = Math.min(def.stages - 1, Math.floor((plot.plantedDaysAgo * (def.stages - 1)) / def.growthDays))
    if (stage > 0) emit('crop_grew', { cropId: id, stage })
  }

  return events
}

export const G9_DEFAULT_TICKS = 2 * MINUTES_PER_DAY
