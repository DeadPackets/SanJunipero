// Founders dev world script: the five approved founders walk the town among the
// approved building set. Deterministic (no Math.random) — same laws as the engine's
// scripted module: policies are pure functions of perception, timeline is tick-keyed.
//
// ★ SCRIPTED, NOT EMERGENT — and the line matters enough to draw it here rather than leave it
// to be inferred. Everything these five decide is written below in plain `if`s: where to walk,
// when to go to bed, what to raise. They are demonstration puppets. Whether a MIND chooses any
// of it is C8's rehearsal to answer, and nothing measured in this file is evidence about that.
// What IS real is the seam underneath — every decision here goes through `submitIntent` and
// the engine's own verbs under the engine's own refusals, so a thing that works for a puppet
// works for a mind, and a thing that is refused here is refused there.
//
// ★ AND HOW A TIRED BODY DECIDES, BECAUSE IT USED TO GET THIS WRONG AND THE WHOLE CAST WENT
// DOWN IN THE STREET. Two rules, both of them the live mind runtime's, restated for a puppet:
//
//   A. A BODY DECIDES ONLY WHEN ITS HANDS ARE FREE. `agentRuntime.#submitPendingIfIdle` holds a
//      mind's intent until `self.activity` is null and the turn prose tells it so in words
//      ("your hands are already busy … it will finish before anything else can begin"). This
//      script re-decided and re-SUBMITTED every tick instead, and `submitIntent` refuses every
//      intent while an activity is running. So the decision to rest was made, refused
//      `already busy with walk`, and thrown on the floor — measured at 166 consecutive times
//      per founder on the first night, until the collapse itself broke the lock.
//   B. A JOURNEY IS COSTED BEFORE IT IS BEGUN, and a body that can no longer afford to walk
//      anywhere lies down where it is. Nothing priced a walk before, so a founder set out on a
//      342-tick leg with 30 energy in the legs and fell over 200 ticks short of the door.
//
// Neither is a dial. `walkEnergyCost` is the world's own path, the world's own tiles-per-tick
// and the world's own decay, multiplied.
import { doorFrontTile, type SimConfig } from '@sj/shared'
import {
  BRIDGE_KIND, awakeEnergyDecay, bridgeAt, buildSiteOf, buildTicks, claimInWorld,
  composePerception, createWorldTick, doorTile, findPath, isAdjacentToRect, submitIntent,
  type PerceptionPacket, type RngStreams, type Structure, type WorldState,
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
  { id: 'omar', name: 'Omar', ageDays: 24 * 364, spawn: { x: 6, y: 32 }, patrol: [{ x: 6, y: 32 }, { x: 20, y: 23 }] },
  { id: 'amara', name: 'Amara', ageDays: 35 * 364, spawn: { x: 21, y: 23 }, patrol: [{ x: 21, y: 23 }, { x: 31, y: 23 }] },
  { id: 'yusuf', name: 'Yusuf', ageDays: 55 * 364, spawn: { x: 34, y: 24 }, patrol: [{ x: 34, y: 24 }, { x: 24, y: 21 }] },
  { id: 'nadia', name: 'Nadia', ageDays: 26 * 364, spawn: { x: 26, y: 20 }, patrol: [{ x: 26, y: 20 }, { x: 16, y: 28 }] },
  { id: 'salma', name: 'Salma', ageDays: 45 * 364, spawn: { x: 28, y: 26 }, patrol: [{ x: 28, y: 26 }, { x: 28, y: 18 }] },
]

export type TownStructure = { id: string; kind: string; x: number; y: number; w: number; h: number }

// the approved building set, placed complete on day 0 (this is an art-showcase town)
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
  ...s, owner: null, facing: 'sw' as const, flammable: s.kind !== 'standing_stone',
}))

/** 'scripted' keeps the frozen G6 fixture set; 'showcase' serves the town the roads were drawn
 *  for. `rings` only means anything to the showcase — the scripted fixture is frozen by the
 *  gate hashes and has no grammar to grow. */
export function townStructuresFor(map: DevMapKind, rings?: number): readonly DevStructure[] {
  return map === 'showcase' ? devTown(undefined, rings).structures : SCRIPTED_STRUCTURES
}

