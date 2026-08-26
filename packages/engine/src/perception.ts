import {
  isBeddedKind, isHearthKind, isRoofedKind, lightBandAt, simTimeFromTick, visionRadiusAt,
  type SimConfig, type SimEvent, type SimTime,
} from '@sj/shared'
import { FORAGEABLE_PROSE } from './data/forageables.js'
import { MYSTERY_BY_KIND } from './data/mysteries.js'
import { doorTile, roomIsFull } from './interiors.js'
import { effectiveConfig } from './laws.js'
import { thirstOf, type AfflictionKind, type Item, type Structure, type WorldState } from './state.js'
import { ageBand, type AgeBand } from './systems/aging.js'
import { isSpoiling } from './systems/spoilage.js'
import { buildTicks, isAdjacentToRect, walkIsCapped, workPenalty } from './verbs.js'

// A pure projection of what one agent can sense: it never mutates state and never draws
// randomness, so identical inputs produce bit-identical packets.

export type SelfBody = {
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number
  injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
  ill: boolean
  thirst: number   // always a number here: absence is a storage fact, not something a body feels
  // A body knows what ails it and how badly. It does not know the tick it fell ill.
  afflictions: Array<{ kind: AfflictionKind; severity: number }>
}

export type PerceivedAgent = {
  id: string; name: string; x: number; y: number
  activityVerb: string | null
  collapsed: boolean
  asleep: boolean
  ageBand: AgeBand   // a face carries no birthday, but it does carry this much
  // What the body has on, as it looks from across the square. Absent on bare shoulders, so a
  // town that has sewn nothing reads exactly as it always did, and never a number.
  worn?: string
  // Absent on a well body, so a healthy town reads exactly as it always did — and never a number.
  // The packet carries the phrase, because the phrase is what a pair of eyes actually gets.
  condition?: string
}

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
export function conditionProse(state: WorldState, config: SimConfig, agentId: string): string | undefined {
  const a = state.agents[agentId]
  if (a === undefined || !a.alive) return undefined
  const worst = [...(a.afflictions ?? [])].sort((p, q) =>
    q.severity - p.severity || (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : 0))[0]
  if (worst !== undefined) return CONDITION_PROSE[worst.kind]
  if (a.ill) return CONDITION_PROSE.illness
  if (a.hp < config.health.maxHp * HURT_SHARE) return 'badly hurt'
  if (a.needs.hunger < GAUNT_HUNGER) return 'hollowed out with hunger'
  return undefined
}

// Both fields absent on a blank wall. `door` is the tile `enter` measures against — absent on a
// kind with no way in, on a building still going up, and on one nothing passable rings.
export type PerceivedStructure = {
  id: string; kind: string; x: number; y: number; w: number; h: number
  burning: boolean; stage: 'construction' | 'complete'
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
}

// Whose it is, and whose hands made it — the two things prose needs to say
// "Rahel's basket" or "a chair bearing Yusuf's mark". Absent when unclaimed.
export type OwnerNames = { ownerName?: string; crafterMarkName?: string }

// Absent unless the thing is on its last day, so a packet full of fresh food reads as it always did.
export type Turning = { spoiling?: true }

export type PerceivedItem = { id: string; kind: string; qty: number; x: number; y: number } & OwnerNames & Turning

export type InventoryItem = Item & OwnerNames & Turning

export type PerceivedCrop = { id: string; kind: string; x: number; y: number; stage: number; withered: boolean }

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
  | { kind: 'expression'; actorName: string; verb: string; sense: 'sight' | 'sound' }

// What the ground under and around the feet is like. Absent on plain earth, so a packet from
// a town with no roads reads exactly as it always did. A fact about hauling, not a site score.
export type PerceivedGround = { wellTravelled: true }

// The roof the body is standing under. Absent under open sky, so a packet from a town that
// never went in reads exactly as it always did.
export type PerceivedInterior = { id: string; kind: string }

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
  ground?: PerceivedGround
  // How much light is on the ground this body stands on. Three words, never a number.
  light: 'bright' | 'dim' | 'dark'
  // Present only while this body is doing work the dark is charging it for. Absent otherwise,
  // so a packet from a town that never worked at night reads exactly as it always did.
  fumbling?: true
  // Present only while the legs are walking a route the search could not follow to its end.
  // A distance, not a failure — and never the word for what the search did.
  wayUnclear?: true
  heard: HeardSpeech[]
  seen: SeenEvent[]
  feltEvents: string[]
}

// Road and worn path both. The advantage is already real — it is the move cost roads
// changed — and this only says so out loud.
const TRAVELLED_TILES: ReadonlySet<number> = new Set([7, 8])

