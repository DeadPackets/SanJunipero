import { z } from 'zod'
import { FAUNA_YIELD, type FaunaKind } from '../data/faunaDefs.js'
import { FORAGEABLE_YIELD } from '../data/forageables.js'
import { WalkParams, WalkToPlace } from '../events.def.js'
import {
  FISH_KIND,
  FORAGE_KIND,
  HERB_KIND,
  PALE_MUSHROOM,
  isFoodKind,
  nutritionOf,
} from '../food.js'
import { placesNamedAloud } from '../earshot.js'
import { naturalFeatureAt, type NaturalFeature } from '../geography.js'
import { doorTile, occupantsOf, perimeter, roomIsFull, sameInterior } from '../interiors.js'
import { findPath, isPassable, pathCtx, type Point } from '../path.js'
import { type RngStream } from '../rng.js'
import {
  mintId,
  type Affliction,
  type AgentBody,
  type Item,
  type Structure,
  type TileId,
  type WorldState,
} from '../state.js'
import { fleeTo } from '../systems/fauna.js'
import { isSpoiling, spoilageFor } from '../systems/spoilage.js'
import { fireIsOnYourSide, inTheRoomWith, isHeatSource } from '../systems/warmth.js'
import {
  BUILD_NEEDS_A_THING_AND_A_PLACE,
  buildIsPlotted,
  buildSiteOf,
  siteToRaise,
  words,
} from './build.js'
import {
  consumeHeld,
  heldQty,
  heldStacks,
  isAdjacentToRect,
  nearRect,
  siteAt,
  type PendingEvent,
} from './common.js'
import { buildTicks, buildableRecipe, craftRoutes, shortOf, type SeedRecipe } from './craft.js'
import {
  CITY_HEARTH_KIND,
  MINUTES_PER_DAY,
  SPEECH_INPUT_MAX_CHARS,
  T_FOREST,
  T_GRASS,
  T_ROAD,
  T_SAPLING,
  classMembers,
  fertilityAt,
  glowRadiusFor,
  isPaveable,
  isRoofedKind,
  isWet,
  isWoody,
  nextDawnTick,
  sanitizeSpokenText,
  simTimeFromTick,
  structureGlowRadius,
  type SimConfig,
} from '@sj/shared'

export type VerbKind =
  | 'walk'
  | 'sleep'
  | 'wake'
  | 'enter'
  | 'exit'
  | 'eat'
  | 'tend'
  | 'till'
  | 'plant'
  | 'harvest'
  | 'fish'
  | 'forage'
  | 'build'
  | 'craft'
  | 'extinguish'
  | 'drink'
  | 'fill'
  | 'hunt'
  | 'wear'
  | 'doff'
  | 'kindle'
  | 'snuff'
  | 'stoke'
  | 'chop'
  | 'speak'
  | 'give'
  | 'take'
  | 'drop'
  | 'stow'
  | 'write'
  | 'read'
  | 'inscribe'
  | 'teach'
  | 'attack'
  | 'experiment'

// Named rather than an open `z.record`, whose `propertyNames` a grammar-constrained decoder
// refuses. Loose, so a verb minted at runtime can still be handed a parameter nobody listed.
// Every named string is non-empty: the world refuses a blank one a beat later, so the decoder
// is told up front. Probed against the pinned back end; `minLength` survives its grammar.
const nonEmpty = z.string().min(1).optional()
export const IntentParamsSchema = z.looseObject({
  x: z.number().optional(),
  y: z.number().optional(),
  itemId: nonEmpty,
  structureId: nonEmpty,
  targetId: nonEmpty,
  cropId: nonEmpty,
  nodeId: nonEmpty,
  faunaId: nonEmpty,
  kind: nonEmpty,
  recipe: nonEmpty,
  track: nonEmpty,
  text: nonEmpty,
  description: nonEmpty,
})

export type VerbDef = {
  kind: string
  validate(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
  ): string | null
  duration(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
  ): number
  onStart?(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
  ): PendingEvent[]
  /** A verb declaring this never takes the activity slot and is never refused for busy-ness;
   *  speak is the whole list. Takes no rng: an intent-time event cannot draw from the tick loop's stream. */
  atOnce?(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
  ): PendingEvent[]
  onComplete(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
    rng: RngStream,
  ): PendingEvent[]
  results?(
    state: WorldState,
    config: SimConfig,
    agentId: string,
    params: Record<string, unknown>,
  ): Record<string, unknown>
  skill?: { track: string; xp: number }
  rngStream?: string
}

// Fills the one default nearly every verb repeats: a one-tick duration.
function makeVerb(spec: Omit<VerbDef, 'duration'> & Partial<Pick<VerbDef, 'duration'>>): VerbDef {
  return { duration: () => 1, ...spec }
}

// Adjacent = Chebyshev distance <= 1 to any footprint tile (standing on it counts).
// Shared validate block for verbs aimed at another agent. Reason strings are
// per-verb; `busy` (teach) is checked between the alive and adjacency checks.
function adjacentLivingTarget(
  state: WorldState,
  agentId: string,
  targetId: string,
  reasons: { self: string; gone: string; busy?: string; far: string },
): string | null {
  if (targetId === agentId) return reasons.self
  const target = state.agents[targetId]
  if (!target?.alive) return reasons.gone
  if (reasons.busy !== undefined && target.activity) return reasons.busy
  const a = state.agents[agentId]!
  // A refusal must leave a door open: the one thing missing is two paces, so the answer says which two.
  if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) {
    return `${reasons.far} — they are at (${target.x}, ${target.y})`
  }
  return null
}

/** The walk's whole rule, free of world state so the viewer can animate on it too. */
export function tilesPerTickFor(
  needs: Readonly<Record<string, number>>,
  cfg: { debuffThreshold: number; base: number; debuff: number },
): number {
  const debuffed = Object.values(needs).some((v) => v < cfg.debuffThreshold)
  return debuffed ? cfg.debuff : cfg.base
}

/** A path's cost in ticks. The rounding lives here alone, so the town's price for a walk and
 *  the walk's own length cannot come to disagree by a tick. */
export function walkTicks(pathLen: number, tilesPerTick: number): number {
  return Math.ceil(pathLen / tilesPerTick)
}

export function tilesPerTick(state: WorldState, config: SimConfig, agentId: string): number {
  return tilesPerTickFor(state.agents[agentId]!.needs, {
    debuffThreshold: config.needs.debuffThreshold,
    base: config.movement.baseTilesPerTick,
    debuff: config.movement.debuffTilesPerTick,
  })
}

/** The nearest of these tiles this body can actually reach, nearest first. The one place a
 *  walk settles on a tile, so a named roof and a named landmark land the same way. */
function nearestReachable(
  state: WorldState,
  config: SimConfig,
  a: AgentBody,
  tiles: Point[],
  rank: (p: Point) => number = () => 0,
  refusal = 'no path to that spot',
): Point | { refusal: string } {
  const near = (p: Point): number => Math.abs(p.x - a.x) + Math.abs(p.y - a.y)
  const sorted = [...tiles].sort(
    (p, q) => rank(p) - rank(q) || near(p) - near(q) || p.y - q.y || p.x - q.x,
  )
  for (const t of sorted) if (findPath(state, a, t, config) !== null) return t
  return { refusal }
}

// What the world says when the legs cannot start at all. Said in the place where it is true:
// the body that has already walked to the limit is the only one the sentence teaches.
export const WALK_OFF_MAP = 'the world ends that way'
export const WALK_NO_ROAD = 'there is no way through from here'

// How far around an unreachable mark the world looks for footing toward it, and how many of
// those it will search before it takes the refusal. A house or a bank is inside eight.
const SETTLE_REACH = 8
const SETTLE_TRIES = 12

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** As far toward a mark as the ground allows. A want that points past the edge of the world, or
 *  across water with no crossing, is a journey worth starting rather than a turn worth spending:
 *  the refusal is kept for the body already standing at that limit, where it teaches something. */
function settleToward(
  state: WorldState,
  config: SimConfig,
  a: AgentBody,
  want: Point,
  refusal: string,
): Point | { refusal: string } {
  const ctx = pathCtx(state, config)
  const to = {
    x: clamp(want.x, 0, state.terrain[0]!.length - 1),
    y: clamp(want.y, 0, state.terrain.length - 1),
  }
  const toward = (p: Point): number => Math.abs(p.x - to.x) + Math.abs(p.y - to.y)
  const near: Point[] = []
  for (let y = to.y - SETTLE_REACH; y <= to.y + SETTLE_REACH; y++) {
    for (let x = to.x - SETTLE_REACH; x <= to.x + SETTLE_REACH; x++) {
      if (isPassable(state, x, y, ctx)) near.push({ x, y })
    }
  }
  near.sort((p, q) => toward(p) - toward(q))
  const settled = nearestReachable(state, config, a, near.slice(0, SETTLE_TRIES), toward, refusal)
  if ('refusal' in settled) return settled
  return settled.x === a.x && settled.y === a.y ? { refusal } : settled
}

// The lake's own middle stands nine tiles from its shore, which is the widest any landmark's
// centre sits from ground a foot can go on.
const FEATURE_REACH = 12
// A bank runs the height of the map, and a search that drains costs thousands of nodes: a body
// that cannot reach the nearest few tiles of shore cannot reach the hundredth either.
const FEATURE_TRIES = 8

