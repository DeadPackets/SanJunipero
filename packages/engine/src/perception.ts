import {
  isBeddedKind,
  isHearthKind,
  isRoofedKind,
  isTravelled,
  lightBandAt,
  sanitizeSpokenText,
  simTimeFromTick,
  visionRadiusAt,
  type SimConfig,
  type SimEvent,
  type SimTime,
} from '@sj/shared'
import { FORAGEABLE_PROSE } from './data/forageables.js'
import { MYSTERY_BY_KIND } from './data/mysteries.js'
import { hears } from './earshot.js'
import { doorTile, insideOf, roomIsFull } from './interiors.js'
import { effectiveConfig } from './laws.js'
import { isPassable, pathCtx } from './path.js'
import {
  placeName,
  thirstOf,
  type AfflictionKind,
  type AgentBody,
  type Item,
  type Structure,
  type WorldState,
} from './state.js'
import { ageBand, type AgeBand } from './systems/aging.js'
import { sexOf } from './systems/reproduction.js'
import { isSpoiling } from './systems/spoilage.js'
import {
  buildTicks,
  isAdjacentToRect,
  itemWithinReach,
  isMapRim,
  walkIsCapped,
  workPenalty,
} from './verbs/index.js'

// A pure projection of what one agent can sense: it never mutates state and never draws
// randomness, so identical inputs produce bit-identical packets.

export type SelfBody = {
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number
  injuries: { kind: 'minor' | 'serious' | 'grave'; day: number }[]
  ill: boolean
  thirst: number // always a number here: absence is a storage fact, not something a body feels
  // A body knows what ails it and how badly. It does not know the tick it fell ill.
  afflictions: { kind: AfflictionKind; severity: number }[]
}

export type PerceivedAgent = {
  id: string
  name: string
  x: number
  y: number
  activityVerb: string | null
  collapsed: boolean
  asleep: boolean
  ageBand: AgeBand // a face carries no birthday, but it does carry this much
  // What the body has on, as it looks from across the square. Absent on bare shoulders, so a
  // town that has sewn nothing reads exactly as it always did, and never a number.
  worn?: string
  // Absent on a well body, so a healthy town reads exactly as it always did — and never a number.
  // The packet carries the phrase, because the phrase is what a pair of eyes actually gets.
  condition?: string
} & Markings

// Tags a minted verb left, readable by anyone who can see the thing. Absent when unmarked.
export type Markings = { marks?: Record<string, string> }

// How a worn thing reads to whoever is looking. The forageable-prose precedent: the packet
// carries the phrase, because the phrase is what a pair of eyes actually gets.
export const WORN_PROSE: Readonly<Record<string, string>> = {
  garment: 'wrapped in a rough cloak',
}

export function wornProse(state: WorldState, agentId: string): string | undefined {
  const itemId = state.agents[agentId]?.equipped?.body
  const kind = itemId === undefined ? undefined : state.items[itemId]?.kind
  return kind === undefined ? undefined : WORN_PROSE[kind]
}

// What ails a body, as it shows from across the square: a town whose healer cannot see a fever
// six tiles away tends nobody.
export const CONDITION_PROSE: Readonly<Record<AfflictionKind, string>> = {
  illness: 'flushed with fever',
  poison: 'grey-faced and doubled over',
  injury: 'favouring a hurt',
  fatigue: 'grey with a tiredness sleep has not lifted',
}

const HURT_SHARE = 0.3
const GAUNT_HUNGER = 5

// One phrase, worst thing first: an affliction outranks a wound, and a wound outranks an
// empty belly. Absent when there is nothing to see.
export function conditionProse(
  state: WorldState,
  config: SimConfig,
  agentId: string,
): string | undefined {
  const a = state.agents[agentId]
  if (!a?.alive) return undefined
  const worst = [...(a.afflictions ?? [])].sort(
    (p, q) => q.severity - p.severity || (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : 0),
  )[0]
  if (worst !== undefined) return CONDITION_PROSE[worst.kind]
  if (a.ill) return CONDITION_PROSE.illness
  if (a.hp < config.health.maxHp * HURT_SHARE) return 'badly hurt'
  if (a.needs.hunger < GAUNT_HUNGER) return 'hollowed out with hunger'
  return undefined
}