function groundUnderfoot(state: WorldState, config: SimConfig, x: number, y: number): PerceivedGround | undefined {
  if (!config.roads.enabled) return undefined
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = state.terrain[y + dy]?.[x + dx]
      if (tile !== undefined && TRAVELLED_TILES.has(tile)) return { wellTravelled: true }
    }
  }
  return undefined
}

const dist = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x2 - x1, y2 - y1)

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Precipitation kinds are "felt" as a start tag; sun and cloud pass silently.
const PRECIPITATION: Record<string, true> = { rain: true, storm: true, snow: true }

const isTileItem = (i: Item): i is Item & { loc: { t: 'tile'; x: number; y: number } } => i.loc.t === 'tile'

const isStructureItem = (i: Item): i is Item & { loc: { t: 'structure'; id: string } } => i.loc.t === 'structure'

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
  return entry !== undefined && entry.scope === 'global' ? entry.kind : null
}

const chebyshev = (x1: number, y1: number, x2: number, y2: number): number =>
  Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))

// A wall stops sound: speech carries iff both share an interior, both are outdoors within
// earshot, or the one outdoors is standing in the other's doorway.
export function hears(state: WorldState, baseConfig: SimConfig, speakerEv: SimEvent, hearerId: string): boolean {
  const config = effectiveConfig(baseConfig, state.laws)
  const p = speakerEv.payload as { x?: unknown; y?: unknown; insideId?: unknown } | null
  const hearer = state.agents[hearerId]
  if (!hearer || typeof p?.x !== 'number' || typeof p.y !== 'number') return false

  // Occlusion off drops the wall, not the distance: plain earshot, as it was before.
  if (!config.occlusion.enabled) return dist(hearer.x, hearer.y, p.x, p.y) <= config.movement.earshotRadius

  const speakerInside = typeof p.insideId === 'string' ? p.insideId : null
  const hearerInside = hearer.insideId ?? null
  if (speakerInside !== null && hearerInside !== null) return speakerInside === hearerInside
  if (speakerInside === null && hearerInside === null) {
    return dist(hearer.x, hearer.y, p.x, p.y) <= config.movement.earshotRadius
  }

  const structure = state.structures[speakerInside ?? hearerInside!]
  if (!structure) return false
  const door = doorTile(state, structure)
  if (!door) return false
  const outdoors = speakerInside !== null ? { x: hearer.x, y: hearer.y } : { x: p.x, y: p.y }
  return chebyshev(outdoors.x, outdoors.y, door.x, door.y) <= 1
}