/** Where a walk to a landmark ends: the nearest ground this body can stand on that touches the
 *  thing itself — a bank for the river, a shore for the lake, the spit for the ford. */
function featureDestination(
  state: WorldState,
  config: SimConfig,
  a: AgentBody,
  at: Point,
  f: NaturalFeature,
): Point | { refusal: string } {
  const ctx = pathCtx(state, config)
  const touches = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (f.has(state, x + dx, y + dy)) return true
    }
    return false
  }
  const near = (p: Point): number => Math.abs(p.x - a.x) + Math.abs(p.y - a.y)
  const bank: Point[] = []
  for (let y = at.y - FEATURE_REACH; y <= at.y + FEATURE_REACH; y++) {
    for (let x = at.x - FEATURE_REACH; x <= at.x + FEATURE_REACH; x++) {
      if (isPassable(state, x, y, ctx) && touches(x, y)) bank.push({ x, y })
    }
  }
  bank.sort((p, q) => near(p) - near(q))
  const rank = (): number => 0
  return nearestReachable(
    state,
    config,
    a,
    bank.slice(0, FEATURE_TRIES),
    rank,
    `there is no way to ${f.name} from this side`,
  )
}

/** Where a walk ends, from either way of naming it. A named place resolves to open ground beside
 *  it that this body can actually reach; the refusal comes from here too, so the seam that
 *  settles the act and the test that judges it can never disagree. */
export function walkDestination(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  params: Record<string, unknown>,
): { x: number; y: number } | { refusal: string } {
  const a = state.agents[agentId]!
  const tile = WalkParams.safeParse(params)
  if (tile.success) {
    const want = tile.data
    // Off the map is the one a mind loops on, having no way to see the edge it keeps walking at.
    if (
      want.x < 0 ||
      want.y < 0 ||
      want.x >= state.terrain[0]!.length ||
      want.y >= state.terrain.length
    )
      return settleToward(state, config, a, want, WALK_OFF_MAP)
    // A mark with no footing under it is left to `validate`, which has always named it as one.
    if (!isPassable(state, want.x, want.y)) return want
    return findPath(state, a, want, config) === null
      ? settleToward(state, config, a, want, WALK_NO_ROAD)
      : want
  }
  const named = WalkToPlace.safeParse(params)
  if (!named.success) return { refusal: 'a walk needs a place to end' }
  // A landmark before a roof: nobody has to be shown the river they live beside, so there is no
  // knownPlaces row to check — the ground itself is what says whether this valley has one.
  const natural = naturalFeatureAt(state, named.data.structureId, a.x, a.y)
  if (natural !== null) return featureDestination(state, config, a, natural.at, natural.feature)
  const s = state.structures[named.data.structureId]
  // Known, not merely standing: a mark a mind was never shown is a place it cannot name.
  if (s === undefined || !(a.knownPlaces ?? []).includes(s.id))
    return { refusal: 'you know no such place' }
  // `perimeter` is the codebase's one ring, so the tile a walk lands on and the door `enter`
  // measures against are picked off the same tiles in the same order.
  // A named place is walked to in order to enter it, and `enter` measures from the door. Without
  // the door first, the walk ends at the back wall and the step through the door is refused.
  const door = doorTile(state, s)
  const offDoor = (p: Point): number =>
    door === null || isAdjacentToRect(p.x, p.y, { ...door, w: 1, h: 1 }) ? 0 : 1
  const ctx = pathCtx(state, config)
  const ring = perimeter(s).filter((t) => isPassable(state, t.x, t.y, ctx))
  // Nearest first, so the common case is one search and a ring of walls costs none at all.
  return nearestReachable(state, config, a, ring, offDoor)
}

const walk: VerbDef = makeVerb({
  kind: 'walk',
  validate(state, config, agentId, params) {
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return 'you are indoors; step outside first'
    const to = walkDestination(state, config, agentId, params)
    if ('refusal' in to) return to.refusal
    // A memo hit for a named place, which already proved this tile: the two numbers are what
    // still have to be judged, and they are judged the way they always were.
    if (findPath(state, a, to, config) === null) return 'no path to that spot'
    return null
  },
  duration(state, config, agentId, params) {
    const p = WalkParams.parse(params)
    const a = state.agents[agentId]!
    const path = findPath(state, a, p, config)
    if (!path) throw new Error(`walk.duration: no path for ${agentId}`)
    return walkTicks(path.length, tilesPerTick(state, config, agentId))
  },
  onComplete() {
    return []
  },
})

// A walk the search could not finish inside its budget. The legs still go, and they stop short
// of where the mind aimed them — which is a thing the body can tell, and the only thing it can.
export function walkIsCapped(state: WorldState, agentId: string): boolean {
  const a = state.agents[agentId]
  if (a?.activity?.verb !== 'walk') return false
  const p = WalkParams.safeParse(a.activity.params)
  if (!p.success) return false
  // An empty route is a walk that was already there, not a walk that stops short.
  const last = a.activity.path?.at(-1)
  return last !== undefined && (last[0] !== p.data.x || last[1] !== p.data.y)
}

export const EatParams = z.object({ itemId: z.string() }).strict()

// The worst thing wrong with a body: highest severity, ties to the alphabetically first kind.
// The list is already stored in kind order, so a strictly-greater scan is that tiebreak.
export function worstAffliction(state: WorldState, agentId: string): Affliction | undefined {
  let worst: Affliction | undefined
  for (const x of state.agents[agentId]?.afflictions ?? []) {
    if (worst === undefined || x.severity > worst.severity) worst = x
  }
  return worst
}

export function relieveWorst(state: WorldState, agentId: string, amount: number): PendingEvent[] {
  const worst = worstAffliction(state, agentId)
  if (worst === undefined) return []
  const left = worst.severity - amount
  return [
    left > 0
      ? { type: 'affliction_worsened', payload: { agentId, kind: worst.kind, severity: left } }
      : { type: 'affliction_recovered', payload: { agentId, kind: worst.kind } },
  ]
}

// A body already down does not get to pick its bed, and neither does one only just upright:
// rest a body must fall over to earn is a ratchet.
function mayLieDownRough(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]!
  return a.collapsedSinceTick !== null || a.needs.energy < config.needs.debuffThreshold
}

const sleep: VerbDef = makeVerb({
  kind: 'sleep',
  validate(state, config, agentId) {
    const a = state.agents[agentId]!
    if (a.asleep) return 'already asleep'
    if (!config.structures.sleepIndoorsOnly || mayLieDownRough(state, config, agentId)) return null
    const s = a.insideId === undefined ? undefined : state.structures[a.insideId]
    if (s?.stage !== 'complete' || !isRoofedKind(config, s.kind)) {
      return 'there is nothing over you here; find somewhere to lie down — weary enough and the bare ground will do'
    }
    return null
  },
  onComplete(state, _config, agentId) {
    // A night lifts the ladder as well as the counter, and lifts it every time — recovery that
    // works once is a body that can only ever wear out.
    const weary = state.agents[agentId]?.afflictions?.some((x) => x.kind === 'fatigue') ?? false
    return [
      { type: 'agent_slept', payload: { agentId } },
      ...(weary ? [{ type: 'affliction_recovered', payload: { agentId, kind: 'fatigue' } }] : []),
    ]
  },
})

export const EnterParams = z.object({ structureId: z.string() }).strict()

const enter: VerbDef = makeVerb({
  kind: 'enter',
  validate(state, config, agentId, params) {
    const p = EnterParams.safeParse(params)
    if (!p.success) return 'going inside needs the building you mean'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return 'already inside'
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to enter'
    if (!isRoofedKind(config, s.kind)) return `a ${words(s.kind)} has no roof to get under`
    if (s.stage !== 'complete') return 'it is not finished'
    const door = doorTile(state, s)
    if (!door) return 'there is no way in'
    if (Math.abs(a.x - door.x) > 1 || Math.abs(a.y - door.y) > 1)
      return 'not close enough to the door'
    // Full is not impossible and the words have to say which: this names the bodies and the
    // floor, so it reads as a thing that changes when somebody steps out.
    if (roomIsFull(state, s)) {
      const n = occupantsOf(state, s.id).length
      return `there is no floor left in there — ${n === 1 ? 'one body fills' : `${n} bodies fill`} it`
    }
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = EnterParams.parse(params)
    const s = state.structures[p.structureId]
    const door = s ? doorTile(state, s) : null
    if (!door) return []
    return [
      { type: 'agent_moved', payload: { id: agentId, x: door.x, y: door.y } },
      { type: 'agent_entered', payload: { agentId, structureId: p.structureId } },
    ]
  },
})

const exit: VerbDef = makeVerb({
  kind: 'exit',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.insideId === undefined ? 'not inside anything' : null
  },
  onComplete(state, _config, agentId) {
    const structureId = state.agents[agentId]!.insideId
    return structureId === undefined
      ? []
      : [{ type: 'agent_exited', payload: { agentId, structureId } }]
  },
})

// submitIntent already prepends agent_woke for any intent from a sleeper.
const wake: VerbDef = makeVerb({
  kind: 'wake',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.asleep ? null : 'not asleep'
  },
  onComplete() {
    return []
  },
})

