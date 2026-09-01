// Deterministic: no Math.random, policies are pure functions of perception, timeline tick-keyed.
// A body decides only while `activity` is unset — `submitIntent` discards an intent taken during one.
import { doorFrontTile, nextDawnTick, T_PATH, T_ROAD, type SimConfig } from '@sj/shared'
import {
  BRIDGE_KIND,
  awakeEnergyDecay,
  bridgeAt,
  buildSiteOf,
  buildTicks,
  claimInWorld,
  composePerception,
  createWorldTick,
  type LawQueue,
  doorTile,
  findPath,
  isAdjacentToRect,
  isPassable,
  isRoofedFire,
  isStokeable,
  submitIntent,
  townSquareOf,
  type PerceptionPacket,
  type RngStreams,
  type Structure,
  type WorldState,
} from '@sj/engine'
import { devTown, type DevStructure } from './devTown.js'
// Type-only, so no import cycle survives compilation.
import type { DevMapKind } from './devWorld.js'

export type FounderDef = {
  id: string
  name: string
  ageDays: number
  spawn: { x: number; y: number }
  patrol: [{ x: number; y: number }, { x: number; y: number }]
}

// map fixture: river x<=3, forest x>=61, grass between (engine makeFixtureMap)
export const FOUNDERS: readonly FounderDef[] = [
  {
    id: 'omar',
    name: 'Omar',
    ageDays: 24 * 364,
    spawn: { x: 6, y: 32 },
    patrol: [
      { x: 6, y: 32 },
      { x: 20, y: 23 },
    ],
  },
  {
    id: 'amara',
    name: 'Amara',
    ageDays: 35 * 364,
    spawn: { x: 21, y: 23 },
    patrol: [
      { x: 21, y: 23 },
      { x: 31, y: 23 },
    ],
  },
  {
    id: 'yusuf',
    name: 'Yusuf',
    ageDays: 55 * 364,
    spawn: { x: 34, y: 24 },
    patrol: [
      { x: 34, y: 24 },
      { x: 24, y: 21 },
    ],
  },
  {
    id: 'nadia',
    name: 'Nadia',
    ageDays: 26 * 364,
    spawn: { x: 26, y: 20 },
    patrol: [
      { x: 26, y: 20 },
      { x: 16, y: 28 },
    ],
  },
  {
    id: 'salma',
    name: 'Salma',
    ageDays: 45 * 364,
    spawn: { x: 28, y: 26 },
    patrol: [
      { x: 28, y: 26 },
      { x: 28, y: 18 },
    ],
  },
]

export type TownStructure = { id: string; kind: string; x: number; y: number; w: number; h: number }

export const TOWN_STRUCTURES: readonly TownStructure[] = [
  { id: 'structure_storehouse', kind: 'storehouse', x: 20, y: 20, w: 2, h: 2 },
  { id: 'structure_shed', kind: 'shed', x: 23, y: 20, w: 1, h: 1 },
  { id: 'structure_house', kind: 'house', x: 30, y: 20, w: 2, h: 2 },
  { id: 'structure_wagon', kind: 'wagon', x: 26, y: 25, w: 1, h: 2 },
  { id: 'structure_scaffolding', kind: 'scaffolding', x: 34, y: 23, w: 1, h: 1 },
  { id: 'structure_stone', kind: 'standing_stone', x: 15, y: 28, w: 1, h: 1 },
]

// The scripted fixture keeps its own unowned, unburnable-by-kind shape so every landed gate
// folds exactly the events it always folded.
const SCRIPTED_STRUCTURES: readonly DevStructure[] = TOWN_STRUCTURES.map((s) => ({
  ...s,
  owner: null,
  facing: 'sw' as const,
  flammable: s.kind !== 'standing_stone',
}))

/** `rings` only means anything to 'showcase' — the frozen fixture has no grammar to grow. */
export function townStructuresFor(map: DevMapKind, rings?: number): readonly DevStructure[] {
  return map === 'showcase' ? devTown(undefined, rings).structures : SCRIPTED_STRUCTURES
}

export type DevHolding = {
  id: string
  kind: string
  qty: number
  structureId: string
  owner: string | null
}

/** Past the card's eight-row cap on purpose, so the "and N more" line is a thing a viewer can
 *  see. `wood`, NOT `timber` — nothing in the world eats `timber`. */
