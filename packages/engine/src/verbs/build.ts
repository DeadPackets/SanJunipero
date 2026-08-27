import { doorTile } from '../interiors.js'
import { BRIDGE_KIND, bridgeAt, isPassable } from '../path.js'
import { type Structure, type WorldState } from '../state.js'
import { claimInWorld, layBlock, townSquareOf, type TileChange } from '../town.js'
import { heldQty, nearRect, siteAt } from './common.js'
import { buildTicks, buildableRecipe, shortOf } from './craft.js'
import { isTravelled, isWet, type SimConfig, type TownFacing } from '@sj/shared'

/** Absent means this. The same convention `forge/buildingArt.facingKind` uses for a cell id. */
const DEFAULT_TOWN_FACING: TownFacing = 'sw'

function buildableGroundRefusal(
  state: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (!isPassable(state, x + dx, y + dy)) return 'cannot build there'
    }
  }
  return null
}

// A bank is anything that is not open water — or a deck already laid over it.
function banked(state: WorldState, x: number, y: number): boolean {
  const tile = state.terrain[y]?.[x]
  if (tile === undefined) return false
  return !isWet(tile) || bridgeAt(state, x, y)
}

// Two or three tiles of deck, every one over water, with a foot on solid ground at each end.
// The span is the RECIPE's shape, so this bounds a dial and not a constant: the shipped bridge is 1x2.
const BRIDGE_SPAN = { min: 2, max: 3 }

function bridgeSiteRefusal(
  state: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  const span = w === 1 ? h : h === 1 ? w : 0
  if (span < BRIDGE_SPAN.min || span > BRIDGE_SPAN.max) return 'no bridge that shape will stand'
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = state.terrain[y + dy]?.[x + dx]
      if (tile === undefined || !isWet(tile)) return 'a bridge belongs over water'
      if (bridgeAt(state, x + dx, y + dy)) return 'that spot is taken'
    }
  }
  const ends =
    w === 1
      ? [
          { x, y: y - 1 },
          { x, y: y + h },
        ]
      : [
          { x: x - 1, y },
          { x: x + w, y },
        ]
  if (!ends.every((e) => banked(state, e.x, e.y))) return 'both ends must reach something solid'
  return null
}

type BuildSite = { kind: string; x: number; y: number }

// Every structure makes its tiles impassable, so a post raised in the street would close the
// street. Only a sited kind can be aimed at a road, so only a sited one is asked.
function roadBlockRefusal(
  state: WorldState,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  if (kind === BRIDGE_KIND) return null // a deck IS the way across; it opens ground, never closes it
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = state.terrain[y + dy]?.[x + dx]
      if (tile !== undefined && isTravelled(tile)) {
        return `that would stand in the way — the ${words(kind)} goes on the ground beside the way, not on it`
      }
    }
  }
  return null
}

// Everything about a site that depends on how big the thing standing on it is.
function footprintRefusal(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  d: BuildSite,
  w: number,
  h: number,
): string | null {
  const recipe = buildableRecipe(config, d.kind)!
  if (!nearRect(state, agentId, d.x, d.y, w, h))
    return `not close enough to build — stand within reach of (${d.x}, ${d.y})`
  const site = siteAt(state, d.x, d.y)
  if (site?.kind === d.kind) return null // resume: materials already spent
  for (const s of Object.values(state.structures)) {
    if (d.x < s.x + s.w && s.x < d.x + w && d.y < s.y + s.h && s.y < d.y + h)
      return 'that spot is taken'
  }
  const ground =
    d.kind === BRIDGE_KIND
      ? bridgeSiteRefusal(state, d.x, d.y, w, h)
      : buildableGroundRefusal(state, d.x, d.y, w, h)
  if (ground) return ground
  const blocked = roadBlockRefusal(state, d.kind, d.x, d.y, w, h)
  if (blocked) return blocked
  for (const a of Object.values(state.agents)) {
    if (a.alive && a.x >= d.x && a.x < d.x + w && a.y >= d.y && a.y < d.y + h)
      return 'someone is in the way'
  }
  for (const [kind, qty] of Object.entries(recipe.inputs)) {
    if (heldQty(state, agentId, kind) < qty) return shortOf(kind)
  }
  return null
}