// ── WHAT THE BUILDINGS HOLD ────────────────────────────────────────────────────────────────
//
// The dev world stored ZERO items in ANY structure, so the room card's holdings grid, its
// icons, its cap and its "and N more" line had never once rendered against data. This is a
// demo town's larder — DEV FIXTURE DATA (P20), like the founders themselves — and it is off
// unless asked for, so every landed gate folds exactly the world it always did.

export type DevHolding = { id: string; kind: string; qty: number; structureId: string; owner: string | null }

/** Deliberately past the card's eight-row cap, so the "and N more" line is a thing a viewer
 *  can actually see. Every kind is a library entry, so every row resolves a real icon. */
const STOREHOUSE_STOCK: ReadonlyArray<readonly [string, number]> = [
  ['wheat_sheaf', 12], ['bread', 6], ['fish', 4], ['berries', 9], ['timber', 15], ['stone', 11],
  ['rope', 3], ['cloth', 5], ['fiber', 7], ['charcoal', 2], ['hide', 2], ['clay', 6],
]
const SHED_STOCK: ReadonlyArray<readonly [string, number]> = [
  ['axe', 1], ['saw', 1], ['hammer', 1], ['gravel', 8], ['timber', 4],
]
/** A home holds a household's things, not a warehouse's — three kinds and few of each. */
const HOUSE_STOCK: ReadonlyArray<readonly [string, number]> = [
  ['bread', 2], ['waterskin', 1], ['herb_bundle', 3],
]

const STOCK_FOR: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  storehouse: STOREHOUSE_STOCK, shed: SHED_STOCK, house: HOUSE_STOCK,
}

/**
 * Pure and deterministic: same structures in, byte-equal holdings out. Ids carry the kind
 * rather than a number, because `fold` advances the world's entity counter off any id that
 * ends in one and a fixture must never move the counter a minted id reads.
 */
export function devHoldings(structures: readonly DevStructure[]): DevHolding[] {
  const out: DevHolding[] = []
  for (const s of structures) {
    for (const [kind, qty] of STOCK_FOR[s.kind] ?? []) {
      out.push({ id: `item_${s.id}_${kind}`, kind, qty, structureId: s.id, owner: s.owner })
    }
  }
  return out
}

// The one dwelling in the fixture town — where a tired founder goes when interiors are on.
export const FOUNDERS_HOME_ID = 'structure_house'
// How tired you have to be to want your own bed. WHEN to set out is a different question and
// the walk answers it — see `homeIntent`. The old note here said "measured over 5500 dev ticks,
// no founder ever sleeps or collapses out of doors", and it was true of the 64×64 FIXTURE it
// was taken on. On the showcase town all five were on the ground by Day 0 17:02.
export const GO_HOME_BELOW = 25
export const LEAVE_HOME_ABOVE = 80
// RE-MEASURED (showcase, rings=3, 4320 ticks, interiors on): the five first go indoors at ticks
// 814 / 827 / 853 / 866 / 970 and make 21 indoor trips over three sim days. Zero collapses,
// zero afflictions, zero deaths, every one of them on 100 hp at the end. Start just under the
// earliest of those and the walk home is the first thing a viewer sees.
export const DEV_FAST_FORWARD_FOR_INTERIORS = 810

export const NEED_TOPUP_BELOW = 40
export const HUNGER_TOPUP = 55
export const WARMTH_TOPUP = 50

export type Intent = { verb: string; params: Record<string, unknown> }
const SLEEP: Intent = { verb: 'sleep', params: {} }

/** Below this, the patrol would rather nap than take another turn about the town. A preference,
 *  not a physics number — what stops a body walking past the floor is `arrivesStanding`. */
export const PATROL_SLEEP_BELOW = 20

/**
 * ★ WHAT A WALK COSTS THIS BODY, out of the world's own numbers and nothing else: the real
 * path the legs would take, the tiles-per-tick the world charges, and `awakeEnergyDecay`.
 * `null` when there is no path at all.
 *
 * ★ PRICED AT THE TIRED RATE, ALWAYS, and this is the part that is easy to get wrong.
 * `ticksPerTile` DOUBLES the moment any need drops under `debuffThreshold`, so a body fresh
 * enough to set out is charged single rate for a journey it will finish at double — which
 * under-prices exactly the journeys that matter, the long ones taken late. Both of the config's
 * own two numbers exist; the walk is quoted at the worse of them.
 */