// The one derivation of a meal's worth: the kind's nutrition, plus a bonus for every distinct
// kind the variety window still remembers.
export function mealRestore(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  kind: string,
): number {
  if (!config.foodVariety.enabled) return config.needs.eatRestoreHunger
  const kinds = new Set((state.agents[agentId]?.recentFoods ?? []).map((m) => m.kind))
  kinds.add(kind)
  const bonus = Math.min(
    config.foodVariety.maxBonus,
    config.foodVariety.bonusPerKind * (kinds.size - 1),
  )
  return config.needs.eatRestoreHunger * nutritionOf(config, kind) * (1 + bonus)
}

// In the hands, or close enough to put there in the same motion: once the hunger line started
// saying where the loaf was, `eat: not holding that` rose 2 → 18. Reaching for supper is not a turn.
function mealInHand(state: WorldState, agentId: string, itemId: string): Item | undefined {
  const item = state.items[itemId]
  if (!item) return undefined
  if (item.loc.t === 'agent') return item.loc.id === agentId ? item : undefined
  return itemWithinReach(state, agentId, item) ? item : undefined
}

const eat: VerbDef = makeVerb({
  kind: 'eat',
  validate(state, config, agentId, params) {
    const p = EatParams.safeParse(params)
    if (!p.success) return 'eating needs the food named'
    const item = state.items[p.data.itemId]
    if (!item) return 'not holding that'
    if (item.loc.t === 'agent' && item.loc.id !== agentId) return 'someone is holding that'
    if (mealInHand(state, agentId, p.data.itemId) === undefined) {
      return 'not holding that — go and stand beside it first'
    }
    if (!isFoodKind(config, item.kind)) return `${item.kind} is not food`
    return null
  },
  // The kind rides `action_completed`, which is what the fold counts the window by. It is
  // recorded before the belly fills, so the meal in hand counts toward its own variety.
  results(state, _config, agentId, params) {
    const p = EatParams.safeParse(params)
    const item = p.success ? mealInHand(state, agentId, p.data.itemId) : undefined
    return item === undefined ? {} : { kind: item.kind }
  },
  rngStream: 'illness',
  onComplete(state, config, agentId, params, rng) {
    const p = EatParams.parse(params)
    const item = mealInHand(state, agentId, p.itemId)
    if (item === undefined) return []
    // Drawn once, here at emission, and never when the meal is safe: a fresh loaf must not move
    // the stream, or two worlds that ate differently would diverge for no reason.
    const risky =
      config.mortality.enabled &&
      (item.kind === PALE_MUSHROOM || isSpoiling(state, item, config)) &&
      rng.next() < config.mortality.poisonChanceSpoiled
    return [
      // The hand closes before the mouth opens, and it closes exactly as `take` closes it.
      ...liftEvents(state, config, agentId, p.itemId),
      ...(risky
        ? [
            {
              type: 'agent_afflicted',
              payload: { agentId, kind: 'poison', severity: 1, itemId: p.itemId },
            },
          ]
        : []),
      ...(item.kind === HERB_KIND ? relieveWorst(state, agentId, config.mortality.herbRelief) : []),
      { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
      {
        type: 'needs_changed',
        payload: {
          id: agentId,
          changes: [{ need: 'hunger', delta: mealRestore(state, config, agentId, item.kind) }],
        },
      },
    ]
  },
})

export const TendParams = z.object({ targetId: z.string(), itemId: z.string().optional() }).strict()

// An hour, not a scribble: three ticks, the carving precedent.
const TEND_TICKS = 3

const tend: VerbDef = makeVerb({
  kind: 'tend',
  duration: () => TEND_TICKS,
  validate(state, config, agentId, params) {
    const p = TendParams.safeParse(params)
    if (!p.success) return 'tending needs someone to tend'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot tend yourself',
      gone: 'no one there to tend',
      far: 'not adjacent to the patient',
    })
    if (bad) return bad
    if (!sameInterior(state, agentId, p.data.targetId)) return 'a wall is in the way'
    const target = state.agents[p.data.targetId]!
    if (!target.ill && target.hp >= config.health.maxHp && (target.afflictions?.length ?? 0) === 0)
      return 'nothing to tend'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
      if (item.kind !== HERB_KIND) return `${item.kind} is not a remedy`
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TendParams.parse(params)
    const target = state.agents[p.targetId]
    const a = state.agents[agentId]!
    if (!target?.alive) return []
    if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) return []
    const item = p.itemId === undefined ? undefined : state.items[p.itemId]
    const offered = item?.kind === HERB_KIND && item.loc.t === 'agent' && item.loc.id === agentId
    return [
      {
        type: 'agent_tended',
        payload: {
          agentId: p.targetId,
          tenderId: agentId,
          ...(offered ? { itemId: p.itemId } : {}),
        },
      },
      // Given, not swallowed: the same leaf does twice as much in another body's hands.
      ...(offered
        ? [
            { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
            ...relieveWorst(state, p.targetId, config.mortality.herbRelief * 2),
          ]
        : []),
    ]
  },
  skill: { track: 'medicine', xp: 1 },
})

export const BUCKET_KIND = 'bucket'
export const VESSEL_KINDS: ReadonlySet<string> = new Set(['waterskin', BUCKET_KIND])
export const WELL_KIND = 'well'

export function waterWithinReach(state: WorldState, agentId: string): 'water_tile' | 'well' | null {
  const a = state.agents[agentId]!
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.terrain[a.y + dy]?.[a.x + dx]
      if (t !== undefined && isWet(t)) return 'water_tile'
    }
  }
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.kind === WELL_KIND && s.stage === 'complete' && isAdjacentToRect(a.x, a.y, s))
      return 'well'
  }
  return null
}

export const DrinkParams = z.object({ itemId: z.string().optional() }).strict()

const drink: VerbDef = makeVerb({
  kind: 'drink',
  validate(state, _config, agentId, params) {
    const p = DrinkParams.safeParse(params)
    if (!p.success) return 'drinking takes water at your side, or the vessel you name'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
      if (!VESSEL_KINDS.has(item.kind)) return 'nothing to drink from'
      if ((item.charges ?? 0) <= 0) return 'the skin is empty'
      return null
    }
    if (waterWithinReach(state, agentId) === null) return 'no water within reach'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = DrinkParams.parse(params)
    if (p.itemId !== undefined) {
      const item = state.items[p.itemId]
      if (item?.loc.t !== 'agent' || item.loc.id !== agentId || (item.charges ?? 0) <= 0) return []
      return [{ type: 'agent_drank', payload: { agentId, source: 'item', itemId: p.itemId } }]
    }
    const source = waterWithinReach(state, agentId)
    if (source === null) return []
    return [{ type: 'agent_drank', payload: { agentId, source } }]
  },
})

// A bucket carries one dose and it is heavy: it is the firefighting unit, not a canteen.
export const BUCKET_CHARGES = 1

export const FillParams = z.object({ itemId: z.string() }).strict()

const fill: VerbDef = makeVerb({
  kind: 'fill',
  validate(state, _config, agentId, params) {
    const p = FillParams.safeParse(params)
    if (!p.success) return 'filling needs the vessel named'
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!VESSEL_KINDS.has(item.kind)) return 'that holds no water'
    if (waterWithinReach(state, agentId) === null) return 'no water within reach'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = FillParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!VESSEL_KINDS.has(item.kind) || waterWithinReach(state, agentId) === null) return []
    const charges = item.kind === BUCKET_KIND ? BUCKET_CHARGES : config.thirst.waterskinCharges
    return [{ type: 'item_filled', payload: { itemId: p.itemId, charges } }]
  },
})

export const WearParams = z.object({ itemId: z.string() }).strict()

// `warmth.insulation` is the one table of what clothing is: a kind nobody can be warmed by is
// a kind nobody can wear.
export function isWearable(config: SimConfig, kind: string): boolean {
  return (config.warmth.insulation as Record<string, number | undefined>)[kind] !== undefined
}

const wear: VerbDef = makeVerb({
  kind: 'wear',
  validate(state, config, agentId, params) {
    const p = WearParams.safeParse(params)
    if (!p.success) return 'wearing needs the garment named'
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!isWearable(config, item.kind)) return 'that is not something you can wear'
    if (state.agents[agentId]!.equipped?.body !== undefined)
      return 'you are already wearing something'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = WearParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!isWearable(config, item.kind) || state.agents[agentId]!.equipped?.body !== undefined)
      return []
    return [{ type: 'item_equipped', payload: { agentId, itemId: p.itemId, slot: 'body' } }]
  },
})

const doff: VerbDef = makeVerb({
  kind: 'doff',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.equipped?.body === undefined
      ? 'you are not wearing anything'
      : null
  },
  onComplete(state, _config, agentId) {
    const itemId = state.agents[agentId]!.equipped?.body
    return itemId === undefined ? [] : [{ type: 'item_unequipped', payload: { agentId, itemId } }]
  },
})

export const KindleParams = z.object({ itemId: z.string() }).strict()
export const StokeParams = z.object({ structureId: z.string() }).strict()

// A light the world or a pair of hands stands, against one you carry — light.glowRadius answers both.
// CITY_HEARTH_KIND is named here because a hearth is a furnishing and has no structures.recipes row.
function isStandingLight(config: SimConfig, kind: string): boolean {
  return (
    isHeatSource(config, kind) ||
    kind === CITY_HEARTH_KIND ||
    config.structures.recipes[kind] !== undefined
  )
}