const STOREHOUSE_STOCK: readonly (readonly [string, number])[] = [
  ['wheat_sheaf', 12],
  ['bread', 6],
  ['fish', 4],
  ['berries', 9],
  ['wood', 30],
  ['stone', 11],
  ['rope', 3],
  ['cloth', 5],
  ['fiber', 7],
  ['charcoal', 2],
  ['hide', 2],
  ['clay', 6],
]
const SHED_STOCK: readonly (readonly [string, number])[] = [
  ['axe', 1],
  ['saw', 1],
  ['hammer', 1],
  ['gravel', 8],
  ['wood', 4],
]
/** `composePerception` shows a building's shelves only to somebody inside it or against its
 *  wall, so the public store's wood might as well not be there. Ten wood is one house. */
const HOUSE_STOCK: readonly (readonly [string, number])[] = [
  ['bread', 2],
  ['waterskin', 1],
  ['herb_bundle', 3],
  ['wood', 10],
]

/** The guard below asks every room to hold something, so none reads as empty by accident. */
const CABIN_STOCK: readonly (readonly [string, number])[] = [
  ['wood', 6],
  ['cloth', 2],
]

const SHARED_STOCK: readonly (readonly [string, number])[] = [
  ['bread', 6],
  ['waterskin', 3],
  ['herb_bundle', 5],
  ['wood', 10],
]

const STOCK_FOR: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  storehouse: STOREHOUSE_STOCK,
  shed: SHED_STOCK,
  house: HOUSE_STOCK,
  cabin: CABIN_STOCK,
  cottage: SHARED_STOCK,
  farmhouse: SHARED_STOCK,
}

/** Ids carry the kind rather than a number, because `fold` advances the world's entity
 *  counter off any id that ends in one. */
export function devHoldings(structures: readonly DevStructure[]): DevHolding[] {
  const out: DevHolding[] = []
  for (const s of structures) {
    for (const [kind, qty] of STOCK_FOR[s.kind] ?? []) {
      out.push({ id: `item_${s.id}_${kind}`, kind, qty, structureId: s.id, owner: s.owner })
    }
  }
  return out
}

export const FOUNDERS_HOME_ID = 'structure_house'
// How tired you have to be to want your own bed; when to set out is `homeIntent`'s question.
export const GO_HOME_BELOW = 25
export const LEAVE_HOME_ABOVE = 80
// Just under the earliest tick the five first go indoors (814 on the showcase at rings=3), so
// the walk home is the first thing a viewer sees.
export const DEV_FAST_FORWARD_FOR_INTERIORS = 810

const NEED_TOPUP_BELOW = 40
const HUNGER_TOPUP = 55
const WARMTH_TOPUP = 50

export type Intent = { verb: string; params: Record<string, unknown> }
const SLEEP: Intent = { verb: 'sleep', params: {} }

/** A preference, not a physics number — what stops a body walking past the floor is
 *  `arrivesStanding`. */
const PATROL_SLEEP_BELOW = 20

/** Priced at the TIRED rate always: `tilesPerTick` drops once a need falls under
 *  `debuffThreshold`, which would under-price the journeys that matter, the long ones taken late. */
export function walkEnergyCost(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  to: { x: number; y: number },
): number | null {
  const a = state.agents[agentId]
  if (a === undefined) return null
  const at = { x: a.x, y: a.y }
  if (at.x === to.x && at.y === to.y) return 0
  const path = findPath(state, at, to, config)
  if (path === null) return null
  const tired = Math.min(config.movement.baseTilesPerTick, config.movement.debuffTilesPerTick)
  return Math.ceil(path.length / tired) * awakeEnergyDecay(config, a)
}

/** The reserve is the collapse floor itself — arriving at exactly the floor is arriving face-down. */
export function arrivesStanding(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  to: { x: number; y: number },
): boolean {
  const cost = walkEnergyCost(state, config, agentId, to)
  const a = state.agents[agentId]
  if (cost === null || a === undefined) return false
  return a.needs.energy - cost > config.needs.collapseThreshold
}

function workEnergyCost(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  ticks: number,
): number | null {
  const a = state.agents[agentId]
  return a === undefined ? null : ticks * awakeEnergyDecay(config, a)
}

// Nobody here names a coordinate for a roof and nobody CAN: in a town `build` validates against
// `PlottedBuildParams`, a strict `{ kind }` with no x and no y; the site is `claimInWorld`'s answer.