export function walkEnergyCost(
  state: WorldState, config: SimConfig, agentId: string, to: { x: number; y: number },
): number | null {
  const a = state.agents[agentId]
  if (a === undefined) return null
  const at = { x: a.x, y: a.y }
  if (at.x === to.x && at.y === to.y) return 0
  const path = findPath(state, at, to, config)
  if (path === null) return null
  const tired = Math.max(config.movement.baseTicksPerTile, config.movement.debuffTicksPerTile)
  return path.length * tired * awakeEnergyDecay(config, a)
}

/** Can this body walk there and still be standing when it arrives? The reserve is the collapse
 *  floor itself — arriving at exactly the floor is arriving face-down. */
export function arrivesStanding(
  state: WorldState, config: SimConfig, agentId: string, to: { x: number; y: number },
): boolean {
  const cost = walkEnergyCost(state, config, agentId, to)
  const a = state.agents[agentId]
  if (cost === null || a === undefined) return false
  return a.needs.energy - cost > config.needs.collapseThreshold
}

/** What `ticks` of standing up and working costs a body. The same law as `walkEnergyCost`,
 *  asked of work rather than of walking: a house is 240 ticks of swinging a hammer and the
 *  body is charged for every one of them. */
export function workEnergyCost(state: WorldState, config: SimConfig, agentId: string, ticks: number): number | null {
  const a = state.agents[agentId]
  return a === undefined ? null : ticks * awakeEnergyDecay(config, a)
}

// ── THE MASON ──────────────────────────────────────────────────────────────────────────────
//
// ★ WHAT IS SCRIPTED HERE, AND WHAT IS EMPHATICALLY NOT.
//
// SCRIPTED: the DECISION to build. A founder with hands free and energy to spare raises a
// house, every time, because a demonstration surface has to demonstrate. Whether a MIND would
// choose to build is the open question C8's rehearsal exists to answer, and nothing this
// policy does is evidence about it. Do not quote a house count from the dev world as emergence.
//
// NOT SCRIPTED, and the whole reason this exists: WHERE the house goes. Nobody in this file
// names a coordinate for a roof and nobody CAN — in a town, `build` validates against
// `PlottedBuildParams`, a strict Zod object of `{ kind }` with no x and no y in it, and the
// site is `claimInWorld`'s answer: a function of the square, everything standing and the
// recipe's mass, and of nothing the asker said. This is the identical seam `townGrowth.test.ts`
// and `farBank.test.ts` prove on engine fixtures, reached for the first time from the running
// app. The claim seam made naming a coordinate unrepresentable; this does not smuggle one back.
//
// The only thing the policy computes is where to STAND: `claim.door`, the tile on the street
// the new frontage will face, which is the tile the builder has to be on to begin.

/** The one thing the dev masons raise. A dwelling, so the town it grows is a town of homes. */
export const MASON_KIND = 'house'
/** The mass of it. `claimInWorld` answers for a rectangle, not for a kind. */
const MASON_NEED = { along: 2, deep: 2 }
/** SCRIPTED SUPPLY, said out loud — the same device as the need top-ups above and the same
 *  device the two engine proofs use. This is a demo town with no economy in it, so a mason out
 *  of timber is handed more. It changes how OFTEN a house goes up and nothing whatever about
 *  WHERE: the site is settled before `footprintRefusal` ever looks at materials. */
export const MASON_WOOD_KIND = 'wood'

export function heldWood(state: WorldState, agentId: string): number {
  let n = 0
  for (const i of Object.values(state.items)) {
    if (i.kind === MASON_WOOD_KIND && i.loc.t === 'agent' && i.loc.id === agentId) n += i.qty
  }
  return n
}

/** The whole errand: the walk out to the ground, and the raising once you are on it. `null`
 *  when there is no way to reach the ground at all. */
export function masonErrandCost(
  state: WorldState, config: SimConfig, agentId: string, claim: { door: { x: number; y: number } },
): number | null {
  const out = walkEnergyCost(state, config, agentId, claim.door)
  const work = workEnergyCost(state, config, agentId, config.construction.houseTicks)
  return out === null || work === null ? null : out + work
}