// A thing you can carry and set alight: it glows, and it does not stand.
export function isKindleable(config: SimConfig, kind: string): boolean {
  return glowRadiusFor(config, kind) !== undefined && !isStandingLight(config, kind)
}

// What is left in this torch: a full one has never been struck, a snuffed one remembers.
export function fuelLeft(item: { fuelTicks?: number }, config: SimConfig): number {
  return item.fuelTicks ?? config.light.torchBurnTicks
}

const kindle: VerbDef = makeVerb({
  kind: 'kindle',
  validate(state, config, agentId, params) {
    const p = KindleParams.safeParse(params)
    if (!p.success) return 'kindling needs the torch or lamp named'
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!isKindleable(config, item.kind)) return 'that will not take a flame'
    if (item.litUntilTick !== undefined) return 'it is already lit'
    if (fuelLeft(item, config) <= 0) return 'it is burnt out'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = KindleParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!isKindleable(config, item.kind) || item.litUntilTick !== undefined) return []
    const left = fuelLeft(item, config)
    if (left <= 0) return []
    return [{ type: 'item_lit', payload: { itemId: p.itemId, burnsUntilTick: state.tick + left } }]
  },
})

const snuff: VerbDef = makeVerb({
  kind: 'snuff',
  validate(state, _config, agentId, params) {
    const p = KindleParams.safeParse(params)
    if (!p.success) return 'snuffing needs the lit thing named'
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (item.litUntilTick === undefined) return 'it is not lit'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = KindleParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId || item.litUntilTick === undefined)
      return []
    return [{ type: 'item_snuffed', payload: { itemId: p.itemId } }]
  },
})

export const FUEL_KIND = 'wood'

// The wall half is `warmth`'s one derivation of reach; only the distance is this verb's own.
function atTheFire(state: WorldState, agentId: string, s: Structure): boolean {
  const a = state.agents[agentId]!
  if (!fireIsOnYourSide(a, s)) return false
  return inTheRoomWith(a, s) || nearRect(state, agentId, s.x, s.y, s.w, s.h)
}

// Feeding belongs to the glow table, not to warmth: a lamp is not a hearth. Asks
// structureGlowRadius, because a house glows with its hearth's reach and is not in the flat table.
export function isStokeable(config: SimConfig, kind: string): boolean {
  return structureGlowRadius(config, kind) !== undefined && isStandingLight(config, kind)
}

export function isRoofedFire(config: SimConfig, kind: string): boolean {
  return kind === CITY_HEARTH_KIND || (isHeatSource(config, kind) && isRoofedKind(config, kind))
}

const stoke: VerbDef = makeVerb({
  kind: 'stoke',
  validate(state, config, agentId, params) {
    const p = StokeParams.safeParse(params)
    if (!p.success) return 'stoking needs the fire named'
    const s = state.structures[p.data.structureId]
    if (!s || !isStokeable(config, s.kind)) return 'there is no fire there to feed'
    if (s.stage !== 'complete') return 'it is not finished'
    if (!atTheFire(state, agentId, s)) return 'not close enough to the fire'
    if (heldQty(state, agentId, FUEL_KIND) < 1) return shortOf(FUEL_KIND)
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = StokeParams.parse(params)
    const s = state.structures[p.structureId]
    if (!s || !isStokeable(config, s.kind) || heldQty(state, agentId, FUEL_KIND) < 1) return []
    return [
      ...consumeHeld(state, agentId, FUEL_KIND, 1),
      {
        type: 'structure_fueled',
        payload: {
          structureId: p.structureId,
          // Under a roof a fire burns an armful; in the open it is lit for the night and out at dawn.
          burnsUntilTick: isRoofedFire(config, s.kind)
            ? state.tick + config.light.fuelBurnTicks
            : nextDawnTick(state.tick),
        },
      },
    ]
  },
})

export const TileParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()
export const PlantParams = z
  .object({ x: z.number().int(), y: z.number().int(), kind: z.string() })
  .strict()
export const HarvestParams = z.object({ cropId: z.string() }).strict()

function tileAt(state: WorldState, x: number, y: number): TileId | null {
  return state.terrain[y]?.[x] ?? null
}

function withinReach(state: WorldState, agentId: string, x: number, y: number): boolean {
  const a = state.agents[agentId]!
  return Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1
}

export function skillLevel(
  state: WorldState,
  agentId: string,
  track: string,
  config: SimConfig,
): number {
  const xp = state.agents[agentId]!.skills[track] ?? 0
  return Math.min(config.skills.maxLevel, Math.floor(xp / config.skills.xpLevelDivisor))
}