export const MASON_KIND = 'house'
/** `claimInWorld` answers for a rectangle, not for a kind. */
const MASON_NEED = { along: 2, deep: 2 }
/** Scripted supply: a demo town has no economy, so a mason out of wood is handed more. */
export const MASON_WOOD_KIND = 'wood'

function heldWood(state: WorldState, agentId: string): number {
  let n = 0
  for (const i of Object.values(state.items)) {
    if (i.kind === MASON_WOOD_KIND && i.loc.t === 'agent' && i.loc.id === agentId) n += i.qty
  }
  return n
}

function masonErrandCost(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  claim: { door: { x: number; y: number } },
): number | null {
  const out = walkEnergyCost(state, config, agentId, claim.door)
  const work = workEnergyCost(state, config, agentId, config.construction.houseTicks)
  return out === null || work === null ? null : out + work
}

export function masonIntent(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  lendHands = false,
): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined || a.insideId !== undefined) return null
  const join = lendHands ? buildSiteOf(state, config, agentId, { kind: MASON_KIND }).resume : null
  if (join !== null) {
    // Only the work that is LEFT: a joiner has no walk to pay for and no fresh house to raise.
    const left = workEnergyCost(
      state,
      config,
      agentId,
      buildTicks(config, MASON_KIND) - join.progressTicks,
    )
    return left !== null && a.needs.energy - left > GO_HOME_BELOW
      ? { verb: 'build', params: { kind: MASON_KIND } }
      : null
  }
  const claim = claimInWorld(state, MASON_NEED)
  if (claim === null) return null
  const errand = masonErrandCost(state, config, agentId, claim)
  // The reserve for taking on WORK is bedtime, not the collapse floor: a body does not choose
  // an errand it will finish face-down.
  if (errand === null || a.needs.energy - errand <= GO_HOME_BELOW) return null
  return isAdjacentToRect(a.x, a.y, claim.site)
    ? { verb: 'build', params: { kind: MASON_KIND } }
    : { verb: 'walk', params: { x: claim.door.x, y: claim.door.y } }
}

// A bridge is the one kind the verb still takes an x and a y for, because the WATER decides
// where a deck can stand and no town can claim a plot on it (`isPlottedKind`).

/** The first founder is the wright: with the same cast in the same order, deterministically. */
const bridgewrightOf = (cast: readonly FounderDef[]): string | null => cast[0]?.id ?? null

export function bridgewrightIntent(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  deck: { x: number; y: number; w: number; h: number },
): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined || a.insideId !== undefined) return null
  if (bridgeAt(state, deck.x, deck.y)) return null
  // The spit at the far end of the deck — the one tile beside the crossing a body can stand on.
  const stand = { x: deck.x + deck.w, y: deck.y }
  const out = walkEnergyCost(state, config, agentId, stand)
  const work = workEnergyCost(
    state,
    config,
    agentId,
    config.structures.recipes[BRIDGE_KIND]?.durationTicks ?? 0,
  )
  if (out === null || work === null || a.needs.energy - (out + work) <= GO_HOME_BELOW) return null
  return isAdjacentToRect(a.x, a.y, deck)
    ? { verb: 'build', params: { kind: BRIDGE_KIND, x: deck.x, y: deck.y } }
    : { verb: 'walk', params: stand }
}

// `lamp_post` is `sited`, so the sites come off the town's own street ring — the door tiles of
// the buildings already standing, stepped one tile off the way: a post in the road closes it.

const LAMP_KIND = 'lamp_post'

type LampSite = { x: number; y: number; stand: { x: number; y: number } }

/** How far off a door the search will walk to find ground that is not the way itself. Three
 *  tiles: the grammar's streets are two wide with a shoulder. */
export const LAMP_VERGE_REACH = 3

/** Nearest the square first. One step off the door finds nothing — the grammar paves a wide
 *  street ring, so all four neighbours of a door tile are more road. */