/** Stand at the ground the town keeps, then raise a roof on it. `null` when the town has
 *  nowhere left for a house of this mass, or when this body cannot pay for the errand.
 *
 *  `lendHands` OFF is the landed policy exactly. It is off by default because of what the run
 *  measures, not because of what it shows: see `jointBuild` on `FoundersOpts`. */
export function masonIntent(
  state: WorldState, config: SimConfig, agentId: string, lendHands = false,
): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined || a.insideId !== undefined) return null
  // ★ HANDS ALREADY AT SOMEBODY'S WALLS LEND THEM, AND THIS IS NOT A COORDINATE EITHER.
  // Two masons sent to the same plot arrive a few ticks apart; the loser used to be told the
  // ground was taken and walk to the next plot, so a town of five raised five houses one pair
  // of hands at a time. The ENGINE decides which walls — `buildSiteOf` answers `resume` from
  // where this body is standing — and the ask is still `{kind}` with no x and no y in it.
  const join = lendHands ? buildSiteOf(state, config, agentId, { kind: MASON_KIND }).resume : null
  if (join !== null) {
    // Only the work that is LEFT: a joiner has no walk to pay for and no fresh house to raise.
    const left = workEnergyCost(state, config, agentId, buildTicks(config, MASON_KIND) - join.progressTicks)
    return left !== null && a.needs.energy - left > GO_HOME_BELOW
      ? { verb: 'build', params: { kind: MASON_KIND } }
      : null
  }
  const claim = claimInWorld(state, MASON_NEED)
  if (claim === null) return null
  const errand = masonErrandCost(state, config, agentId, claim)
  // ★ AND THE RESERVE FOR WORK IS BEDTIME, NOT THE FLOOR. Going home is the last thing a body
  // does, so `arrivesStanding` rightly measures it against the collapse threshold. Taking on a
  // day's work is a CHOICE, and a body does not choose an errand it will finish face-down.
  // Measured with the floor as the bar: four masons finished a roof, walked home on the last of
  // it, and went down on the tick they lay in their own bed at energy 4.9. Arriving home merely
  // ready for bed is the same sentence the rest of this policy already speaks.
  if (errand === null || a.needs.energy - errand <= GO_HOME_BELOW) return null
  return isAdjacentToRect(a.x, a.y, claim.site)
    ? { verb: 'build', params: { kind: MASON_KIND } }   // ★ {kind} ONLY. No x. No y.
    : { verb: 'walk', params: { x: claim.door.x, y: claim.door.y } }
}

// ── THE BRIDGEWRIGHT ───────────────────────────────────────────────────────────────────────
//
// ★ THIS ONE IS HANDED ITS COORDINATE, AND THAT IS THE HONEST DESCRIPTION OF IT.
//
// A bridge is the one kind the verb still takes an x and a y for, because the WATER decides
// where a deck can stand and no town can claim a plot on it (`isPlottedKind`). And far-bank's
// C-1 stands untouched: nothing gives a MIND a reason to bridge while the near bank has room
// for hundreds. So this is a demonstration puppet walking to a crossing somebody else found —
// exactly what `farBank.test.ts` does with `DECK`, said out loud in the same words.
//
// What is NOT scripted is whether the crossing is real. The site comes from `showcaseDeck`,
// which is derived from the ford the map lays, and `devBridge.test.ts` asks the ENGINE — every
// water tile in the channel, through `buildSiteOf` — which sites it accepts. Take the ford
// away and the sweep finds nothing, the walk finds no path to the spit, and no deck stands.

/** The first founder is the wright: with the same cast in the same order, deterministically. */
export const bridgewrightOf = (cast: readonly FounderDef[]): string | null => cast[0]?.id ?? null

/** Walk to the far end of the crossing, then lay the deck. `null` once a deck is standing, or
 *  when this body cannot pay for the errand — a wright who falls in the river builds nothing. */