const till: VerbDef = makeVerb({
  kind: 'till',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'tilling needs a patch of ground to break'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== 0 && tile !== 1) return 'only grass or dirt can be tilled'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to till'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TileParams.parse(params)
    return [
      {
        type: 'tile_changed',
        payload: {
          x: p.x,
          y: p.y,
          from: tileAt(state, p.x, p.y),
          to: 6,
          reason: 'tilled',
          byId: agentId,
        },
      },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

// Digging is slower than scratching a furrow: four ticks with a spade's worth of effort.
const DIG_CHANNEL_TICKS = 4

// Water only runs downhill from water. A channel spreads one tile at a time from the river
// or from what has already been cut, which is why irrigation is a project and not a wish.
const digChannel: VerbDef = makeVerb({
  kind: 'dig_channel',
  duration: () => DIG_CHANNEL_TICKS,
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'a channel needs a patch of ground to cut'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== 0 && tile !== 1) return 'only grass or dirt can be dug out'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to dig'
    const fed = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ].some(([dx, dy]) => {
      const t = tileAt(state, p.data.x + dx!, p.data.y + dy!)
      return t !== null && isWet(t)
    })
    if (!fed) return 'no water reaches here'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TileParams.parse(params)
    return [
      {
        type: 'tile_changed',
        payload: {
          x: p.x,
          y: p.y,
          from: tileAt(state, p.x, p.y),
          to: 10,
          reason: 'channel',
          byId: agentId,
        },
      },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

const plant: VerbDef = makeVerb({
  kind: 'plant',
  validate(state, config, agentId, params) {
    const p = PlantParams.safeParse(params)
    if (!p.success) return 'planting needs ground and a seed to sow'
    if (tileAt(state, p.data.x, p.data.y) !== 6) return 'crops need farmland'
    if (!config.crops[p.data.kind]) return `no such crop: ${p.data.kind}`
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to plant'
    for (const c of Object.values(state.crops)) {
      if (!c.withered && c.x === p.data.x && c.y === p.data.y) return 'that plot is already planted'
    }
    return null
  },
  onComplete(state, _config, _agentId, params) {
    const p = PlantParams.parse(params)
    const plantedDay = Math.floor(state.tick / MINUTES_PER_DAY)
    return [
      {
        type: 'crop_planted',
        payload: { id: mintId(state, 'crop'), kind: p.kind, x: p.x, y: p.y, plantedDay },
      },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

const harvest: VerbDef = makeVerb({
  kind: 'harvest',
  validate(state, config, agentId, params) {
    const p = HarvestParams.safeParse(params)
    if (!p.success) return 'harvesting needs the ripe plant named'
    const crop = state.crops[p.data.cropId]
    if (!crop) return 'no such crop'
    if (crop.withered) return 'the crop has withered'
    const def = config.crops[crop.kind]
    if (!def || crop.stage !== def.stages - 1) return 'not ripe yet'
    if (!withinReach(state, agentId, crop.x, crop.y)) return 'not close enough to harvest'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = HarvestParams.parse(params)
    const crop = state.crops[p.cropId]!
    const def = config.crops[crop.kind]!
    // Water near the roots is worth more than skill at the sickle: the ground decides the number.
    const qty = Math.floor(def.yield * fertilityAt(state.terrain, crop.x, crop.y, config))
    return [
      { type: 'crop_harvested', payload: { cropId: p.cropId } },
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: crop.kind,
          qty,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
          ...spoilageFor(state, crop.kind, config),
        },
      },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

// How far from the cast a school still counts as "where the fish are".
export const FISH_SCHOOL_RADIUS = 2

// First in id order, not nearest: the tie-break has to land the same way on every run.
export function schoolNear(
  state: WorldState,
  config: SimConfig,
  x: number,
  y: number,
): { id: string; stock: number } | null {
  if (!config.fauna.enabled) return null
  for (const id of Object.keys(state.fauna ?? {}).sort()) {
    const f = state.fauna![id]!
    if (f.kind !== 'fish' || !f.alive) continue
    if (Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) > FISH_SCHOOL_RADIUS) continue
    return { id, stock: f.stock ?? 1 }
  }
  return null
}

// The one derivation of a cast's odds: season and school multiply on top of skill, so winter's
// 0.5 and a school's 2x cancel to the plain-day chance.
export function fishCatchChance(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  x: number,
  y: number,
): number {
  const winter = simTimeFromTick(state.tick).season === 'winter'
  return (
    config.wildlife.fishCatchBase *
    (1 + skillLevel(state, agentId, 'fishing', config) / 10) *
    (winter ? config.seasons.winter.fishCatchMultiplier : 1) *
    (schoolNear(state, config, x, y) === null ? 1 : config.fauna.fishSchoolBonus)
  )
}

const fish: VerbDef = makeVerb({
  kind: 'fish',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'fishing needs the water to cast into'
    if (tileAt(state, p.data.x, p.data.y) !== 2) return 'no water there'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to the water'
    return null
  },
  onComplete(state, config, agentId, params, rng) {
    if (state.wildlife.fish <= 0) return []
    const p = TileParams.parse(params)
    const school = schoolNear(state, config, p.x, p.y)
    if (rng.next() >= fishCatchChance(state, config, agentId, p.x, p.y)) return []
    return [
      // A school is a place the fish are, not a second stock of them: both books move.
      ...(school === null
        ? []
        : [
            school.stock > 1
              ? { type: 'fauna_stock_changed', payload: { id: school.id, stock: school.stock - 1 } }
              : {
                  type: 'fauna_killed',
                  payload: { id: school.id, kind: 'fish', x: p.x, y: p.y, byId: agentId },
                },
          ]),
      { type: 'wildlife_changed', payload: { fish: state.wildlife.fish - 1 } },
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: FISH_KIND,
          qty: 1,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
          ...spoilageFor(state, FISH_KIND, config),
        },
      },
    ]
  },
  skill: { track: 'fishing', xp: 1 },
  rngStream: 'wildlife',
})

export const HuntParams = z.object({ faunaId: z.string() }).strict()

// What the world was authored with. A recipe may add to it and can never take from it, so a
// codified spear arrives without anybody re-authoring the knife.
export const WEAPON_KINDS: ReadonlySet<string> = new Set(['knife'])

// The one reader of the weapon list: the module's own kinds plus whatever a recipe row declares.
// `weaponKinds` is absent from every authored row, so at world defaults this is WEAPON_KINDS exactly.
export function weaponKindsFor(config: SimConfig): ReadonlySet<string> {
  const out = new Set(WEAPON_KINDS)
  for (const row of Object.values(config.crafting.recipes)) {
    for (const kind of row.weaponKinds ?? []) out.add(kind)
  }
  return out
}
// A school is not hunted; it is fished. These two are what a knife and a close approach can take.
export const HUNTABLE_KINDS: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['deer', 'rabbit'])

// Skill against the animal's difficulty: a novice takes one deer in four, and enough seasons at
// it make the approach certain. Rolled at emission from the `fauna` stream.
export function huntChance(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  kind: 'deer' | 'rabbit',
): number {
  const difficulty = config.fauna.huntDifficulty[kind]
  return Math.min(1, (1 + skillLevel(state, agentId, 'foraging', config)) / (1 + difficulty))
}

const hunt: VerbDef = makeVerb({
  kind: 'hunt',
  validate(state, config, agentId, params) {
    const p = HuntParams.safeParse(params)
    if (!p.success) return 'a hunt needs the animal named'
    const f = state.fauna?.[p.data.faunaId]
    if (!f?.alive) return 'nothing there to hunt'
    if (!HUNTABLE_KINDS.has(f.kind)) return 'that is not something you can run down'
    const a = state.agents[agentId]!
    if (Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) > 1) return 'too far off to reach'
    const weapons = weaponKindsFor(config)
    if (
      !Object.values(state.items).some(
        (i) => weapons.has(i.kind) && i.loc.t === 'agent' && i.loc.id === agentId,
      )
    )
      return 'you have nothing to hunt with'
    return null
  },
  onComplete(state, config, agentId, params, rng) {
    const p = HuntParams.parse(params)
    const f = state.fauna?.[p.faunaId]
    if (!f || !f.alive || !HUNTABLE_KINDS.has(f.kind)) return []
    const a = state.agents[agentId]!
    if (Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) > 1) return []
    if (rng.next() >= huntChance(state, config, agentId, f.kind as 'deer' | 'rabbit')) {
      const to = fleeTo(state, f.kind, f, a)
      if (to.x === f.x && to.y === f.y) return []
      return [{ type: 'fauna_moved', payload: { moves: [{ id: p.faunaId, x: to.x, y: to.y }] } }]
    }
    return [
      {
        type: 'fauna_killed',
        payload: { id: p.faunaId, kind: f.kind, x: f.x, y: f.y, byId: agentId },
      },
      ...FAUNA_YIELD[f.kind].map((y, i) => ({
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item', i),
          kind: y.kind,
          qty: y.qty,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
          ...spoilageFor(state, y.kind, config),
        },
      })),
    ]
  },
  skill: { track: 'foraging', xp: 1 },
  rngStream: 'fauna',
})

// An empty `{}` means "gather from the wood beside you".
export const ForageParams = z.object({ nodeId: z.string().optional() }).strict()

const forage: VerbDef = makeVerb({
  kind: 'forage',
  validate(state, _config, agentId, params) {
    const p = ForageParams.safeParse(params)
    if (!p.success) return 'foraging takes the patch you mean, or nothing at all'
    if (p.data.nodeId !== undefined) {
      const node = state.forageables?.[p.data.nodeId]
      if (!node) return 'nothing of the kind there'
      if (node.stock <= 0) return 'there is nothing left to take here'
      if (!withinReach(state, agentId, node.x, node.y)) {
        return `not close enough to gather — the patch is at (${node.x}, ${node.y}); stand beside it`
      }
      return null
    }
    const a = state.agents[agentId]!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(state, a.x + dx, a.y + dy) === 3) return null
      }
    }
    return 'no forest nearby — berries, mushrooms and herbs grow in patches, and a patch is gathered by name once you can see one'
  },
  onComplete(state, config, agentId, params) {
    const p = ForageParams.parse(params)
    if (p.nodeId !== undefined) {
      const node = state.forageables?.[p.nodeId]
      if (!node || node.stock <= 0) return []
      const kind = FORAGEABLE_YIELD[node.kind]
      return [
        node.stock > 1
          ? { type: 'forageable_stock_changed', payload: { id: p.nodeId, stock: node.stock - 1 } }
          : { type: 'forageable_depleted', payload: { id: p.nodeId } },
        {
          type: 'item_spawned',
          payload: {
            id: mintId(state, 'item'),
            kind,
            qty: 1,
            loc: { t: 'agent', id: agentId },
            ...ownerStamp(config, agentId),
            ...spoilageFor(state, kind, config),
          },
        },
      ]
    }
    const { season } = simTimeFromTick(state.tick)
    const qty = config.wildlife.forageYieldBySeason[season]
    if (qty <= 0) return []
    return [
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: FORAGE_KIND,
          qty,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
          ...spoilageFor(state, FORAGE_KIND, config),
        },
      },
    ]
  },
  skill: { track: 'foraging', xp: 1 },
})

// What you pull out of the ground, the water or the woods — or write down — is yours from the
// first moment. Making is making, whatever the hand does.
function ownerStamp(config: SimConfig, agentId: string): { owner?: string } {
  return config.ownership.enabled ? { owner: agentId } : {}
}

// A mark is a claim like any other, so it rides the same flag. Skill is read at
// craft time: the hand that was expert on the day is the hand the object remembers.
export function crafterStamp(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  track: string,
): { crafterMark?: string } {
  if (!config.ownership.enabled) return {}
  return skillLevel(state, agentId, track, config) >= config.crafting.expertLevel
    ? { crafterMark: agentId }
    : {}
}

// In a town, build takes {kind} only — strict, no x/y — so a coordinate is not a thing the act
// can be given. A world with no town (every fixture) has no lattice, and keeps the sited shape.
export const SitedBuildParams = z
  .object({ kind: z.string(), x: z.number().int(), y: z.number().int() })
  .strict()
export const PlottedBuildParams = z.object({ kind: z.string() }).strict()
/** The loose reader for the stages after `validate`, which has already judged the shape. */
export const BuildParams = z
  .object({
    kind: z.string(),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
  })
  .strict()
export const CraftParams = z.object({ recipe: z.string() }).strict()
export const ExtinguishParams = z.object({ structureId: z.string() }).strict()

const build: VerbDef = makeVerb({
  kind: 'build',
  validate(state, config, agentId, params) {
    const kind = (params as { kind?: unknown }).kind
    if (typeof kind !== 'string') return BUILD_NEEDS_A_THING_AND_A_PLACE
    if (buildableRecipe(config, kind) === null) return `cannot build a ${kind}`
    const plotted = buildIsPlotted(state, config, kind)
    const p = (plotted ? PlottedBuildParams : SitedBuildParams).safeParse(params)
    // ★ THE LOUD HALF. The prompt tells a mind that a roof goes where the town has ground for
    // it; a mind that names a coordinate anyway is told plainly that it does not get to.
    if (!p.success) {
      return plotted
        ? `where a ${words(kind)} stands is the town's to say, not yours — name the thing to raise and nothing else`
        : BUILD_NEEDS_A_THING_AND_A_PLACE
    }
    return buildSiteOf(state, config, agentId, p.data).refusal
  },
  duration(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    return (
      buildTicks(config, p.kind) -
      (buildSiteOf(state, config, agentId, p).resume?.progressTicks ?? 0)
    )
  },
  onStart(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    const recipe = buildableRecipe(config, p.kind)
    if (recipe === null) return []
    const answer = buildSiteOf(state, config, agentId, p)
    if (answer.resume !== null || answer.site === null) return []
    const { x, y, w, h, facing } = answer.site
    return [
      // The ground first: a roof cannot stand on a block the town has not cleared, and a door
      // cannot open onto a street nobody laid.
      ...answer.lay.map((t) => ({ type: 'tile_changed', payload: { ...t, byId: agentId } })),
      ...Object.entries(recipe.inputs).flatMap(([kind, qty]) =>
        consumeHeld(state, agentId, kind, qty),
      ),
      {
        type: 'structure_planned',
        payload: {
          id: mintId(state, 'structure'),
          kind: p.kind,
          x,
          y,
          w,
          h,
          maxHp: recipe.maxHp,
          flammable: recipe.flammable,
          builderId: agentId,
          ...(config.ownership.enabled ? { owner: agentId } : {}),
          // The plot decided this; nothing downstream should have to infer it back.
          ...(facing === undefined ? {} : { facing }),
        },
      },
    ]
  },
  onComplete(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    const site = buildSiteOf(state, config, agentId, p).resume
    return site ? [{ type: 'structure_completed', payload: { id: site.id } }] : []
  },
  skill: { track: 'carpentry', xp: 1 },
})