function lampSites(state: WorldState, want: number): LampSite[] {
  const square = townSquareOf(state)
  if (square === null) return []
  const isWay = (x: number, y: number): boolean => {
    const t = state.terrain[y]?.[x]
    return t === T_ROAD || t === T_PATH
  }
  // A post keeps a tile clear of the next: a lamp nobody can stand beside is a lamp nobody can feed.
  const posts: { x: number; y: number }[] = Object.values(state.structures).filter(
    (s) => s.kind === LAMP_KIND,
  )
  const touchesPost = (x: number, y: number): boolean =>
    posts.some((p) => isAdjacentToRect(x, y, { x: p.x, y: p.y, w: 1, h: 1 }))
  const out: (LampSite & { d: number })[] = []
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.stage !== 'complete' || s.kind === LAMP_KIND) continue
    const door = doorTile(state, s)
    if (door === null) continue
    let found: LampSite | null = null
    for (let r = 1; r <= LAMP_VERGE_REACH && found === null; r++) {
      for (let dy = -r; dy <= r && found === null; dy++) {
        for (let dx = -r; dx <= r && found === null; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const p = { x: door.x + dx, y: door.y + dy }
          if (isWay(p.x, p.y) || touchesPost(p.x, p.y) || !isPassable(state, p.x, p.y)) continue
          // Standing IN the street is fine; it is the POST that must keep off it.
          const stand = [
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
          ]
            .map(([sx, sy]) => ({ x: p.x + sx!, y: p.y + sy! }))
            .find((q) => isPassable(state, q.x, q.y))
          if (stand === undefined) continue
          found = { x: p.x, y: p.y, stand }
        }
      }
    }
    if (found === null) continue
    posts.push(found)
    out.push({ ...found, d: Math.abs(found.x - square.x) + Math.abs(found.y - square.y) })
  }
  return out
    .sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y)
    .slice(0, want)
    .map(({ x, y, stand }) => ({ x, y, stand }))
}

/** The LAST founder, so the wright's errand and the lamplighter's never share a pair of hands. */
export const lamplighterOf = (cast: readonly FounderDef[]): string | null => cast.at(-1)?.id ?? null

function lamplighterIntent(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  want: number,
): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined || a.insideId !== undefined) return null
  const standing = new Map(
    Object.values(state.structures)
      .filter((s) => s.kind === LAMP_KIND)
      .map((s) => [`${s.x},${s.y}`, s]),
  )

  // Every fire in the OPEN, the same set `stoke` lights for the night: a hearth under a roof
  // burns the armful and is nobody's daily round.
  const dawn = nextDawnTick(state.tick)
  const toFeed = Object.values(state.structures)
    .filter((s) => isStokeable(config, s.kind) && !isRoofedFire(config, s.kind))
    .sort((p, q) => p.id.localeCompare(q.id))
  for (const s of toFeed) {
    if (s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? -1) >= dawn) continue
    if (isAdjacentToRect(a.x, a.y, s)) return { verb: 'stoke', params: { structureId: s.id } }
    const stand = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]
      .map(([dx, dy]) => ({ x: s.x + dx!, y: s.y + dy! }))
      .find((q) => isPassable(state, q.x, q.y))
    if (stand === undefined) continue
    return arrivesStanding(state, config, agentId, stand)
      ? { verb: 'walk', params: { x: stand.x, y: stand.y } }
      : null
  }
  // The count is a ceiling, not a target: asking only "is this site free" would light a growing
  // town for ever, one post per new door.
  if (standing.size >= want) return null
  for (const site of lampSites(state, want)) {
    if (standing.has(`${site.x},${site.y}`)) continue
    const box = { x: site.x, y: site.y, w: 1, h: 1 }
    if (isAdjacentToRect(a.x, a.y, box))
      return { verb: 'build', params: { kind: LAMP_KIND, x: site.x, y: site.y } }
    return arrivesStanding(state, config, agentId, site.stand)
      ? { verb: 'walk', params: { x: site.stand.x, y: site.stand.y } }
      : null
  }
  return null
}

function makePatrolPolicy(f: FounderDef) {
  const [a, b] = f.patrol
  return (state: WorldState, config: SimConfig, p: PerceptionPacket): Intent | null => {
    if (p.self.body.needs.energy < PATROL_SLEEP_BELOW) return SLEEP
    const dest = p.self.x === a.x && p.self.y === a.y ? b : a
    if (!arrivesStanding(state, config, f.id, dest)) return SLEEP
    return { verb: 'walk', params: { x: dest.x, y: dest.y } }
  }
}

export type FoundersOnTick = (ctx: {
  tick: number
  emit: (type: string, payload: unknown) => void
}) => void

