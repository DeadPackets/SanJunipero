import { simTimeFromTick, type SimConfig, type SimEvent, type SimTime } from '@sj/shared'
import type { Item, WorldState } from './state.js'
import { isAdjacentToRect } from './verbs.js'

// Perception is a pure projection: what one agent can sense from the shared
// world state plus the events that just happened. It never mutates state and
// never draws randomness, so identical inputs produce bit-identical packets.

export type SelfBody = {
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number
  injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
  ill: boolean
}

export type PerceivedAgent = {
  id: string; name: string; x: number; y: number
  activityVerb: string | null
  collapsed: boolean
  asleep: boolean
}

export type PerceivedStructure = {
  id: string; kind: string; x: number; y: number; w: number; h: number
  burning: boolean; stage: 'construction' | 'complete'
}

export type PerceivedItem = { id: string; kind: string; qty: number; x: number; y: number }

export type PerceivedCrop = { id: string; kind: string; x: number; y: number; stage: number; withered: boolean }

export type HeardSpeech = { speakerId: string; name: string; text: string; distance: number }

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: SelfBody
    x: number
    y: number
    activity: string | null
    inventory: Item[]
  }
  weather: { kind: string; temperatureC: number }
  visible: {
    agents: PerceivedAgent[]
    structures: PerceivedStructure[]
    items: PerceivedItem[]
    crops: PerceivedCrop[]
  }
  heard: HeardSpeech[]
  feltEvents: string[]
}

const dist = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x2 - x1, y2 - y1)

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Precipitation kinds are "felt" as a start tag; sun and cloud pass silently.
const PRECIPITATION: Record<string, true> = { rain: true, storm: true, snow: true }

const isTileItem = (i: Item): i is Item & { loc: { t: 'tile'; x: number; y: number } } => i.loc.t === 'tile'

const isStructureItem = (i: Item): i is Item & { loc: { t: 'structure'; id: string } } => i.loc.t === 'structure'

// A felt event is something that happens *to* this agent (or ambient weather).
// Anything about other agents — including out-of-range speech or injuries —
// produces no tag and appears nowhere in the packet.
function feltTagFor(agentId: string, ev: SimEvent): string | null {
  if (ev.type === 'weather_changed') {
    const p = ev.payload as { kind?: unknown; prevKind?: unknown } | null
    const kind = p?.kind
    if (typeof kind !== 'string' || PRECIPITATION[kind] !== true) return null
    return p?.prevKind === kind ? null : `${kind}_started` // same-kind temp steps pass silently
  }
  if ((ev.payload as { agentId?: unknown } | null)?.agentId !== agentId) return null
  switch (ev.type) {
    case 'agent_injured': return 'you_were_attacked'
    case 'agent_collapsed': return 'you_collapsed'
    case 'agent_died': return 'you_died'
    case 'agent_fell_ill': return 'you_fell_ill'
    case 'agent_infected': return 'you_were_infected'
    case 'agent_recovered': return 'you_recovered'
    case 'agent_tended': return 'you_were_tended'
    default: return null
  }
}

export function composePerception(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  recentEvents: SimEvent[],
): PerceptionPacket {
  const self = state.agents[agentId]
  if (!self) throw new Error(`composePerception: no such agent ${agentId}`)

  const sight = config.movement.sightRadius
  const earshot = config.movement.earshotRadius
  const withinSight = (x: number, y: number): boolean => dist(self.x, self.y, x, y) <= sight

  const visibleAgents: PerceivedAgent[] = Object.values(state.agents)
    .filter(a => a.id !== agentId && a.alive && withinSight(a.x, a.y))
    .sort(byId)
    .map(a => ({
      id: a.id, name: a.name, x: a.x, y: a.y,
      activityVerb: a.activity?.verb ?? null,
      collapsed: a.collapsedSinceTick !== null,
      asleep: a.asleep,
    }))

  // Nearest footprint tile, not the anchor: a long structure whose far corner is
  // anchored out of range is still seen when its near edge is within sight.
  const structureInSight = (s: { x: number; y: number; w: number; h: number }): boolean => {
    const nx = Math.min(Math.max(self.x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(self.y, s.y), s.y + s.h - 1)
    return withinSight(nx, ny)
  }

  const visibleStructures: PerceivedStructure[] = Object.values(state.structures)
    .filter(s => structureInSight(s))
    .sort(byId)
    .map(s => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, burning: s.burning, stage: s.stage }))

  const tileItems: PerceivedItem[] = Object.values(state.items)
    .filter(isTileItem)
    .filter(i => withinSight(i.loc.x, i.loc.y))
    .sort(byId)
    .map(i => ({ id: i.id, kind: i.kind, qty: i.qty, x: i.loc.x, y: i.loc.y }))

  const structureItems: PerceivedItem[] = Object.values(state.items)
    .filter(isStructureItem)
    .filter(i => {
      const s = state.structures[i.loc.id]
      return s !== undefined && isAdjacentToRect(self.x, self.y, s)
    })
    .sort(byId)
    .map(i => {
      const s = state.structures[i.loc.id]!
      return { id: i.id, kind: i.kind, qty: i.qty, x: s.x, y: s.y }
    })

  const visibleItems: PerceivedItem[] = [...tileItems, ...structureItems].sort(byId)

  const visibleCrops: PerceivedCrop[] = Object.values(state.crops)
    .filter(c => withinSight(c.x, c.y))
    .sort(byId)
    .map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, stage: c.stage, withered: c.withered }))

  const inventory: Item[] = Object.values(state.items)
    .filter(i => i.loc.t === 'agent' && i.loc.id === agentId)
    .sort(byId)

  const heard: HeardSpeech[] = []
  for (const ev of recentEvents) {
    if (ev.type !== 'agent_spoke') continue
    const p = ev.payload as { agentId?: unknown; text?: unknown; x?: unknown; y?: unknown }
    if (p.agentId === agentId) continue // you don't hear yourself
    if (typeof p.text !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') continue
    const distance = dist(self.x, self.y, p.x, p.y)
    if (distance > earshot) continue
    const speakerId = String(p.agentId)
    heard.push({ speakerId, name: state.agents[speakerId]?.name ?? speakerId, text: p.text, distance })
  }

  const feltEvents = recentEvents.map(ev => feltTagFor(agentId, ev)).filter((t): t is string => t !== null)

  return {
    time: simTimeFromTick(state.tick),
    self: {
      body: {
        needs: { ...self.needs },
        hp: self.hp,
        injuries: self.injuries,
        ill: self.ill,
      },
      x: self.x,
      y: self.y,
      activity: self.activity?.verb ?? null,
      inventory,
    },
    weather: { ...state.weather },
    visible: { agents: visibleAgents, structures: visibleStructures, items: visibleItems, crops: visibleCrops },
    heard,
    feltEvents,
  }
}