// A recipe's w and h are a shape, not a compass bearing. As written wins; the turned reading is
// tried only when the written one refuses, and a refusal always uses the written one's words.
export function buildFootprint(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  d: BuildSite,
): { w: number; h: number; refusal: string | null } {
  const { w, h } = buildableRecipe(config, d.kind)!
  const written = footprintRefusal(state, config, agentId, d, w, h)
  if (written === null || w === h) return { w, h, refusal: written }
  const turned = footprintRefusal(state, config, agentId, d, h, w)
  return turned === null ? { w: h, h: w, refusal: null } : { w, h, refusal: written }
}

/** A mass stands where the town decides; a sited thing belongs to a spot somebody picked and says
 *  so in its recipe. bridgeSiteRefusal stays the bridge's alone: the water rule is not every sited kind's. */
export const isPlottedKind = (config: SimConfig, kind: string): boolean =>
  config.structures.recipes[kind]?.sited !== true

/** Whether THIS world seats THIS kind on a plot. It takes a town to seat one. */
export function buildIsPlotted(state: WorldState, config: SimConfig, kind: string): boolean {
  return isPlottedKind(config, kind) && townSquareOf(state) !== null
}

/** The site this agent already has half-raised, so an interrupted build goes back to the same
 *  walls. Keyed on the BUILDER, because on a plot there is no coordinate to look one up by. */
function ownSite(state: WorldState, agentId: string, kind: string) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.stage === 'construction' && s.kind === kind && s.builtBy === agentId) return s
  }
  return null
}

/** Somebody else's walls, within reach, keyed on the GROUND — without it claimInWorld hands the
 *  second body the next FREE plot and five bodies raise five houses. Plots are four tiles apart, so there is never a choice. */
function joinableSite(state: WorldState, agentId: string, kind: string): Structure | null {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (
      s.stage === 'construction' &&
      s.kind === kind &&
      nearRect(state, agentId, s.x, s.y, s.w, s.h)
    )
      return s
  }
  return null
}

/** Its own half-finished walls first, then a neighbour's within reach, and only then new ground.
 *  ownSite is asked first, so joinableSite is never looking at walls this body began. */
export function siteToRaise(state: WorldState, agentId: string, kind: string) {
  return ownSite(state, agentId, kind) ?? joinableSite(state, agentId, kind)
}

export type BuildSiteAnswer = {
  /** `facing` rides along ONLY when the plot turned the building — absent is `sw`, and a
   *  bridge has no door and no facing at all. */
  site: { x: number; y: number; w: number; h: number; facing?: TownFacing } | null
  /** The standing construction this build continues, if any: its materials are already spent. */
  resume: { id: string; progressTicks: number } | null
  /** The ground the town must lay before anything can stand here — empty when it already has. */
  lay: TileChange[]
  refusal: string | null
}

export const words = (kind: string): string => kind.replace(/_/g, ' ')

/** On a plot, nothing about the asker reaches the site: claimInWorld decides it and params are
 *  not consulted. The refusal names the place to walk to rather than offering nothing. */
export function buildSiteOf(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  params: { kind: string; x?: number | undefined; y?: number | undefined },
): BuildSiteAnswer {
  const key = `${agentId}|${params.kind}|${params.x ?? ''}|${params.y ?? ''}`
  const hit = siteMemo.get(state)
  if (hit?.config === config && hit.key === key) return hit.answer
  const answer = computeBuildSite(state, config, agentId, params)
  siteMemo.set(state, { config, key, answer })
  return answer
}

// One build intent asks this from `validate`, `duration` and `onStart` over the same immutable
// world, and each answer costs a claim search of the whole lattice.
const siteMemo = new WeakMap<
  WorldState,
  { config: SimConfig; key: string; answer: BuildSiteAnswer }
>()