export type FoundersOpts = {
  /** Drained at the tick boundary before physics; absent, a law has no channel to arrive on. */
  laws?: LawQueue

  // dev/demo only, each off or absent by default so every landed gate folds the events it always did.
  interiors?: boolean
  structures?: readonly DevStructure[]
  founders?: readonly FounderDef[]
  holdings?: boolean
  builders?: boolean
  deck?: { x: number; y: number; w: number; h: number }
  /** OFF for a measured reason: a building completes off the BUILDER's activity clock, not the
   *  site's `progressTicks`, so extra hands buy no calendar time. */
  jointBuild?: boolean
  lamps?: number
  /** Skips every decision below, the need top-ups included: a town that quietly refills five
   *  stomachs is a town whose hunger means nothing. */
  minds?: boolean
}

export function homeOf(state: WorldState, agentId: string): Structure | null {
  for (const s of Object.values(state.structures)) {
    if (s.owner === agentId && s.stage === 'complete') return s
  }
  return null
}

/** `null` on a town with no well — the frozen fixture, which keeps its own waypoints. */
function wellsideTile(structures: readonly DevStructure[]): { x: number; y: number } | null {
  const well = structures.find((s) => s.kind === 'well')
  if (well === undefined) return null
  const d = doorFrontTile({
    kind: well.kind,
    dx: well.x,
    dy: well.y,
    w: well.w,
    h: well.h,
    facing: well.facing,
    owner: null,
    furnishings: [],
  })
  return { x: d.dx, y: d.dy }
}

/** Each founder starts at their own door, so the first frame reads as five households. */
export function foundersFor(structures: readonly DevStructure[]): readonly FounderDef[] {
  const byOwner = new Map(structures.filter((s) => s.owner !== null).map((s) => [s.owner!, s]))
  const wellside = wellsideTile(structures)
  return FOUNDERS.map((f) => {
    const home = byOwner.get(f.id)
    if (home === undefined) return f
    // A hand-computed south-centre is wrong once buildings turn; this is the tile `doorTile` picks.
    const d = doorFrontTile({
      kind: home.kind,
      dx: home.x,
      dy: home.y,
      w: home.w,
      h: home.h,
      facing: home.facing,
      owner: null,
      furnishings: [],
    })
    const spawn = { x: d.dx, y: d.dy }
    // Both ends of the patrol move into this town or neither does: a spawn relocated while the
    // far waypoint keeps its fixture coordinate makes a leg that outlasts the legs.
    return { ...f, spawn, patrol: [spawn, wellside ?? f.patrol[1]] as FounderDef['patrol'] }
  })
}

// Decided from world state, not the patrol packet: door tile, distance and `insideId` are world facts.
export function homeIntent(state: WorldState, config: SimConfig, agentId: string): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined) return null
  if (a.insideId !== undefined) {
    return a.needs.energy > LEAVE_HOME_ABOVE ? { verb: 'exit', params: {} } : SLEEP
  }
  // An unhoused person heads for the shared roof, so nobody is left with nowhere to sleep.
  const home = homeOf(state, agentId) ?? state.structures[FOUNDERS_HOME_ID] ?? null
  const door = home === null ? null : doorTile(state, home)
  if (door === null || home === null) return null
  if (Math.abs(a.x - door.x) <= 1 && Math.abs(a.y - door.y) <= 1) {
    return a.needs.energy < GO_HOME_BELOW
      ? { verb: 'enter', params: { structureId: home.id } }
      : null
  }
  const cost = walkEnergyCost(state, config, agentId, door)
  if (cost === null) return a.needs.energy < GO_HOME_BELOW ? SLEEP : null
  if (a.needs.energy - cost >= GO_HOME_BELOW) return null
  // The door costs two more awake ticks after the walk: enter, then sleep.
  const atTheDoor = cost + workEnergyCost(state, config, agentId, 2)!
  return a.needs.energy - atTheDoor > config.needs.collapseThreshold
    ? { verb: 'walk', params: { x: door.x, y: door.y } }
    : // The deadlock breaker: too late to walk anywhere. `submitIntent` refuses every verb but
      // eat and sleep to a body on the ground, so a WALK here would never get it up again.
      SLEEP
}