export function bridgewrightIntent(
  state: WorldState, config: SimConfig, agentId: string,
  deck: { x: number; y: number; w: number; h: number },
): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined || a.insideId !== undefined) return null
  if (bridgeAt(state, deck.x, deck.y)) return null
  // The spit at the far end of the deck — the one tile beside the crossing a body can stand on.
  const stand = { x: deck.x + deck.w, y: deck.y }
  const out = walkEnergyCost(state, config, agentId, stand)
  const work = workEnergyCost(state, config, agentId, config.structures.recipes[BRIDGE_KIND]?.durationTicks ?? 0)
  if (out === null || work === null || a.needs.energy - (out + work) <= GO_HOME_BELOW) return null
  return isAdjacentToRect(a.x, a.y, deck)
    ? { verb: 'build', params: { kind: BRIDGE_KIND, x: deck.x, y: deck.y } }
    : { verb: 'walk', params: stand }
}

// patrol like the G2 idler: ping-pong between two fixed waypoints, sleep when spent — and
// never set out on a leg the legs cannot pay for (rule B in the header).
function makePatrolPolicy(f: FounderDef) {
  const [a, b] = f.patrol
  return (state: WorldState, config: SimConfig, p: PerceptionPacket): Intent | null => {
    if (p.self.body.needs.energy < PATROL_SLEEP_BELOW) return SLEEP
    const dest = p.self.x === a.x && p.self.y === a.y ? b : a
    if (!arrivesStanding(state, config, f.id, dest)) return SLEEP
    return { verb: 'walk', params: { x: dest.x, y: dest.y } }
  }
}

export type FoundersOnTick = (ctx: { tick: number; emit: (type: string, payload: unknown) => void }) => void

export type FoundersOpts = {
  /** dev/demo only: a tired founder walks home, goes in, sleeps, and comes out again.
   *  OFF by default, so every existing gate folds exactly the events it always did. */
  interiors?: boolean
  /** The town to raise on tick 1. Defaults to the frozen scripted fixture, so every existing
   *  caller and every existing test folds exactly the world it always did. */
  structures?: readonly DevStructure[]
  /** Who to spawn and where. Defaults to the landed FOUNDERS spawns. */
  founders?: readonly FounderDef[]
  /** dev/demo only: the buildings start with something in them, so the room card's holdings
   *  grid renders against data. OFF by default — every existing gate folds what it always did. */
  holdings?: boolean
  /** dev/demo only: the founders raise houses on plots the town claims for them, through the
   *  real `build` verb with `{kind}` and no coordinate. OFF by default — every existing gate
   *  folds exactly the events it always did, and the frozen fixture has no lattice to build on. */
  builders?: boolean
  /** dev/demo only: the crossing one founder lays a deck over before it joins the masons.
   *  ABSENT by default — a world with no ford has nowhere to put one, and every existing gate
   *  folds exactly the events it always did. */
  deck?: { x: number; y: number; w: number; h: number }
  /** dev/demo only: a mason who finds itself beside somebody's half-raised walls lends a hand
   *  instead of walking to the next plot.
   *
   *  ★ OFF BY DEFAULT, AND THE REASON IS A NUMBER, NOT A TASTE. It works — five pairs of hands
   *  on one house, measured — but a building completes off the BUILDER's activity clock and
   *  not off the site's `progressTicks`, so the extra hands buy no calendar time at all. Over
   *  4 320 showcase ticks: 29 roofs at 293 body-ticks each with it off, 16 at 591 with it on.
   *  The world can count hands now; it still cannot spend them. */
  jointBuild?: boolean
}

/** The house this person owns, or null. Ownership is a fact of the world (Structure.owner) —
 *  this reads it, it does not invent it. */
export function homeOf(state: WorldState, agentId: string): Structure | null {
  for (const s of Object.values(state.structures)) {
    if (s.owner === agentId && s.stage === 'complete') return s
  }
  return null
}

/** The tile you stand on to draw water: the town's public well, the one thing every ring count
 *  puts in the middle of the paved square. `null` on a town that has no well — the frozen
 *  fixture, which keeps its own waypoints untouched. */
function wellsideTile(structures: readonly DevStructure[]): { x: number; y: number } | null {
  const well = structures.find((s) => s.kind === 'well')
  if (well === undefined) return null
  const d = doorFrontTile({
    kind: well.kind, dx: well.x, dy: well.y, w: well.w, h: well.h,
    facing: well.facing, owner: null, furnishings: [],
  })
  return { x: d.dx, y: d.dy }
}