// Both fields absent on a blank wall. `door` is the tile `enter` measures against — absent on a
// kind with no way in, on a building still going up, and on one nothing passable rings.
export type PerceivedStructure = {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  burning: boolean
  stage: 'construction' | 'complete'
  hasInscription?: true
  inscription?: { text: string; by: string }
  door?: { x: number; y: number }
  // Said before the walk: a mind refused at the door has already spent the turn. Present only
  // alongside `door`, and only when no more fit.
  full?: true
  // Present only while a thing is going up. Nothing in the packet had ever said a half-raised
  // wall was a place work could go, and five founders raised five houses and finished none.
  raised?: { done: number; needs: number }
  // Only on a finished building of a kind that has one; lit only while somebody is feeding it.
  // Table, chair and rug are absent on purpose: a word with no verb behind it only buys refusals.
  hearth?: 'lit' | 'cold'
  // A body has to tell a room it will sleep WELL in from a room with a floor BEFORE it walks
  // there; being told at the door is a turn already spent. Absent on a kind with no bed.
  bed?: true
} & Markings

// Whose it is, and whose hands made it — the two things prose needs to say
// "Rahel's basket" or "a chair bearing Yusuf's mark". Absent when unclaimed.
export type OwnerNames = { ownerName?: string; crafterMarkName?: string }

// Absent unless the thing is on its last day, so a packet full of fresh food reads as it always did.
export type Turning = { spoiling?: true }

export type PerceivedItem = {
  id: string
  kind: string
  qty: number
  x: number
  y: number
} & OwnerNames &
  Turning &
  Markings

export type InventoryItem = Item & OwnerNames & Turning

export type PerceivedCrop = {
  id: string
  kind: string
  x: number
  y: number
  stage: number
  withered: boolean
}

// A shape at a distance: what kind of animal and where. Never how many are in the school.
export type PerceivedFauna = { id: string; kind: string; x: number; y: number }

// What the patch looks like, not what is left in it: abundance or bareness, never a count.
export type PerceivedForageable = { id: string; kind: string; x: number; y: number; prose: string }

export type HeardSpeech = { speakerId: string; name: string; text: string; distance: number }

// Things this agent watched happen out in the world — a taking that was not theirs,
// or one of the world's unexplained happenings close enough to see.
export type SeenEvent =
  | { kind: 'item_taken'; takerName: string; ownerName: string; itemKind: string }
  | { kind: 'mystery'; mystery: string; prose: string }
  | {
      kind: 'expression'
      actorName: string
      verb: string
      sense: 'sight' | 'sound'
      // What a minted act looks or sounds like, in the words its charter gave it.
      label?: string
    }
  // Somebody within earshot worked something out, and said why. `saying` is absent when the
  // mind had no thought behind the ask.
  | {
      kind: 'discovery'
      inventorName: string
      pronoun: 'he' | 'she'
      name: string
      saying?: string
    }

// What the ground under and around the feet is like. Absent on plain earth, so a packet from
// a town with no roads reads exactly as it always did. A fact about hauling, not a site score.
export type PerceivedGround = { wellTravelled: true }

// The roof the body is standing under. Absent under open sky, so a packet from a town that
// never went in reads exactly as it always did.
export type PerceivedInterior = { id: string; kind: string }

// What the hands and the feet can act on from where the body stands, read off the verbs' own
// tests so the prose and a refusal can never disagree about the same body.
export type PerceivedReach = {
  // Ids `itemWithinReach` accepts — the one reach `take` and `eat` measure by.
  atHand: string[]
  // Spots this packet names that are not ground: `findPath` refuses them all, so `walk` can
  // never end on one. Composed here because only the packet knows which spots it named.
  noFooting: { x: number; y: number }[]
}

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: SelfBody
    x: number
    y: number
    activity: string | null
    // Where the legs are already headed, present only while they are walking. The verb alone
    // cannot say it, and a body that cannot tell it is already going somewhere sets out again.
    activityToward?: { x: number; y: number }
    inside?: PerceivedInterior
    inventory: InventoryItem[]
  }
  weather: { kind: string; temperatureC: number }
  visible: {
    agents: PerceivedAgent[]
    structures: PerceivedStructure[]
    items: PerceivedItem[]
    crops: PerceivedCrop[]
    fauna: PerceivedFauna[]
    forageables: PerceivedForageable[]
  }
  reach: PerceivedReach
  ground?: PerceivedGround
  light: 'bright' | 'dim' | 'dark'
  // Present only while this body is doing work the dark is charging it for. Absent otherwise,
  // so a packet from a town that never worked at night reads exactly as it always did.
  fumbling?: true
  // Present only while the legs are walking a route the search could not follow to its end.
  // A distance, not a failure — and never the word for what the search did.
  wayUnclear?: true
  // Present only while the feet are on the last row or column the map has.
  atRim?: true
  heard: HeardSpeech[]
  seen: SeenEvent[]
  feltEvents: string[]
}