export function composePerception(
  state: WorldState,
  baseConfig: SimConfig,
  agentId: string,
  recentEvents: SimEvent[],
): PerceptionPacket {
  const self = state.agents[agentId]
  if (!self) throw new Error(`composePerception: no such agent ${agentId}`)
  // Derived here, not at the call site: no caller can forget the world's live laws.
  const config = effectiveConfig(baseConfig, state.laws)

  // Every sight-class channel below goes through this one horizon, and the horizon is set by
  // the light ON THE THING SEEN (§19). Hearing does not use it: sound carries in the dark.
  const withinSight = (x: number, y: number): boolean =>
    dist(self.x, self.y, x, y) <= visionRadiusAt(state, self, x, y, state.tick, config)

  // Four walls are also a horizon: inside, the world shrinks to this one room.
  const indoors = self.insideId ?? null

  // Names outlive their owners: a dead woman's basket is still hers to everyone who looks.
  const nameOf = (id: string): string => state.agents[id]?.name ?? id
  const ownerNames = (i: Item): OwnerNames => config.ownership.enabled
    ? {
        ...(i.owner === undefined ? {} : { ownerName: nameOf(i.owner) }),
        ...(i.crafterMark === undefined ? {} : { crafterMarkName: nameOf(i.crafterMark) }),
      }
    : {}

  const turning = (i: Item): Turning => (isSpoiling(state, i, config) ? { spoiling: true } : {})

  const visibleAgents: PerceivedAgent[] = Object.values(state.agents)
    // Four walls outrank the light, and inside them the darkness still costs distance.
    .filter(a => a.id !== agentId && a.alive && withinSight(a.x, a.y)
      && (indoors === null ? a.insideId === undefined : a.insideId === indoors))
    .sort(byId)
    .map(a => {
      const worn = wornProse(state, a.id)
      const condition = conditionProse(state, config, a.id)
      return {
        id: a.id, name: a.name, x: a.x, y: a.y,
        activityVerb: a.activity?.verb ?? null,
        collapsed: a.collapsedSinceTick !== null,
        asleep: a.asleep,
        ageBand: ageBand(config, a.ageDays),
        ...(worn === undefined ? {} : { worn }),
        ...(condition === undefined ? {} : { condition }),
      }
    })

  // Nearest footprint tile, not the anchor: a long structure whose far corner is
  // anchored out of range is still seen when its near edge is within sight.
  const structureInSight = (s: { x: number; y: number; w: number; h: number }): boolean => {
    const nx = Math.min(Math.max(self.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(self.y, s.y), s.y + s.h - 1)
    return withinSight(nx, ny)
  }

  const carved = (s: { id: string; x: number; y: number; w: number; h: number; inscription?: { text: string; by: string } }) => {
    if (s.inscription === undefined) return {}
    const readable = indoors === null ? isAdjacentToRect(self.x, self.y, s) : s.id === indoors
    return { hasInscription: true as const, ...(readable ? { inscription: s.inscription } : {}) }
  }

  // The way in, from the same function the verb uses. A body that reads this and stands there
  // is a body `enter` accepts.
  const wayIn = (s: Structure): { door?: { x: number; y: number }; full?: true } => {
    if (s.stage !== 'complete' || !isRoofedKind(config, s.kind)) return {}
    const door = doorTile(state, s)
    if (door === null) return {}
    return { door: { x: door.x, y: door.y }, ...(roomIsFull(state, s) ? { full: true as const } : {}) }
  }

  // Read off the same two numbers `stepBuild` runs down, so what a mind is shown and what the
  // walls actually are cannot disagree.
  const howFarUp = (s: Structure): { raised?: { done: number; needs: number } } => {
    if (s.stage !== 'construction') return {}
    const needs = buildTicks(config, s.kind)
    return needs <= 0 ? {} : { raised: { done: Math.min(s.progressTicks, needs), needs } }
  }

  // The fire in the room, off the same property `stoke` validates against and the same clock
  // `flamesAt` reads — so what a mind is told about a hearth is what the hearth is.
  const theHearth = (s: Structure): { hearth?: 'lit' | 'cold' } => {
    if (s.stage !== 'complete' || !isHearthKind(config, s.kind)) return {}
    return { hearth: (s.fueledUntilTick ?? 0) > state.tick ? 'lit' : 'cold' }
  }

  // Off the same property `sleepRegenPerTick` reads, so what a mind is promised at the door is
  // what the night actually gives it.
  const theBed = (s: Structure): { bed?: true } =>
    s.stage === 'complete' && isBeddedKind(config, s.kind) ? { bed: true as const } : {}

  const visibleStructures: PerceivedStructure[] = Object.values(state.structures)
    .filter(s => (indoors === null ? structureInSight(s) : s.id === indoors))
    .sort(byId)
    .map(s => ({
      id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, burning: s.burning, stage: s.stage,
      ...carved(s), ...wayIn(s), ...howFarUp(s), ...theHearth(s), ...theBed(s),
    }))

  const tileItems: PerceivedItem[] = indoors !== null ? [] : Object.values(state.items)
    .filter(isTileItem)
    .filter(i => withinSight(i.loc.x, i.loc.y))
    .sort(byId)
    .map(i => ({ id: i.id, kind: i.kind, qty: i.qty, x: i.loc.x, y: i.loc.y, ...ownerNames(i), ...turning(i) }))

  const structureItems: PerceivedItem[] = Object.values(state.items)
    .filter(isStructureItem)
    .filter(i => {
      const s = state.structures[i.loc.id]
      if (s === undefined) return false
      // Indoors you handle only this room's shelves; outdoors the doorway peek still works.
      return indoors === null ? isAdjacentToRect(self.x, self.y, s) : s.id === indoors
    })
    .sort(byId)
    .map(i => {
      const s = state.structures[i.loc.id]!
      return { id: i.id, kind: i.kind, qty: i.qty, x: s.x, y: s.y, ...ownerNames(i), ...turning(i) }
    })

  const visibleItems: PerceivedItem[] = [...tileItems, ...structureItems].sort(byId)

  const visibleCrops: PerceivedCrop[] = indoors !== null ? [] : Object.values(state.crops)
    .filter(c => withinSight(c.x, c.y))
    .sort(byId)
    .map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, stage: c.stage, withered: c.withered }))

  // Four walls hide the herd as completely as they hide everything else outdoors.
  const visibleFauna: PerceivedFauna[] = indoors !== null ? [] : Object.keys(state.fauna ?? {}).sort()
    .map((id) => ({ id, ...state.fauna![id]! }))
    .filter((f) => f.alive && withinSight(f.x, f.y))
    .map((f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y }))

  const visibleForageables: PerceivedForageable[] = indoors !== null ? [] : Object.keys(state.forageables ?? {}).sort()
    .map((id) => ({ id, ...state.forageables![id]! }))
    .filter((f) => withinSight(f.x, f.y))
    .map((f) => ({
      id: f.id, kind: f.kind, x: f.x, y: f.y,
      prose: FORAGEABLE_PROSE[f.kind][f.stock > 0 ? 'standing' : 'bare'],
    }))

  const inventory: InventoryItem[] = Object.values(state.items)
    .filter(i => i.loc.t === 'agent' && i.loc.id === agentId)
    .sort(byId)
    .map(i => ({ ...i, ...ownerNames(i), ...turning(i) }))

  const heard: HeardSpeech[] = []
  for (const ev of recentEvents) {
    if (ev.type !== 'agent_spoke') continue
    const p = ev.payload as { agentId?: unknown; text?: unknown; x?: unknown; y?: unknown }
    if (p.agentId === agentId) continue // you don't hear yourself
    if (typeof p.text !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (!hears(state, config, ev, agentId)) continue
    const distance = dist(self.x, self.y, p.x, p.y)
    const speakerId = String(p.agentId)
    heard.push({ speakerId, name: state.agents[speakerId]?.name ?? speakerId, text: p.text, distance })
  }

  // A taking is witnessed by whoever could see the spot — the same horizon that
  // governs sight, so four walls hide it exactly as they hide the taker.
  const seen: SeenEvent[] = []
  if (config.ownership.enabled) {
    for (const ev of recentEvents) {
      if (ev.type !== 'item_taken') continue
      const p = ev.payload as { takerId?: unknown; ownerId?: unknown; kind?: unknown; x?: unknown; y?: unknown }
      if (typeof p.takerId !== 'string' || typeof p.ownerId !== 'string' || typeof p.kind !== 'string') continue
      if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
      if (p.takerId === agentId) continue
      const takerInside = state.agents[p.takerId]?.insideId ?? null
      const sameSide = indoors === null ? takerInside === null : takerInside === indoors
      if (!sameSide || !withinSight(p.x, p.y)) continue
      seen.push({ kind: 'item_taken', takerName: nameOf(p.takerId), ownerName: nameOf(p.ownerId), itemKind: p.kind })
    }
  }

  // A dance is a thing at a place and obeys the light like everything else seen; a song is
  // carried by the voice, so it goes as far as speech goes and the dark does not touch it.
  for (const ev of recentEvents) {
    if (ev.type !== 'agent_expressed') continue
    const p = ev.payload as { agentId?: unknown; verb?: unknown; x?: unknown; y?: unknown; sense?: unknown }
    if (typeof p.agentId !== 'string' || typeof p.verb !== 'string') continue
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (p.agentId === agentId) continue
    const sense = p.sense === 'sound' ? 'sound' : 'sight'
    const actorInside = state.agents[p.agentId]?.insideId ?? null
    const reaches = sense === 'sound'
      ? hears(state, config, ev, agentId)
      : (indoors === null ? actorInside === null : actorInside === indoors) && withinSight(p.x, p.y)
    if (!reaches) continue
    seen.push({ kind: 'expression', actorName: nameOf(p.agentId), verb: p.verb, sense })
  }

  // A global mystery reaches every open pair of eyes, walls and distance no object; a
  // located one is a thing at a place, so it obeys the same horizon as everything else.
  for (const ev of recentEvents) {
    if (ev.type !== 'mystery_event') continue
    const p = ev.payload as { kind?: unknown; x?: unknown; y?: unknown }
    const entry = typeof p.kind === 'string' ? MYSTERY_BY_KIND[p.kind] : undefined
    if (entry === undefined || entry.scope !== 'located') continue
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (indoors !== null || !withinSight(p.x, p.y)) continue
    seen.push({ kind: 'mystery', mystery: entry.kind, prose: entry.prose })
  }

  const feltEvents = recentEvents
    .map(ev => (ev.type === 'mystery_event' ? globalMysteryTag(self.asleep, ev) : feltTagFor(agentId, ev)))
    .filter((t): t is string => t !== null)

  const ground = groundUnderfoot(state, config, self.x, self.y)
  const fumbling = self.activity !== null
    && workPenalty(state, config, agentId, self.activity.verb) !== 1

  const roof = indoors === null ? undefined : state.structures[indoors]
  const walkTo = self.activity?.verb === 'walk' ? self.activity.params : undefined
  const toward = typeof walkTo?.x === 'number' && typeof walkTo.y === 'number'
    ? { x: walkTo.x, y: walkTo.y }
    : undefined

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
      inventory,
    },
    weather: { ...state.weather },
    ...(ground === undefined ? {} : { ground }),
    light: lightBandAt(state, self.x, self.y, state.tick, config),
    ...(fumbling ? { fumbling: true as const } : {}),
    ...(walkIsCapped(state, agentId) ? { wayUnclear: true as const } : {}),
    visible: {
      agents: visibleAgents, structures: visibleStructures, items: visibleItems,
      crops: visibleCrops, fauna: visibleFauna, forageables: visibleForageables,
    },
    heard,
    seen,
    feltEvents,
  }
}