// How much of an input the hands hold, counting every member when the input is a canon class.
function heldForInput(state: WorldState, agentId: string, input: string): number {
  const members = classMembers(input)
  if (members === undefined) return heldQty(state, agentId, input)
  return members.reduce((sum, kind) => sum + heldQty(state, agentId, kind), 0)
}

// Spend an input, taking from the class members in kind order so two towns holding the same
// larder always cook the same pot.
function consumeForInput(
  state: WorldState,
  agentId: string,
  input: string,
  qty: number,
): PendingEvent[] {
  const members = classMembers(input)
  if (members === undefined) return consumeHeld(state, agentId, input, qty)
  const events: PendingEvent[] = []
  let left = qty
  for (const kind of [...members].sort()) {
    if (left <= 0) break
    const take = Math.min(heldQty(state, agentId, kind), left)
    if (take <= 0) continue
    events.push(...consumeHeld(state, agentId, kind, take))
    left -= take
  }
  return events
}

const heldWater = (state: WorldState, agentId: string) =>
  Object.values(state.items)
    .filter(
      (i) =>
        i.loc.t === 'agent' &&
        i.loc.id === agentId &&
        VESSEL_KINDS.has(i.kind) &&
        (i.charges ?? 0) > 0,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0]

// A fire somebody is feeding, within arm's reach of where the cooking happens — and a hearth
// somebody has fed is one, so a pot can finally go over a fire that is out of the weather.
function keptFireInReach(state: WorldState, config: SimConfig, agentId: string): boolean {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (!isHeatSource(config, s.kind) || s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? 0) <= state.tick) continue
    if (atTheFire(state, agentId, s)) return true
  }
  return false
}

// What stands between these hands and this recipe right now, or null when nothing does.
function craftRefusal(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  recipe: SeedRecipe,
): string | null {
  for (const [kind, qty] of Object.entries(recipe.inputs)) {
    if (heldForInput(state, agentId, kind) < qty) return shortOf(kind)
  }
  if (recipe.atFire && !keptFireInReach(state, config, agentId))
    return 'there is no fire lit here to cook on'
  if (recipe.water !== undefined && heldWater(state, agentId) === undefined)
    return 'you have no water to cook with'
  return null
}

// The first road whose inputs are all in hand. Refusal comes only when no road has them, and
// it is the road that was NAMED that speaks — the same shape as the build transpose fallback.
function chosenRoute(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  name: string,
): { recipe: SeedRecipe } | { refusal: string } {
  const routes = craftRoutes(config, name)
  // A refusal must leave a door open (addendum §9): not knowing a craft and
  // the craft not existing look the same from here, so name both ways out.
  if (routes.length === 0) {
    return {
      refusal: `no such recipe: ${name} — perhaps someone nearby knows how, or it wants discovering.`,
    }
  }
  let asNamed: string | null = null
  for (const recipe of routes) {
    const refusal = craftRefusal(state, config, agentId, recipe)
    if (refusal === null) return { recipe }
    asNamed ??= refusal
  }
  return { refusal: asNamed! }
}

const craft: VerbDef = makeVerb({
  kind: 'craft',
  validate(state, config, agentId, params) {
    const p = CraftParams.safeParse(params)
    if (!p.success) return 'crafting needs the thing to shape named'
    const route = chosenRoute(state, config, agentId, p.data.recipe)
    return 'refusal' in route ? route.refusal : null
  },
  onComplete(state, config, agentId, params) {
    const p = CraftParams.parse(params)
    const route = chosenRoute(state, config, agentId, p.recipe)
    if ('refusal' in route) return []
    const recipe = route.recipe
    const events: PendingEvent[] = []
    for (const [kind, qty] of Object.entries(recipe.inputs)) {
      if (heldForInput(state, agentId, kind) < qty) return []
      events.push(...consumeForInput(state, agentId, kind, qty))
    }
    if (recipe.atFire && !keptFireInReach(state, config, agentId)) return []
    if (recipe.water !== undefined) {
      const vessel = heldWater(state, agentId)
      if (vessel === undefined) return []
      events.push({
        type: 'item_filled',
        payload: { itemId: vessel.id, charges: Math.max(0, (vessel.charges ?? 0) - recipe.water) },
      })
    }
    return [
      ...events,
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: recipe.output.kind,
          qty: recipe.output.qty,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
          ...crafterStamp(state, config, agentId, recipe.skill),
          ...spoilageFor(state, recipe.output.kind, config),
        },
      },
      { type: 'skill_gained', payload: { agentId, track: recipe.skill, xp: 1 } },
    ]
  },
})

const extinguish: VerbDef = makeVerb({
  kind: 'extinguish',
  validate(state, _config, agentId, params) {
    const p = ExtinguishParams.safeParse(params)
    if (!p.success) return 'putting a fire out needs the burning thing named'
    const s = state.structures[p.data.structureId]
    if (!s) return 'no such structure'
    if (!s.burning) return 'not burning'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to the fire'
    return null
  },
  onComplete(state, _config, _agentId, params) {
    const p = ExtinguishParams.parse(params)
    if (!state.structures[p.structureId]?.burning) return []
    return [{ type: 'fire_extinguished', payload: { structureId: p.structureId, cause: 'doused' } }]
  },
})

export const STONE_KIND = 'stone'

// A road is not something the map has; it is something somebody carried stone for.
const pave: VerbDef = makeVerb({
  kind: 'pave',
  duration: (_state, config) => config.roads.paveDurationTicks,
  validate(state, config, agentId, params) {
    if (!config.roads.enabled) return 'your hands find no way to lay a road here'
    const p = TileParams.safeParse(params)
    if (!p.success) return 'paving needs the ground to lay stone on'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile === null || !isPaveable(tile)) return 'nothing to pave here'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to pave'
    if (heldQty(state, agentId, STONE_KIND) < config.roads.stonePerTile) return shortOf(STONE_KIND)
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TileParams.parse(params)
    const tile = tileAt(state, p.x, p.y)
    if (tile === null || !isPaveable(tile)) return []
    if (heldQty(state, agentId, STONE_KIND) < config.roads.stonePerTile) return []
    return [
      ...consumeHeld(state, agentId, STONE_KIND, config.roads.stonePerTile),
      {
        type: 'tile_changed',
        payload: { x: p.x, y: p.y, from: tile, to: T_ROAD, reason: 'paved', byId: agentId },
      },
    ]
  },
  skill: { track: 'masonry', xp: 1 },
})

// A sapling is not timber yet: clearing one costs the swing and yields nothing. Either way the
// ground goes back to grass, which is what makes the regrowth cycle a cycle and not an ornament.
export const CLEAR_TICKS = 4
export const FELL_TICKS = 30
export const TIMBER_PER_TREE = 2

const chop: VerbDef = makeVerb({
  kind: 'chop',
  duration(state, _config, _agentId, params) {
    const p = TileParams.parse(params)
    return tileAt(state, p.x, p.y) === T_FOREST ? FELL_TICKS : CLEAR_TICKS
  },
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'chopping needs the tree to fell'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile === null || !isWoody(tile)) return 'there is nothing standing there to cut'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to cut'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TileParams.parse(params)
    const tile = tileAt(state, p.x, p.y)
    if (tile === null || !isWoody(tile)) return []
    const cleared: PendingEvent = {
      type: 'tile_changed',
      payload: { x: p.x, y: p.y, from: tile, to: T_GRASS, reason: 'cleared', byId: agentId },
    }
    if (tile === T_SAPLING) return [cleared]
    return [
      cleared,
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: FUEL_KIND,
          qty: TIMBER_PER_TREE,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId),
        },
      },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

export const DouseParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()

// The burning structure whose footprint covers this tile, if one is alight there.
function burningAt(state: WorldState, x: number, y: number) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.burning && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s
  }
  return null
}

function heldBuckets(state: WorldState, agentId: string) {
  return heldStacks(state, agentId, BUCKET_KIND)
}