function groundUnderfoot(
  state: WorldState,
  config: SimConfig,
  x: number,
  y: number,
): PerceivedGround | undefined {
  if (!config.roads.enabled) return undefined
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = state.terrain[y + dy]?.[x + dx]
      if (tile !== undefined && isTravelled(tile)) return { wellTravelled: true }
    }
  }
  return undefined
}

const dist = (x1: number, y1: number, x2: number, y2: number): number =>
  Math.hypot(x2 - x1, y2 - y1)

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

// Precipitation kinds are "felt" as a start tag; sun and cloud pass silently.
const PRECIPITATION: Record<string, true> = { rain: true, storm: true, snow: true }

const isTileItem = (i: Item): i is Item & { loc: { t: 'tile'; x: number; y: number } } =>
  i.loc.t === 'tile'

const isStructureItem = (i: Item): i is Item & { loc: { t: 'structure'; id: string } } =>
  i.loc.t === 'structure'

// Events that happen *to* one agent, and the tag each becomes.
const SELF_EVENT_TAG: Record<string, string> = {
  agent_injured: 'you_were_attacked',
  agent_collapsed: 'you_collapsed',
  agent_died: 'you_died',
  agent_fell_ill: 'you_fell_ill',
  agent_infected: 'you_were_infected',
  agent_recovered: 'you_recovered',
  agent_tended: 'you_were_tended',
}

// Every tag `feltTagFor` can produce, so the prose map can be proven complete
// rather than sampled. Mystery tags come from MYSTERIES.
export const FELT_TAGS: readonly string[] = [
  ...Object.keys(PRECIPITATION).map((kind) => `${kind}_started`),
  ...Object.values(SELF_EVENT_TAG),
]

// A felt event is something that happens *to* this agent (or ambient weather). Anything about
// other agents produces no tag and appears nowhere in the packet.
function feltTagFor(agentId: string, ev: SimEvent): string | null {
  if (ev.type === 'weather_changed') {
    const p = ev.payload as { kind?: unknown; prevKind?: unknown } | null
    const kind = p?.kind
    if (typeof kind !== 'string' || PRECIPITATION[kind] !== true) return null
    return p?.prevKind === kind ? null : `${kind}_started` // same-kind temp steps pass silently
  }
  if ((ev.payload as { agentId?: unknown } | null)?.agentId !== agentId) return null
  return SELF_EVENT_TAG[ev.type] ?? null
}

// A sleeper misses it. Nothing else about a global mystery is conditional.
function globalMysteryTag(asleep: boolean, ev: SimEvent): string | null {
  if (asleep) return null
  const kind = (ev.payload as { kind?: unknown } | null)?.kind
  if (typeof kind !== 'string') return null
  const entry = MYSTERY_BY_KIND[kind]
  return entry?.scope === 'global' ? entry.kind : null
}

// Built once per packet, so no two channels can disagree about what this body can reach.
type Lens = {
  readonly state: WorldState
  readonly config: SimConfig
  readonly self: AgentBody
  readonly indoors: string | null
  withinSight(x: number, y: number): boolean
  sameRoom(otherId: string): boolean
  nameOf(id: string): string
}

function itemMarks(lens: Lens, i: Item): OwnerNames & Turning & Markings {
  const out: OwnerNames & Turning & Markings = {}
  if (lens.config.ownership.enabled) {
    if (i.owner !== undefined) out.ownerName = lens.nameOf(i.owner)
    if (i.crafterMark !== undefined) out.crafterMarkName = lens.nameOf(i.crafterMark)
  }
  if (isSpoiling(lens.state, i, lens.config)) out.spoiling = true
  if (i.marks !== undefined) out.marks = i.marks
  return out
}