export function makeFoundersOnTick(
  config: SimConfig,
  rng: RngStreams,
  getState: () => WorldState,
  opts: FoundersOpts = {},
): FoundersOnTick {
  const cast = opts.founders ?? FOUNDERS
  const wright = opts.deck === undefined ? null : bridgewrightOf(cast)
  const lighter = opts.lamps === undefined || opts.lamps <= 0 ? null : lamplighterOf(cast)
  const policies = new Map(cast.map((f) => [f.id, makePatrolPolicy(f)]))
  const worldTick = createWorldTick(config, rng, opts.laws)
  const structures = opts.structures ?? SCRIPTED_STRUCTURES
  return ({ tick, emit }) => {
    if (tick === 1) {
      for (const f of cast) {
        emit('agent_spawned', {
          id: f.id,
          name: f.name,
          x: f.spawn.x,
          y: f.spawn.y,
          ageDays: f.ageDays,
        })
      }
      for (const s of structures) {
        // `owner` rides along only when there is one, so the scripted fixture's payload is
        // byte-identical to the one every landed gate already folded.
        emit('structure_planned', {
          id: s.id,
          kind: s.kind,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          maxHp: 20,
          flammable: s.flammable,
          builderId: 'script',
          ...(s.owner === null ? {} : { owner: s.owner }),
          // Absent is `sw`, so the frozen fixture — all six of whose buildings face sw — folds
          // the payload it always folded.
          ...(s.facing === 'sw' ? {} : { facing: s.facing }),
        })
        emit('structure_completed', { id: s.id })
      }
      if (opts.holdings === true) {
        for (const h of devHoldings(structures)) {
          emit('item_spawned', {
            id: h.id,
            kind: h.kind,
            qty: h.qty,
            ...(h.owner === null ? {} : { owner: h.owner }),
            loc: { t: 'structure', id: h.structureId },
          })
        }
      }
    }

    const result = worldTick(getState())
    for (const e of result.events) emit(e.type, e.payload)

    // ★ EVERYTHING BELOW THIS LINE IS A PUPPET STRING. A live cast keeps the town and the
    // world systems above and takes none of it — see `minds` on FoundersOpts.
    if (opts.minds === true) return

    // scripted need top-ups keep the showcase town alive without a food economy
    for (const f of cast) {
      const a = getState().agents[f.id]
      if (!a?.alive) continue
      const topUp: { need: string; delta: number }[] = []
      if (a.needs.hunger < NEED_TOPUP_BELOW) topUp.push({ need: 'hunger', delta: HUNGER_TOPUP })
      if (a.needs.warmth < NEED_TOPUP_BELOW) topUp.push({ need: 'warmth', delta: WARMTH_TOPUP })
      if (topUp.length > 0) emit('needs_changed', { id: f.id, changes: topUp })
      // The id never ends in a digit: `fold` advances the world's entity counter off any that does.
      if (
        (opts.builders === true || f.id === wright || f.id === lighter) &&
        a.activity === null &&
        heldWood(getState(), f.id) <
          (config.structures.recipes[MASON_KIND]?.inputs[MASON_WOOD_KIND] ?? 0)
      ) {
        emit('item_spawned', {
          id: `item_${MASON_WOOD_KIND}_${f.id}_${tick}_load`,
          kind: MASON_WOOD_KIND,
          qty: config.structures.recipes[MASON_KIND]?.inputs[MASON_WOOD_KIND] ?? 0,
          loc: { t: 'agent', id: f.id },
        })
      }
    }

    for (const f of cast) {
      const state = getState()
      const a = state.agents[f.id]
      if (!a?.alive) continue
      // `submitIntent` refuses everything while an activity runs, so a decision here is discarded.
      if (a.activity) continue
      // Home comes first because a spent body has no business starting anything; the deck comes
      // before the houses because until it stands half the town is unreachable.
      const intent =
        (opts.interiors === true ? homeIntent(state, config, f.id) : null) ??
        (f.id === wright ? bridgewrightIntent(state, config, f.id, opts.deck!) : null) ??
        (f.id === lighter ? lamplighterIntent(state, config, f.id, opts.lamps!) : null) ??
        (opts.builders === true
          ? masonIntent(state, config, f.id, opts.jointBuild === true)
          : null) ??
        // composed here, not above: an earlier intent usually wins, and the packet is O(world)
        policies.get(f.id)!(state, config, composePerception(state, config, f.id, []))
      if (!intent) continue
      const r = submitIntent(state, config, f.id, intent.verb, intent.params)
      if (r.ok) for (const e of r.events) emit(e.type, e.payload)
    }
  }
}