/** Showcase spawns: each founder starts at their own door, so the first frame reads as a town
 *  of five households rather than five strangers on a lawn. */
export function foundersFor(structures: readonly DevStructure[]): readonly FounderDef[] {
  const byOwner = new Map(structures.filter((s) => s.owner !== null).map((s) => [s.owner!, s]))
  const wellside = wellsideTile(structures)
  return FOUNDERS.map((f) => {
    const home = byOwner.get(f.id)
    if (home === undefined) return f
    // The tile the door opens onto, on the face the building presents — the same tile engine
    // `doorTile` picks, because both now answer "the street this building fronts". Computing
    // the south-centre by hand was right only while every building faced one way.
    const d = doorFrontTile({
      kind: home.kind, dx: home.x, dy: home.y, w: home.w, h: home.h,
      facing: home.facing, owner: null, furnishings: [],
    })
    const spawn = { x: d.dx, y: d.dy }
    // ★ BOTH ENDS OF THE PATROL MOVE INTO THIS TOWN, OR NEITHER MOVES. This used to relocate
    // the spawn into the showcase town and leave the far waypoint at its 64×64 FIXTURE
    // coordinate — omar walking to (20, 23), which on a 152×152 map is 162 tiles away across
    // ground he has nothing to do with. MEASURED, door to waypoint: 118/124/156/162/171 tiles
    // against 14/18/53/54/58 on the fixture the numbers were written for. That length is what
    // made a leg outlast the legs. A townsperson's errand is the well and back — 18 to 39.
    return { ...f, spawn, patrol: [spawn, wellside ?? f.patrol[1]] as FounderDef['patrol'] }
  })
}

// Walking home is a whole errand, so it is decided from world state rather than from the
// patrol packet: the door tile, the distance to it and `insideId` are all facts of the world.
export function homeIntent(state: WorldState, config: SimConfig, agentId: string): Intent | null {
  const a = state.agents[agentId]
  if (a === undefined) return null
  if (a.insideId !== undefined) {
    return a.needs.energy > LEAVE_HOME_ABOVE ? { verb: 'exit', params: {} } : SLEEP
  }
  // An unhoused person keeps the landed behaviour and heads for the shared roof; an owner goes
  // to their own. Nobody is left with nowhere to sleep.
  const home = homeOf(state, agentId) ?? state.structures[FOUNDERS_HOME_ID] ?? null
  const door = home === null ? null : doorTile(state, home)
  if (door === null || home === null) return null
  if (Math.abs(a.x - door.x) <= 1 && Math.abs(a.y - door.y) <= 1) {
    return a.needs.energy < GO_HOME_BELOW ? { verb: 'enter', params: { structureId: home.id } } : null
  }
  // ★ WHEN TO TURN FOR HOME IS THE JOURNEY'S QUESTION, NOT A NUMBER'S. `GO_HOME_BELOW` says how
  // tired you have to be to want your own bed; the walk says how early you have to leave to get
  // there. Asking only the first sent a founder home from the far side of town with 24 energy
  // and a 31-energy walk in front of them, which is a decision to fall over in the street.
  const cost = walkEnergyCost(state, config, agentId, door)
  if (cost === null) return a.needs.energy < GO_HOME_BELOW ? SLEEP : null
  if (a.needs.energy - cost >= GO_HOME_BELOW) return null   // slack left in the day; carry on
  return a.needs.energy - cost > config.needs.collapseThreshold
    ? { verb: 'walk', params: { x: door.x, y: door.y } }
    // ★ THE DEADLOCK BREAKER. Too late to walk anywhere: this body's night is wherever it is
    // standing. Without this line `homeIntent` answered a collapsed body with a WALK for ever —
    // and `submitIntent` refuses every verb but eat and sleep to a body on the ground, so
    // nothing ever offered the one verb that could have got it up again.
    : SLEEP
}