const marked = (thing: { marks?: Record<string, string> }): Markings =>
  thing.marks === undefined ? {} : { marks: thing.marks }

function perceiveAgents(lens: Lens): PerceivedAgent[] {
  const { state, config, self } = lens
  return Object.values(state.agents)
    .filter((a) => a.id !== self.id && a.alive && lens.withinSight(a.x, a.y) && lens.sameRoom(a.id))
    .sort(byId)
    .map((a) => {
      const worn = wornProse(state, a.id)
      const condition = conditionProse(state, config, a.id)
      return {
        id: a.id,
        name: a.name,
        x: a.x,
        y: a.y,
        activityVerb: a.activity?.verb ?? null,
        collapsed: a.collapsedSinceTick !== null,
        asleep: a.asleep,
        ageBand: ageBand(config, a.ageDays),
        ...(worn === undefined ? {} : { worn }),
        ...(condition === undefined ? {} : { condition }),
        ...marked(a),
      }
    })
}

function carved(
  lens: Lens,
  s: Structure,
): Pick<PerceivedStructure, 'hasInscription' | 'inscription'> {
  if (s.inscription === undefined) return {}
  const readable =
    lens.indoors === null ? isAdjacentToRect(lens.self.x, lens.self.y, s) : s.id === lens.indoors
  return { hasInscription: true as const, ...(readable ? { inscription: s.inscription } : {}) }
}

// The same door `enter` validates against, so a mind is never shown a way in it cannot use.
function wayIn(lens: Lens, s: Structure): { door?: { x: number; y: number }; full?: true } {
  if (s.stage !== 'complete' || !isRoofedKind(lens.config, s.kind)) return {}
  const door = doorTile(lens.state, s)
  if (door === null) return {}
  return {
    door: { x: door.x, y: door.y },
    ...(roomIsFull(lens.state, s) ? { full: true as const } : {}),
  }
}

// The same two numbers `stepBuild` runs down, so the packet cannot disagree with the walls.
function howFarUp(lens: Lens, s: Structure): { raised?: { done: number; needs: number } } {
  if (s.stage !== 'construction') return {}
  const needs = buildTicks(lens.config, s.kind)
  return needs <= 0 ? {} : { raised: { done: Math.min(s.progressTicks, needs), needs } }
}

// The same property `stoke` validates against and the same clock `flamesAt` reads.
function theHearth(lens: Lens, s: Structure): { hearth?: 'lit' | 'cold' } {
  if (s.stage !== 'complete' || !isHearthKind(lens.config, s.kind)) return {}
  return { hearth: (s.fueledUntilTick ?? 0) > lens.state.tick ? 'lit' : 'cold' }
}

// The same property `sleepRegenPerTick` reads.
function theBed(lens: Lens, s: Structure): { bed?: true } {
  return s.stage === 'complete' && isBeddedKind(lens.config, s.kind) ? { bed: true as const } : {}
}

const named = (s: Structure): { name?: string } => {
  const name = placeName(s)
  return name === undefined ? {} : { name }
}

/** The walls this body's eyes reach, and the one place that rule is written. Indoors there is
 *  exactly one: the room you are standing in. */