// One bucket, one dose, one tile of wall. Anything bigger than that is a bucket line, and a
// bucket line is a thing the town has to organise for itself.
const douse: VerbDef = makeVerb({
  kind: 'douse',
  validate(state, _config, agentId, params) {
    const p = DouseParams.safeParse(params)
    if (!p.success) return 'dousing needs the burning ground named'
    const s = burningAt(state, p.data.x, p.data.y)
    if (!s) return 'nothing is burning there'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to the fire'
    const buckets = heldBuckets(state, agentId)
    if (buckets.length === 0) return 'you have nothing to carry water in'
    if (!buckets.some((i) => (i.charges ?? 0) > 0)) return 'the bucket is empty'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = DouseParams.parse(params)
    const s = burningAt(state, p.x, p.y)
    const bucket = heldBuckets(state, agentId).find((i) => (i.charges ?? 0) > 0)
    if (!s || bucket === undefined) return []
    return [
      {
        type: 'fire_extinguished',
        payload: { structureId: s.id, cause: 'doused', x: p.x, y: p.y, agentId },
      },
      { type: 'item_filled', payload: { itemId: bucket.id, charges: 0 } },
    ]
  },
})

// A size bound, not a style rule: `speak` is the only verb whose text a listener's prompt
// interpolates, so an unbounded one is an unbounded prompt.
export const SpeakParams = z
  .object({ text: z.string().min(1).max(SPEECH_INPUT_MAX_CHARS) })
  .strict()
export const GiveParams = z.object({ itemId: z.string(), targetId: z.string() }).strict()
export const TakeParams = z.object({ itemId: z.string() }).strict()
export const DropParams = z.object({ itemId: z.string() }).strict()
export const WriteParams = z
  .object({ itemId: z.string().optional(), text: z.string().min(1) })
  .strict()
export const ReadParams = z.object({ itemId: z.string() }).strict()
export const TeachParams = z.object({ targetId: z.string(), track: z.string() }).strict()
export const AttackParams = z.object({ targetId: z.string() }).strict()

// One composer for both spoken paths, so a busy body's word and an idle one's cannot drift.
const spoken = (
  state: WorldState,
  config: SimConfig,
  agentId: string,
  params: Record<string, unknown>,
): PendingEvent[] => {
  const p = SpeakParams.parse(params)
  const a = state.agents[agentId]!
  // Sanitized where speech ENTERS the world, so the event log, the viewer and every listener
  // hold the same words. The render sanitizes again — old logs on disk carry raw text.
  const spoke = {
    type: 'agent_spoke',
    payload: {
      agentId,
      text: sanitizeSpokenText(p.text),
      x: a.x,
      y: a.y,
      ...(a.insideId === undefined ? {} : { insideId: a.insideId }),
    },
  }
  // A place named aloud is a place the room now knows of. Hearsay is how a town gets bigger
  // than any one pair of eyes.
  const told = placesNamedAloud(state, config, spoke.payload)
  return [spoke, ...told.map((t) => ({ type: 'places_seen', payload: t }))]
}

const speak: VerbDef = makeVerb({
  kind: 'speak',
  validate(_state, _config, _agentId, params) {
    const p = SpeakParams.safeParse(params)
    // Length is refused in the town's own words: the refusal becomes a memory the mind reads
    // back, and a schema's own words are our machinery talking where a body should be.
    if (!p.success) {
      const text: unknown = (params as { text?: unknown }).text
      if (typeof text === 'string' && text.length > SPEECH_INPUT_MAX_CHARS) {
        return 'that is more words than one breath holds'
      }
      return 'speaking needs words to say'
    }
    return null
  },
  atOnce: spoken,
  onComplete: spoken,
})

const give: VerbDef = makeVerb({
  kind: 'give',
  validate(state, _config, agentId, params) {
    const p = GiveParams.safeParse(params)
    if (!p.success) return 'giving needs the thing and the person to hand it to'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot give to yourself',
      gone: 'no one there to receive',
      far: 'not adjacent to give',
    })
    if (bad) return bad
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = GiveParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    const target = state.agents[p.targetId]
    if (!target?.alive) return []
    // The only voluntary transfer of title the world has.
    return [
      { type: 'item_moved', payload: { id: p.itemId, loc: { t: 'agent', id: p.targetId } } },
      ...(config.ownership.enabled
        ? [{ type: 'item_owner_changed', payload: { id: p.itemId, owner: p.targetId } }]
        : []),
    ]
  },
})

// Close enough to close a hand around. The one reach test `take` has always used, so a thing
// another verb reaches for is exactly the thing `take` would have handed it.
export function itemWithinReach(state: WorldState, agentId: string, item: Item): boolean {
  if (item.loc.t === 'agent') return false
  if (item.loc.t === 'tile') return withinReach(state, agentId, item.loc.x, item.loc.y)
  const s = state.structures[item.loc.id]
  return s !== undefined && nearRect(state, agentId, s.x, s.y, s.w, s.h)
}

// The lifting itself, so every verb that folds a taking into itself lifts the same way — the
// claim on an unowned thing, and the public record when the thing is somebody's.
function liftEvents(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  itemId: string,
): PendingEvent[] {
  const item = state.items[itemId]
  if (!item || item.loc.t === 'agent') return []
  const moved = { type: 'item_moved', payload: { id: itemId, loc: { t: 'agent', id: agentId } } }
  if (!config.ownership.enabled || item.owner === agentId) return [moved]
  // Unowned things are claimed by the hand that lifts them; owned things are not.
  // The engine blocks nothing here — it only makes sure the taking is public.
  if (item.owner === undefined) {
    return [moved, { type: 'item_owner_changed', payload: { id: itemId, owner: agentId } }]
  }
  const s = item.loc.t === 'structure' ? state.structures[item.loc.id] : undefined
  const at =
    item.loc.t === 'tile' ? { x: item.loc.x, y: item.loc.y } : { x: s?.x ?? 0, y: s?.y ?? 0 }
  return [
    moved,
    {
      type: 'item_taken',
      payload: { itemId, kind: item.kind, takerId: agentId, ownerId: item.owner, x: at.x, y: at.y },
    },
  ]
}

const take: VerbDef = makeVerb({
  kind: 'take',
  validate(state, _config, agentId, params) {
    const p = TakeParams.safeParse(params)
    if (!p.success) return 'taking needs the thing to lift'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.loc.t === 'agent')
      return item.loc.id === agentId ? 'already holding that' : 'someone is holding that'
    return itemWithinReach(state, agentId, item) ? null : 'not close enough to take'
  },
  onComplete(state, config, agentId, params) {
    return liftEvents(state, config, agentId, TakeParams.parse(params).itemId)
  },
})

// The mirror of `take`: onto the tile the body stands on, always within reach. Title is
// untouched — setting a thing down is not parting with it.
const drop: VerbDef = makeVerb({
  kind: 'drop',
  validate(state, _config, agentId, params) {
    const p = DropParams.safeParse(params)
    if (!p.success) return 'setting a thing down needs the thing named'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.loc.t !== 'agent') return 'that is already on the ground'
    if (item.loc.id !== agentId) return 'someone is holding that'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = DropParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    const a = state.agents[agentId]!
    return [{ type: 'item_moved', payload: { id: p.itemId, loc: { t: 'tile', x: a.x, y: a.y } } }]
  },
})

export const StowParams = z.object({ itemId: z.string(), structureId: z.string() }).strict()

const stow: VerbDef = makeVerb({
  kind: 'stow',
  validate(state, _config, agentId, params) {
    const p = StowParams.safeParse(params)
    if (!p.success) return 'stowing needs the thing and the store to leave it in'
    const item = state.items[p.data.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to put it in'
    if (s.stage !== 'complete') return 'it is not finished'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return a.insideId === s.id ? null : 'a wall is in the way'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h))
      return 'not close enough to put anything down there'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = StowParams.parse(params)
    const item = state.items[p.itemId]
    if (item?.loc.t !== 'agent' || item.loc.id !== agentId) return []
    // A shelf is not a transfer: the owner is unchanged, wherever the thing sits.
    return [
      { type: 'item_moved', payload: { id: p.itemId, loc: { t: 'structure', id: p.structureId } } },
    ]
  },
})

export const INSCRIPTION_MAX_CHARS = 280
export const InscribeParams = z
  .object({
    structureId: z.string(),
    text: z.string().min(1).max(INSCRIPTION_MAX_CHARS),
  })
  .strict()

// Writing on something nobody can pocket. Three ticks, because carving is not scribbling.
const inscribe: VerbDef = makeVerb({
  kind: 'inscribe',
  validate(state, config, agentId, params) {
    if (!config.inscription.enabled) return 'your hands find no way to mark this'
    const p = InscribeParams.safeParse(params)
    if (!p.success)
      return `marking needs the thing to mark and words of 1 to ${INSCRIPTION_MAX_CHARS} characters`
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to mark'
    if (s.stage !== 'complete') return 'it is not finished'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return a.insideId === s.id ? null : 'a wall is in the way'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to mark it'
    return null
  },
  duration() {
    return 3
  },
  onComplete(state, _config, agentId, params) {
    const p = InscribeParams.parse(params)
    if (!state.structures[p.structureId]) return []
    return [
      {
        type: 'structure_inscribed',
        payload: { structureId: p.structureId, text: p.text, agentId },
      },
    ]
  },
})