export function makeFoundersOnTick(
  config: SimConfig, rng: RngStreams, getState: () => WorldState, opts: FoundersOpts = {},
): FoundersOnTick {
  const cast = opts.founders ?? FOUNDERS
  const wright = opts.deck === undefined ? null : bridgewrightOf(cast)
  const policies = new Map(cast.map(f => [f.id, makePatrolPolicy(f)]))
  const worldTick = createWorldTick(config, rng)
  const structures = opts.structures ?? SCRIPTED_STRUCTURES
  return ({ tick, emit }) => {
    if (tick === 1) {
      for (const f of cast) {
        emit('agent_spawned', { id: f.id, name: f.name, x: f.spawn.x, y: f.spawn.y, ageDays: f.ageDays })
      }
      for (const s of structures) {
        // `owner` rides along only when there is one, so the scripted fixture's payload is
        // byte-identical to the one every landed gate already folded.
        emit('structure_planned', {
          id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, maxHp: 20,
          flammable: s.flammable, builderId: 'script',
          ...(s.owner === null ? {} : { owner: s.owner }),
          // The template already decided this; dropping it made the drawn face of half the
          // town disagree with the plot it sits on. Absent is `sw`, so the frozen fixture —
          // every one of whose six buildings faces sw — folds the payload it always folded.
          ...(s.facing === 'sw' ? {} : { facing: s.facing }),
        })
        emit('structure_completed', { id: s.id })
      }
      if (opts.holdings === true) {
        for (const h of devHoldings(structures)) {
          emit('item_spawned', {
            id: h.id, kind: h.kind, qty: h.qty,
            ...(h.owner === null ? {} : { owner: h.owner }),
            loc: { t: 'structure', id: h.structureId },
          })
        }
      }
    }

    const result = worldTick(getState())
    for (const e of result.events) emit(e.type, e.payload)

    // scripted need top-ups keep the showcase town alive without a food economy
    for (const f of cast) {
      const a = getState().agents[f.id]
      if (!a || !a.alive) continue
      if (a.needs.hunger < NEED_TOPUP_BELOW) emit('need_changed', { id: f.id, need: 'hunger', delta: HUNGER_TOPUP })
      if (a.needs.warmth < NEED_TOPUP_BELOW) emit('need_changed', { id: f.id, need: 'warmth', delta: WARMTH_TOPUP })
      // Scripted timber, on the same footing and for the same declared reason. The id never
      // ends in a digit, because `fold` advances the world's entity counter off any that does.
      if ((opts.builders === true || f.id === wright) && a.activity === null
        && heldWood(getState(), f.id) < (config.structures.recipes[MASON_KIND]?.inputs[MASON_WOOD_KIND] ?? 0)) {
        emit('item_spawned', {
          id: `item_${MASON_WOOD_KIND}_${f.id}_${tick}_load`, kind: MASON_WOOD_KIND,
          qty: config.structures.recipes[MASON_KIND]?.inputs[MASON_WOOD_KIND] ?? 0,
          loc: { t: 'agent', id: f.id },
        })
      }
    }

    for (const f of cast) {
      const state = getState()
      const a = state.agents[f.id]
      if (!a || !a.alive) continue
      // ★ RULE A: DECIDE ONLY WHEN THE HANDS ARE FREE. `submitIntent` refuses everything while
      // an activity runs, so a decision taken here used to be a decision discarded. Skipping is
      // event-identical to submitting-and-being-refused — a refusal emits nothing — which is
      // why every landed gate folds exactly the world it always did.
      if (a.activity) continue
      const packet = composePerception(state, config, f.id, [])
      // The order of a day: rest first, then the crossing, then work, then walk the town. Home
      // comes before either because a body that is spent has no business starting anything, and
      // the deck comes before the houses because until it stands half the town is unreachable.
      const intent = (opts.interiors === true ? homeIntent(state, config, f.id) : null)
        ?? (f.id === wright ? bridgewrightIntent(state, config, f.id, opts.deck!) : null)
        ?? (opts.builders === true ? masonIntent(state, config, f.id, opts.jointBuild === true) : null)
        ?? policies.get(f.id)!(state, config, packet)
      if (!intent) continue
      const r = submitIntent(state, config, f.id, intent.verb, intent.params)
      if (r.ok) for (const e of r.events) emit(e.type, e.payload)
    }
  }
}