function structuresSeen(lens: Lens): Structure[] {
  const { state, self, indoors } = lens
  // Nearest footprint tile, not the anchor: a long structure is seen by its near edge.
  const inSight = (s: Structure): boolean => {
    const nx = Math.min(Math.max(self.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(self.y, s.y), s.y + s.h - 1)
    return lens.withinSight(nx, ny)
  }
  return Object.values(state.structures)
    .filter((s) => (indoors === null ? inSight(s) : s.id === indoors))
    .sort(byId)
}

function perceiveStructures(lens: Lens): PerceivedStructure[] {
  return structuresSeen(lens).map((s) => ({
    id: s.id,
    kind: s.kind,
    ...named(s),
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    burning: s.burning,
    stage: s.stage,
    ...carved(lens, s),
    ...wayIn(lens, s),
    ...howFarUp(lens, s),
    ...theHearth(lens, s),
    ...theBed(lens, s),
    ...marked(s),
  }))
}

function perceiveItems(lens: Lens): PerceivedItem[] {
  const { state, self, indoors } = lens
  const tileItems: PerceivedItem[] =
    indoors !== null
      ? []
      : Object.values(state.items)
          .filter(isTileItem)
          .filter((i) => lens.withinSight(i.loc.x, i.loc.y))
          .sort(byId)
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            qty: i.qty,
            x: i.loc.x,
            y: i.loc.y,
            ...itemMarks(lens, i),
          }))

  const structureItems: PerceivedItem[] = Object.values(state.items)
    .filter(isStructureItem)
    .filter((i) => {
      const s = state.structures[i.loc.id]
      if (s === undefined) return false
      // Indoors you handle only this room's shelves; outdoors the doorway peek still works.
      return indoors === null ? isAdjacentToRect(self.x, self.y, s) : s.id === indoors
    })
    .sort(byId)
    .map((i) => {
      const s = state.structures[i.loc.id]!
      return { id: i.id, kind: i.kind, qty: i.qty, x: s.x, y: s.y, ...itemMarks(lens, i) }
    })

  return [...tileItems, ...structureItems].sort(byId)
}

function perceiveCrops(lens: Lens): PerceivedCrop[] {
  if (lens.indoors !== null) return []
  return Object.values(lens.state.crops)
    .filter((c) => lens.withinSight(c.x, c.y))
    .sort(byId)
    .map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, stage: c.stage, withered: c.withered }))
}

function perceiveFauna(lens: Lens): PerceivedFauna[] {
  if (lens.indoors !== null) return []
  const fauna = lens.state.fauna ?? {}
  return Object.keys(fauna)
    .sort()
    .map((id) => ({ id, ...fauna[id]! }))
    .filter((f) => f.alive && lens.withinSight(f.x, f.y))
    .map((f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y }))
}

function perceiveForageables(lens: Lens): PerceivedForageable[] {
  if (lens.indoors !== null) return []
  const forageables = lens.state.forageables ?? {}
  return Object.keys(forageables)
    .sort()
    .map((id) => ({ id, ...forageables[id]! }))
    .filter((f) => lens.withinSight(f.x, f.y))
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      x: f.x,
      y: f.y,
      prose: FORAGEABLE_PROSE[f.kind][f.stock > 0 ? 'standing' : 'bare'],
    }))
}

// Only over what this body can already see, so the block never names a thing the packet does
// not: `take` still reaches a little further than the eye does in the dark, and never less far.
function perceiveReach(lens: Lens, visible: PerceptionPacket['visible']): PerceivedReach {
  const atHand = visible.items
    .filter((i) => {
      const item = lens.state.items[i.id]
      return item !== undefined && itemWithinReach(lens.state, lens.self.id, item)
    })
    .map((i) => i.id)

  // Indoors a walk is refused for the walls before ever reaching the ground, so the scan is
  // work with nothing to say.
  if (lens.indoors !== null) return { atHand, noFooting: [] }

  // One walk of the structures for the whole block: `isPassable` without it scans them all
  // again for every spot, and this runs per body per tick.
  const ctx = pathCtx(lens.state, lens.config)
  const spots = new Map<number, { x: number; y: number }>()
  for (const p of [
    ...visible.structures,
    ...visible.items,
    ...visible.crops,
    ...visible.fauna,
    ...visible.forageables,
  ]) {
    spots.set(p.y * ctx.width + p.x, { x: p.x, y: p.y })
  }
  // Nearest first, because the prose keeps only the first few and the wall a body is about to
  // walk into is the one it needs named.
  const away = (p: { x: number; y: number }): number =>
    Math.abs(p.x - lens.self.x) + Math.abs(p.y - lens.self.y)
  const noFooting = [...spots.values()]
    .filter((p) => !isPassable(lens.state, p.x, p.y, ctx))
    .sort((a, b) => away(a) - away(b) || a.y - b.y || a.x - b.x)
  return { atHand, noFooting }
}

function perceiveInventory(lens: Lens): InventoryItem[] {
  return Object.values(lens.state.items)
    .filter((i) => i.loc.t === 'agent' && i.loc.id === lens.self.id)
    .sort(byId)
    .map((i) => ({ ...i, ...itemMarks(lens, i) }))
}