const write: VerbDef = makeVerb({
  kind: 'write',
  validate(state, _config, agentId, params) {
    const p = WriteParams.safeParse(params)
    if (!p.success) return 'writing needs words to set down'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (!item) return 'no such item'
      if (item.kind !== 'note') return 'not a note'
      if (item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = WriteParams.parse(params)
    if (p.itemId !== undefined) {
      const item = state.items[p.itemId]
      if (item?.kind !== 'note' || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
      return [{ type: 'item_text_changed', payload: { id: p.itemId, text: p.text } }]
    }
    return [
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'),
          kind: 'note',
          qty: 1,
          loc: { t: 'agent', id: agentId },
          text: p.text,
          ...ownerStamp(config, agentId),
        },
      },
    ]
  },
})

const read: VerbDef = makeVerb({
  kind: 'read',
  validate(state, _config, agentId, params) {
    const p = ReadParams.safeParse(params)
    if (!p.success) return 'reading needs the writing named'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.kind !== 'note') return 'there is nothing to read'
    if (item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    return null
  },
  onComplete() {
    return []
  },
  results(state, _config, _agentId, params) {
    const p = ReadParams.parse(params)
    return { text: state.items[p.itemId]?.text ?? '' }
  },
})

const teach: VerbDef = makeVerb({
  kind: 'teach',
  validate(state, config, agentId, params) {
    const p = TeachParams.safeParse(params)
    if (!p.success) return 'teaching needs someone to teach and a craft to pass on'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot teach yourself',
      gone: 'no one there to teach',
      busy: 'they are busy',
      far: 'not adjacent to teach',
    })
    if (bad) return bad
    if (!config.skills.tracks.includes(p.data.track)) return `no such skill: ${p.data.track}`
    if ((state.agents[agentId]!.skills[p.data.track] ?? 0) === 0) return 'nothing to teach'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TeachParams.parse(params)
    const target = state.agents[p.targetId]
    if (!target?.alive) return []
    const teacherXp = state.agents[agentId]!.skills[p.track] ?? 0
    const grant = Math.min(teacherXp * 0.1, 50)
    return [{ type: 'skill_gained', payload: { agentId: p.targetId, track: p.track, xp: grant } }]
  },
  skill: { track: 'scholarship', xp: 1 },
})

// The affliction is the only thing that carries the hand behind the blow — without it `slain` is
// a word DEATH_CAUSES holds and the world can never produce.
const INJURY_SEVERITY: Readonly<Record<'minor' | 'serious' | 'grave', number>> = {
  minor: 1,
  serious: 2,
  grave: 3,
}

const attack: VerbDef = makeVerb({
  kind: 'attack',
  validate(state, _config, agentId, params) {
    const p = AttackParams.safeParse(params)
    if (!p.success) return 'a blow needs someone to strike'
    return adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot attack yourself',
      gone: 'no one there to attack',
      far: 'not adjacent to attack',
    })
  },
  onComplete(state, config, agentId, params, rng) {
    const p = AttackParams.parse(params)
    const a = state.agents[agentId]!
    const t = state.agents[p.targetId]
    if (!t?.alive) return []
    if (Math.abs(a.x - t.x) > 1 || Math.abs(a.y - t.y) > 1) return []
    const maxPower = 2 * config.health.maxHp
    const scoreA = rng.next() * ((a.hp + a.needs.energy) / maxPower)
    const scoreB = rng.next() * ((t.hp + t.needs.energy) / maxPower)
    const margin = Math.abs(scoreA - scoreB)
    const loserId = scoreA < scoreB ? agentId : p.targetId
    const kind = margin < 0.2 ? 'minor' : margin < 0.5 ? 'serious' : 'grave'
    const winnerId = loserId === agentId ? p.targetId : agentId
    // Each of the three is owned by exactly one event: agent_harmed is the only one that says a
    // hand was behind it, agent_injured records the wound, and the affliction starts the clock.
    return [
      {
        type: 'agent_harmed',
        payload: {
          agentId: loserId,
          amount: config.health.injuryDamage[kind],
          source: 'attack',
          byId: winnerId,
        },
      },
      { type: 'agent_injured', payload: { agentId: loserId, kind } },
      {
        type: 'agent_afflicted',
        payload: {
          agentId: loserId,
          kind: 'injury',
          severity: INJURY_SEVERITY[kind],
          sourceId: winnerId,
        },
      },
    ]
  },
  rngStream: 'combat',
})

const experiment: VerbDef = makeVerb({
  kind: 'experiment',
  validate() {
    return 'You lack the knowledge to attempt this. Perhaps someone in the town knows how.'
  },
  onComplete() {
    return []
  },
})

export const VERBS: Record<string, VerbDef> = {
  walk,
  sleep,
  wake,
  enter,
  exit,
  eat,
  tend,
  till,
  plant,
  harvest,
  fish,
  forage,
  build,
  craft,
  extinguish,
  drink,
  fill,
  dig_channel: digChannel,
  douse,
  pave,
  hunt,
  wear,
  doff,
  kindle,
  snuff,
  stoke,
  chop,
  speak,
  give,
  take,
  drop,
  stow,
  write,
  read,
  inscribe,
  teach,
  attack,
  experiment,
}

// Hot-registration seam: codified recipe verbs join the live registry by kind id.
export function registerVerb(def: VerbDef): void {
  if (VERBS[def.kind]) throw new Error(`already registered: ${def.kind}`)
  VERBS[def.kind] = def
}

export function unregisterVerb(kind: string): void {
  delete VERBS[kind] // eslint-disable-line @typescript-eslint/no-dynamic-delete -- a registry key removal
}

/** On a plot there is no coordinate to look the walls up by, so it is the walls this body began
 *  or the neighbour's it is standing at; a bridge is looked up by the water it was named on. */
function siteOfBuild(state: WorldState, agentId: string): Structure | null {
  const act = state.agents[agentId]?.activity
  if (act?.verb !== 'build') return null
  const p = BuildParams.safeParse(act.params)
  if (!p.success) return null
  return p.data.x === undefined || p.data.y === undefined
    ? siteToRaise(state, agentId, p.data.kind)
    : siteAt(state, p.data.x, p.data.y)
}

/** An ACTIVITY is asked for, not a body: dying and collapsing both null the activity, so a
 *  liveness test here would be a condition nothing can satisfy. */
export function handsOnSite(state: WorldState, siteId: string): number {
  let n = 0
  for (const id of Object.keys(state.agents)) {
    if (siteOfBuild(state, id)?.id === siteId) n++
  }
  return n
}

// One tick of an in-progress build: the agent works, the site advances in step.
export function stepBuild(state: WorldState, config: SimConfig, agentId: string): PendingEvent[] {
  const a = state.agents[agentId]
  const act = a?.activity
  if (!a || act?.verb !== 'build')
    throw new Error(`stepBuild: agent ${agentId} has no build in progress`)
  const p = BuildParams.parse(act.params)
  const site = siteOfBuild(state, agentId)
  if (!site) return [{ type: 'action_interrupted', payload: { agentId, reason: 'gone' } }]
  // Every hand on the site adds one to the walls, so each builder's clock loses `hands` — that
  // keeps ticksRemaining === durationTicks - progressTicks however many arrive or leave.
  const hands = handsOnSite(state, site.id)
  // workPenalty lengthens a night builder's clock without slowing the walls, so the ledger ran
  // past durationTicks in the dark and read back as a negative duration when the build resumed.
  const left = buildTicks(config, p.kind) - site.progressTicks
  const events: PendingEvent[] = [{ type: 'action_progressed', payload: { agentId, ticks: hands } }]
  if (left > 0) events.push({ type: 'structure_progressed', payload: { id: site.id, ticks: 1 } })
  return events
}

// One tick of an in-progress walk: action_progressed, one agent_moved per tile crossed, or a lone action_interrupted {blocked}.
export function stepWalk(state: WorldState, agentId: string): PendingEvent[] {
  const a = state.agents[agentId]
  const act = a?.activity
  if (!a || act?.verb !== 'walk' || !act.path)
    throw new Error(`stepWalk: agent ${agentId} has no walk in progress`)
  const done = act.path.findIndex(([x, y]) => x === a.x && y === a.y) + 1
  const tilesLeft = act.path.length - done
  // Spread what is left over the ticks that are left, so the legs land on the last tile exactly
  // when the clock runs out however the two were nudged apart.
  const stride = Math.min(tilesLeft, Math.ceil(tilesLeft / act.ticksRemaining))
  const moves: PendingEvent[] = []
  for (let i = 0; i < stride; i++) {
    const [nx, ny] = act.path[done + i]!
    if (!isPassable(state, nx, ny)) break
    moves.push({ type: 'agent_moved', payload: { id: agentId, x: nx, y: ny } })
  }
  if (moves.length === 0) {
    return [{ type: 'action_interrupted', payload: { agentId, reason: 'blocked' } }]
  }
  return [{ type: 'action_progressed', payload: { agentId, ticks: 1 } }, ...moves]
}

// Their surface stays part of `verbs`.
export * from '../food.js'
export * from './craft.js'
export * from './nightWork.js'
export {
  buildFootprint,
  buildIsPlotted,
  buildSiteOf,
  groundForBuilding,
  isPlottedKind,
  unfinishedWork,
  type BuildSiteAnswer,
  type StandingWalls,
} from './build.js'
export { isAdjacentToRect, type PendingEvent } from './common.js'