function computeBuildSite(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  params: { kind: string; x?: number | undefined; y?: number | undefined },
): BuildSiteAnswer {
  const recipe = buildableRecipe(config, params.kind)!
  if (!buildIsPlotted(state, config, params.kind)) {
    if (params.x === undefined || params.y === undefined) {
      return { site: null, resume: null, lay: [], refusal: `build needs {kind, x, y}` }
    }
    const d = { kind: params.kind, x: params.x, y: params.y }
    const { w, h, refusal } = buildFootprint(state, config, agentId, d)
    const at = siteAt(state, d.x, d.y)
    return {
      site: { x: d.x, y: d.y, w, h },
      resume:
        at !== null && at.kind === d.kind ? { id: at.id, progressTicks: at.progressTicks } : null,
      lay: [],
      refusal,
    }
  }
  const square = townSquareOf(state)!
  const mine = siteToRaise(state, agentId, params.kind)
  const claim = claimInWorld(state, { along: recipe.w, deep: recipe.h })
  const raising =
    mine === null
      ? null
      : {
          x: mine.x,
          y: mine.y,
          w: mine.w,
          h: mine.h,
          ...(mine.facing === undefined ? {} : { facing: mine.facing }),
        }
  if (claim === null) {
    return {
      site: raising,
      resume: null,
      lay: [],
      refusal: `there is nowhere left in the town for a ${words(params.kind)}`,
    }
  }
  const site = raising ?? {
    ...claim.site,
    ...(claim.facing === DEFAULT_TOWN_FACING ? {} : { facing: claim.facing }),
  }
  // The town lays the block the first time somebody builds on it; "off the map" is loud because a
  // plot silently withheld for want of a bigger world is the ring-1 clamp all over again.
  const lay = layBlock(state, square, claim.block)
  if (lay === 'off the map') {
    return {
      site,
      resume: null,
      lay: [],
      refusal: `the ground a ${words(params.kind)} needs is past the edge of the known country`,
    }
  }
  const resume = mine === null ? null : { id: mine.id, progressTicks: mine.progressTicks }
  // The door tile, not the corner of the footprint: a road, passable, and adjacent to every mass
  // the plot can hold. The same number groundForBuilding puts in the perception.
  const go = `go and stand at (${claim.door.x}, ${claim.door.y})`
  if (!nearRect(state, agentId, site.x, site.y, site.w, site.h)) {
    return {
      site,
      resume,
      lay,
      refusal: `the town keeps ground for a ${words(params.kind)} — ${go}`,
    }
  }
  return {
    site,
    resume,
    lay,
    refusal: resume !== null ? null : plottedRefusal(state, config, agentId, params.kind, site, go),
  }
}

/** The next free plot's street corner; every plot holds every legal mass, so one answer serves
 *  every buildable kind. Free ground is only half of "where does work go" — unfinishedWork is the rest. */
export function groundForBuilding(state: WorldState): { x: number; y: number } | null {
  return claimInWorld(state, { along: 1, deep: 1 })?.door ?? null
}

/** Walls that already stand, unfinished, and the tile a body reaches them from. Nearest first,
 *  ties by id. Only kinds a pair of hands can carry on: naming a wall nobody can finish is worse than silence. */
export type StandingWalls = {
  id: string
  kind: string
  at: { x: number; y: number }
  done: number
  needs: number
}

export function unfinishedWork(
  state: WorldState,
  config: SimConfig,
  from: { x: number; y: number },
): StandingWalls | null {
  let best: StandingWalls | null = null
  let bestDist = Infinity
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.stage !== 'construction' || buildableRecipe(config, s.kind) === null) continue
    const needs = buildTicks(config, s.kind)
    if (needs <= 0) continue
    const door = doorTile(state, s)
    const at = door ?? { x: s.x, y: s.y + s.h }
    const d = Math.abs(at.x - from.x) + Math.abs(at.y - from.y)
    if (d >= bestDist) continue
    bestDist = d
    best = { id: s.id, kind: s.kind, at, done: Math.min(s.progressTicks, needs), needs }
  }
  return best
}

/** Everything that can still be wrong once the town has named the ground. */
function plottedRefusal(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  kind: string,
  site: { x: number; y: number; w: number; h: number },
  go: string,
): string | null {
  const ground = buildableGroundRefusal(state, site.x, site.y, site.w, site.h)
  if (ground) return ground
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue
    if (a.x < site.x || a.x >= site.x + site.w || a.y < site.y || a.y >= site.y + site.h) continue
    // A body inside the footprint would be walled in by its own walls. Standing ON the ground
    // is the near miss the door tile exists to prevent, so that refusal points at the door.
    return a.id === agentId
      ? `you are standing on the ground itself — ${go}`
      : 'someone is in the way'
  }
  for (const [k, qty] of Object.entries(buildableRecipe(config, kind)!.inputs)) {
    if (heldQty(state, agentId, k) < qty) return shortOf(k)
  }
  return null
}