function perceiveHeard(lens: Lens, recentEvents: SimEvent[]): HeardSpeech[] {
  const { state, config, self } = lens
  const heard: HeardSpeech[] = []
  for (const ev of recentEvents) {
    if (ev.type !== 'agent_spoke') continue
    const p = ev.payload as { agentId?: unknown; text?: unknown; x?: unknown; y?: unknown }
    if (p.agentId === self.id) continue // you don't hear yourself
    if (typeof p.text !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (!hears(state, config, ev.payload, self.id)) continue
    const distance = dist(self.x, self.y, p.x, p.y)
    const speakerId = String(p.agentId)
    heard.push({
      speakerId,
      name: state.agents[speakerId]?.name ?? speakerId,
      text: p.text,
      distance,
    })
  }
  return heard
}

function perceiveSeen(lens: Lens, recentEvents: SimEvent[]): SeenEvent[] {
  const { state, config, self, indoors } = lens
  const seen: SeenEvent[] = []

  // A taking is witnessed by whoever could see the spot — the same horizon that
  // governs sight, so four walls hide it exactly as they hide the taker.
  if (config.ownership.enabled) {
    for (const ev of recentEvents) {
      if (ev.type !== 'item_taken') continue
      const p = ev.payload as {
        takerId?: unknown
        ownerId?: unknown
        kind?: unknown
        x?: unknown
        y?: unknown
      }
      if (
        typeof p.takerId !== 'string' ||
        typeof p.ownerId !== 'string' ||
        typeof p.kind !== 'string'
      )
        continue
      if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
      if (p.takerId === self.id) continue
      if (!lens.sameRoom(p.takerId) || !lens.withinSight(p.x, p.y)) continue
      seen.push({
        kind: 'item_taken',
        takerName: lens.nameOf(p.takerId),
        ownerName: lens.nameOf(p.ownerId),
        itemKind: p.kind,
      })
    }
  }

  // A dance is a thing at a place and obeys the light like everything else seen; a song is
  // carried by the voice, so it goes as far as speech goes and the dark does not touch it.
  for (const ev of recentEvents) {
    if (ev.type !== 'agent_expressed') continue
    const p = ev.payload as {
      agentId?: unknown
      verb?: unknown
      x?: unknown
      y?: unknown
      sense?: unknown
      label?: unknown
      radius?: unknown
    }
    if (typeof p.agentId !== 'string' || typeof p.verb !== 'string') continue
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (p.agentId === self.id) continue
    const sense = p.sense === 'sound' ? 'sound' : 'sight'
    // A minted act may name its own reach; the room still walls it in.
    const reaches =
      typeof p.radius === 'number'
        ? lens.sameRoom(p.agentId) && dist(self.x, self.y, p.x, p.y) <= p.radius
        : sense === 'sound'
          ? hears(state, config, ev.payload, self.id)
          : lens.sameRoom(p.agentId) && lens.withinSight(p.x, p.y)
    if (!reaches) continue
    seen.push({
      kind: 'expression',
      actorName: lens.nameOf(p.agentId),
      verb: p.verb,
      sense,
      ...(typeof p.label === 'string' ? { label: sanitizeSpokenText(p.label) } : {}),
    })
  }

  // A discovery is told, not seen: it carries as far as the inventor's voice does, from where
  // the inventor stands now.
  for (const ev of recentEvents) {
    if (ev.type !== 'discovery_made') continue
    const p = ev.payload as { byId?: unknown; name?: unknown; saying?: unknown }
    if (typeof p.byId !== 'string' || typeof p.name !== 'string' || p.byId === self.id) continue
    const inventor = state.agents[p.byId]
    if (inventor === undefined) continue
    const mouth = { x: inventor.x, y: inventor.y, insideId: inventor.insideId }
    if (!hears(state, config, mouth, self.id)) continue
    seen.push({
      kind: 'discovery',
      inventorName: inventor.name,
      pronoun: sexOf(inventor) === 'm' ? 'he' : 'she',
      name: p.name,
      ...(typeof p.saying === 'string' ? { saying: sanitizeSpokenText(p.saying) } : {}),
    })
  }

  // A global mystery reaches every open pair of eyes, walls and distance no object; a
  // located one is a thing at a place, so it obeys the same horizon as everything else.
  for (const ev of recentEvents) {
    if (ev.type !== 'mystery_event') continue
    const p = ev.payload as { kind?: unknown; x?: unknown; y?: unknown }
    const entry = typeof p.kind === 'string' ? MYSTERY_BY_KIND[p.kind] : undefined
    if (entry?.scope !== 'located') continue
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (indoors !== null || !lens.withinSight(p.x, p.y)) continue
    seen.push({ kind: 'mystery', mystery: entry.kind, prose: entry.prose })
  }

  return seen
}

function lensFor(state: WorldState, config: SimConfig, agentId: string): Lens {
  const self = state.agents[agentId]
  if (!self) throw new Error(`composePerception: no such agent ${agentId}`)
  const indoors = insideOf(state, agentId)
  return {
    state,
    config,
    self,
    indoors,
    // Set by the light ON THE THING SEEN, not on the viewer. Hearing does not use it: sound
    // carries in the dark.
    withinSight: (x, y) =>
      dist(self.x, self.y, x, y) <= visionRadiusAt(state, self, x, y, state.tick, config),
    sameRoom: (otherId) => insideOf(state, otherId) === indoors,
    // Names outlive their owners: a dead woman's basket is still hers to everyone who looks.
    nameOf: (id) => state.agents[id]?.name ?? id,
  }
}

/** The places this body's eyes reach right now, by id. The same horizon the packet is built on,
 *  because what a mind comes to know of the town cannot be a second opinion about seeing. */
export function structuresInSight(state: WorldState, config: SimConfig, agentId: string): string[] {
  return structuresSeen(lensFor(state, config, agentId)).map((s) => s.id)
}

export function composePerception(
  state: WorldState,
  baseConfig: SimConfig,
  agentId: string,
  recentEvents: SimEvent[],
): PerceptionPacket {
  // Derived here, not at the call site: no caller can forget the world's live laws.
  const config = effectiveConfig(baseConfig, state.laws)
  const lens = lensFor(state, config, agentId)
  const { self, indoors } = lens

  const feltEvents = recentEvents
    .map((ev) =>
      ev.type === 'mystery_event' ? globalMysteryTag(self.asleep, ev) : feltTagFor(agentId, ev),
    )
    .filter((t): t is string => t !== null)

  const ground = groundUnderfoot(state, config, self.x, self.y)
  const fumbling =
    self.activity !== null && workPenalty(state, config, agentId, self.activity.verb) !== 1

  const roof = indoors === null ? undefined : state.structures[indoors]
  const walkTo = self.activity?.verb === 'walk' ? self.activity.params : undefined
  const toward =
    typeof walkTo?.x === 'number' && typeof walkTo.y === 'number'
      ? { x: walkTo.x, y: walkTo.y }
      : undefined

  const visible = {
    agents: perceiveAgents(lens),
    structures: perceiveStructures(lens),
    items: perceiveItems(lens),
    crops: perceiveCrops(lens),
    fauna: perceiveFauna(lens),
    forageables: perceiveForageables(lens),
  }

  return {
    time: simTimeFromTick(state.tick),
    self: {
      body: {
        needs: { ...self.needs },
        hp: self.hp,
        injuries: self.injuries,
        ill: self.ill,
        thirst: thirstOf(self),
        afflictions: (self.afflictions ?? []).map((a) => ({ kind: a.kind, severity: a.severity })),
      },
      x: self.x,
      y: self.y,
      activity: self.activity?.verb ?? null,
      ...(toward === undefined ? {} : { activityToward: toward }),
      ...(roof === undefined ? {} : { inside: { id: roof.id, kind: roof.kind } }),
      inventory: perceiveInventory(lens),
    },
    weather: { ...state.weather },
    ...(ground === undefined ? {} : { ground }),
    light: lightBandAt(state, self.x, self.y, state.tick, config),
    ...(fumbling ? { fumbling: true as const } : {}),
    ...(walkIsCapped(state, agentId) ? { wayUnclear: true as const } : {}),
    ...(isMapRim(state, self.x, self.y) ? { atRim: true as const } : {}),
    visible,
    reach: perceiveReach(lens, visible),
    heard: perceiveHeard(lens, recentEvents),
    seen: perceiveSeen(lens, recentEvents),
    feltEvents,
  }
}
