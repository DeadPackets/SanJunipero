import {
  DAYS_PER_YEAR,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SPAWN_AGE_YEARS,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { thirstOf, type Affliction, type AgentBody, type TileId, type WorldState } from './state.js'
import {
  ActionCompleted,
  ActionInterrupted,
  ActionProgressed,
  ActionStarted,
  AfflictionRecovered,
  AfflictionWorsened,
  AgentAfflicted,
  AgentHarmed,
  AgentAged,
  AgentBorn,
  AgentCollapsed,
  AgentConceived,
  AgentDied,
  AgentFellIll,
  AgentInfected,
  AgentInjured,
  AgentMoved,
  AgentEntered,
  AgentExited,
  AgentExpressed,
  DiscoveryMade,
  AgentRecovered,
  AgentSlept,
  AgentSpoke,
  AgentSpawned,
  AgentTended,
  AgentWoke,
  CoSlept,
  CropGrew,
  CropHarvested,
  CropPlanted,
  CropWithered,
  AgentDrank,
  FireExtinguished,
  FireIgnited,
  FireSpread,
  GravePlaced,
  HpChanged,
  ThirstChanged,
  ItemBroke,
  ItemBurnedOut,
  ItemEquipped,
  ItemFilled,
  ItemLit,
  ItemMoved,
  ItemOwnerChanged,
  ItemQtyChanged,
  ItemSnuffed,
  ItemSpawned,
  ItemSpoiled,
  ItemTaken,
  ItemUnequipped,
  StructureFueled,
  ConfigChanged,
  FaunaKilled,
  FaunaMoved,
  FaunaSpawned,
  FaunaStockChanged,
  ForageableDepleted,
  ForageableRegrown,
  ForageableSpawned,
  ForageableStockChanged,
  ItemTextChanged,
  ItemWorn,
  MysteryEvent,
  NeedChanged,
  SkillGained,
  StructureCompleted,
  StructureDamaged,
  StructureDestroyed,
  StructureInscribed,
  StructurePlanned,
  StructureProgressed,
  TerrainChanged,
  TickAdvanced,
  TileChanged,
  TrafficDecayed,
  WeatherChanged,
  WildlifeChanged,
  WorldGrown,
} from './events.def.js'
import {
  countsAsFootfall,
  decayTraffic,
  fromTrafficKey,
  quietPathsAt,
  trafficKey,
} from './systems/desirePaths.js'
import { fromSaplingKey, saplingKey } from './systems/regrowth.js'
import { INJURY_HEAL_DAYS } from './systems/illness.js'
import { MYSTERY_BY_KIND } from './data/mysteries.js'
import { occupantsOf } from './interiors.js'
import { effectiveConfig, TOGGLABLE_PATHS } from './laws.js'
import { pairKey } from './systems/reproduction.js'
import { findPath } from './path.js'
import { WalkParams } from './verbs.js'

const clamp = (v: number) => Math.max(0, Math.min(100, v))

// The sapling tile id, named here because the fold is the only place outside the regrowth
// system that has to recognise one.
const SAPLING_TILE = 9

// Counter law: entity-creating events carry their id; the counter only ever rises.
function bumpCounter(counters: WorldState['counters'], id: string): WorldState['counters'] {
  const m = /_(\d+)$/.exec(id)
  if (!m) return counters
  const next = Number(m[1]) + 1
  return next > counters.nextEntityId ? { ...counters, nextEntityId: next } : counters
}

// A meal or a night's sleep is what "recovered" means: the collapse ladder starts over,
// and the counter goes back to absent so the body hashes like one that never fell.
function rested(a: AgentBody): AgentBody {
  if (a.collapsesWithoutRecovery === undefined && a.coldTicksSinceRecovery === undefined) return a
  const { collapsesWithoutRecovery: _c, coldTicksSinceRecovery: _x, ...rest } = a
  return rest
}

// Emit-free state repair is not allowed: a destroyer must emit agent_exited first,
// so the log alone explains where everybody went.
function refuseOccupied(state: WorldState, structureId: string): void {
  const occupants = occupantsOf(state, structureId)
  if (occupants.length > 0) {
    throw new Error(
      `structure ${structureId} destroyed with occupant(s) ${occupants.join(', ')} still inside`,
    )
  }
}

export function fold(
  state: WorldState,
  event: SimEvent,
  baseConfig: SimConfig = DEFAULT_CONFIG,
): WorldState {
  // Every fold reads the world's laws as they stand right now, so a replay of the log
  // can never drift from the run that wrote it — even across a mid-run law change.
  const config = effectiveConfig(baseConfig, state.laws)
  switch (event.type) {
    case 'tick_advanced': {
      TickAdvanced.parse(event.payload)
      return { ...state, tick: event.tick }
    }
    case 'agent_spawned': {
      const p = AgentSpawned.parse(event.payload)
      return {
        ...state,
        agents: {
          ...state.agents,
          [p.id]: {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            alive: true,
            asleep: false,
            needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
            hp: config.health.maxHp,
            injuries: [],
            ill: false,
            ageDays: p.ageDays,
            ...(p.sex === undefined ? {} : { sex: p.sex }),
            skills: {},
            activity: null,
            collapsedSinceTick: null,
            zeroHungerSinceTick: null,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'agent_moved': {
      const p = AgentMoved.parse(event.payload)
      const a = state.agents[p.id]
      if (!a) throw new Error(`agent_moved for unknown agent ${p.id}`)
      const agents = { ...state.agents, [p.id]: { ...a, x: p.x, y: p.y } }
      // A trail is worn by feet, not by arriving: only a body mid-walk marks the ground.
      if (!countsAsFootfall(state, p.id, config)) return { ...state, agents }
      const key = trafficKey(p.x, p.y)
      return {
        ...state,
        agents,
        traffic: { ...state.traffic, [key]: (state.traffic?.[key] ?? 0) + 1 },
      }
    }
    case 'need_changed': {
      const p = NeedChanged.parse(event.payload)
      const a = state.agents[p.id]
      if (!a) throw new Error(`need_changed for unknown agent ${p.id}`)
      const needs = { ...a.needs, [p.need]: clamp(a.needs[p.need] + p.delta) }
      let zeroHungerSinceTick = a.zeroHungerSinceTick
      if (p.need === 'hunger')
        zeroHungerSinceTick = needs.hunger <= 0 ? (zeroHungerSinceTick ?? event.tick) : null
      let collapsedSinceTick = a.collapsedSinceTick
      if (
        collapsedSinceTick !== null &&
        needs.hunger >= config.needs.collapseThreshold &&
        needs.energy >= config.needs.collapseThreshold &&
        a.hp >= config.health.collapseHp
      )
        collapsedSinceTick = null
      // A tick the cold billed to this body is remembered until it eats or sleeps: it is the
      // difference between dying tired and dying cold, and nothing else records it.
      const chilled =
        p.reason === 'exposure'
          ? { coldTicksSinceRecovery: (a.coldTicksSinceRecovery ?? 0) + 1 }
          : {}
      return {
        ...state,
        agents: {
          ...state.agents,
          [p.id]: { ...a, needs, zeroHungerSinceTick, collapsedSinceTick, ...chilled },
        },
      }
    }
    case 'item_spawned': {
      const p = ItemSpawned.parse(event.payload)
      return {
        ...state,
        items: {
          ...state.items,
          [p.id]: {
            id: p.id,
            kind: p.kind,
            qty: p.qty,
            ...(p.text !== undefined ? { text: p.text } : {}),
            ...(p.owner !== undefined ? { owner: p.owner } : {}),
            ...(p.crafterMark !== undefined ? { crafterMark: p.crafterMark } : {}),
            ...(p.spoilage !== undefined ? { spoilage: p.spoilage } : {}),
            ...(p.durability !== undefined ? { durability: p.durability } : {}),
            ...(p.charges !== undefined ? { charges: p.charges } : {}),
            loc: p.loc,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'item_owner_changed': {
      const p = ItemOwnerChanged.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_owner_changed for unknown item ${p.id}`)
      return { ...state, items: { ...state.items, [p.id]: { ...item, owner: p.owner } } }
    }
    case 'item_filled': {
      const p = ItemFilled.parse(event.payload)
      const item = state.items[p.itemId]
      if (!item) throw new Error(`item_filled for unknown item ${p.itemId}`)
      return { ...state, items: { ...state.items, [p.itemId]: { ...item, charges: p.charges } } }
    }
    case 'item_taken': {
      ItemTaken.parse(event.payload)
      return state
    }
    // The same class as a taking: witnessed, recorded, and folded to nothing. What a dance
    // means is the town's to decide, and the world state is not where that lives.
    case 'agent_expressed': {
      AgentExpressed.parse(event.payload)
      return state
    }
    // The record, and only the record: a discovery changes what the town CAN do, which lives in
    // the verb registry and not in the state. That is also why no golden can move.
    case 'discovery_made': {
      DiscoveryMade.parse(event.payload)
      return state
    }
    case 'item_worn': {
      const p = ItemWorn.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_worn for unknown item ${p.id}`)
      if (item.durability === undefined)
        throw new Error(`item_worn for item ${p.id} with no durability`)
      const durability = Math.max(0, item.durability + p.delta)
      return { ...state, items: { ...state.items, [p.id]: { ...item, durability } } }
    }
    case 'item_broke': {
      const p = ItemBroke.parse(event.payload)
      if (!state.items[p.id]) throw new Error(`item_broke for unknown item ${p.id}`)
      const { [p.id]: _, ...items } = state.items
      return { ...state, items }
    }
    // A flame and its fuel are the same number wearing two faces: alight it is the tick the
    // torch goes out, snuffed it is how many ticks are left in it.
    case 'item_lit': {
      const p = ItemLit.parse(event.payload)
      const item = state.items[p.itemId]
      if (!item) throw new Error(`item_lit for unknown item ${p.itemId}`)
      const { fuelTicks: _, ...rest } = item
      return {
        ...state,
        items: { ...state.items, [p.itemId]: { ...rest, litUntilTick: p.burnsUntilTick } },
      }
    }
    case 'item_snuffed': {
      const p = ItemSnuffed.parse(event.payload)
      const item = state.items[p.itemId]
      if (!item) throw new Error(`item_snuffed for unknown item ${p.itemId}`)
      if (item.litUntilTick === undefined)
        throw new Error(`item_snuffed for unlit item ${p.itemId}`)
      const { litUntilTick, ...rest } = item
      return {
        ...state,
        items: {
          ...state.items,
          [p.itemId]: { ...rest, fuelTicks: Math.max(0, litUntilTick - event.tick) },
        },
      }
    }
    case 'item_burned_out': {
      const p = ItemBurnedOut.parse(event.payload)
      if (!state.items[p.itemId]) throw new Error(`item_burned_out for unknown item ${p.itemId}`)
      const { [p.itemId]: _, ...items } = state.items
      return { ...state, items }
    }
    case 'structure_fueled': {
      const p = StructureFueled.parse(event.payload)
      const s = state.structures[p.structureId]
      if (!s) throw new Error(`structure_fueled for unknown structure ${p.structureId}`)
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.structureId]: { ...s, fueledUntilTick: p.burnsUntilTick },
        },
      }
    }
    case 'item_spoiled': {
      const p = ItemSpoiled.parse(event.payload)
      if (!state.items[p.id]) throw new Error(`item_spoiled for unknown item ${p.id}`)
      const { [p.id]: _, ...items } = state.items
      return { ...state, items }
    }
    case 'item_moved': {
      const p = ItemMoved.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_moved for unknown item ${p.id}`)
      const items = { ...state.items, [p.id]: { ...item, loc: p.loc } }
      // A cloak given away, dropped, or fallen off a body on the ground is off the body:
      // the slot cannot hold what the hands no longer have.
      const wearerId = item.loc.t === 'agent' ? item.loc.id : undefined
      const wearer = wearerId === undefined ? undefined : state.agents[wearerId]
      if (wearer === undefined || wearer.equipped?.body !== p.id) return { ...state, items }
      const { equipped: _, ...bare } = wearer
      return { ...state, items, agents: { ...state.agents, [wearerId!]: bare } }
    }
    // The body slot: one thing at a time, and absent again the moment it comes off, so a
    // town that never sewed anything hashes exactly as it always did.
    case 'item_equipped': {
      const p = ItemEquipped.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`item_equipped for unknown agent ${p.agentId}`)
      if (!state.items[p.itemId]) throw new Error(`item_equipped for unknown item ${p.itemId}`)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, equipped: { [p.slot]: p.itemId } } },
      }
    }
    case 'item_unequipped': {
      const p = ItemUnequipped.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`item_unequipped for unknown agent ${p.agentId}`)
      if (a.equipped?.body !== p.itemId)
        throw new Error(`item_unequipped: ${p.agentId} is not wearing ${p.itemId}`)
      const { equipped: _, ...bare } = a
      return { ...state, agents: { ...state.agents, [p.agentId]: bare } }
    }
    case 'item_qty_changed': {
      const p = ItemQtyChanged.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_qty_changed for unknown item ${p.id}`)
      const qty = item.qty + p.delta
      if (qty <= 0) {
        const { [p.id]: _, ...items } = state.items
        return { ...state, items }
      }
      return { ...state, items: { ...state.items, [p.id]: { ...item, qty } } }
    }
    case 'item_text_changed': {
      const p = ItemTextChanged.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_text_changed for unknown item ${p.id}`)
      return { ...state, items: { ...state.items, [p.id]: { ...item, text: p.text } } }
    }
    case 'structure_planned': {
      const p = StructurePlanned.parse(event.payload)
      for (const s of Object.values(state.structures)) {
        if (p.x < s.x + s.w && s.x < p.x + p.w && p.y < s.y + s.h && s.y < p.y + p.h) {
          throw new Error(`structure_planned ${p.id} overlaps structure ${s.id}`)
        }
      }
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.id]: {
            id: p.id,
            kind: p.kind,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            hp: 1,
            maxHp: p.maxHp,
            flammable: p.flammable,
            stage: 'construction',
            progressTicks: 0,
            builtBy: p.builderId,
            burning: false,
            burnTicks: 0,
            ...(p.owner === undefined ? {} : { owner: p.owner }),
            ...(p.facing === undefined ? {} : { facing: p.facing }),
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'structure_progressed': {
      const p = StructureProgressed.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_progressed for unknown structure ${p.id}`)
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.id]: { ...s, progressTicks: s.progressTicks + p.ticks },
        },
      }
    }
    case 'structure_completed': {
      const p = StructureCompleted.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_completed for unknown structure ${p.id}`)
      return {
        ...state,
        structures: { ...state.structures, [p.id]: { ...s, stage: 'complete', hp: s.maxHp } },
      }
    }
    // The wall holds one layer of text; every layer before it stays in the log.
    case 'structure_inscribed': {
      const p = StructureInscribed.parse(event.payload)
      const s = state.structures[p.structureId]
      if (!s) throw new Error(`structure_inscribed for unknown structure ${p.structureId}`)
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.structureId]: { ...s, inscription: { text: p.text, by: p.agentId } },
        },
      }
    }
    case 'structure_damaged': {
      const p = StructureDamaged.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_damaged for unknown structure ${p.id}`)
      const hp = s.hp - p.amount
      if (hp <= 0) {
        refuseOccupied(state, p.id)
        const { [p.id]: _, ...structures } = state.structures
        return { ...state, structures }
      }
      const burnTicks = s.burning ? s.burnTicks + 1 : s.burnTicks
      return { ...state, structures: { ...state.structures, [p.id]: { ...s, hp, burnTicks } } }
    }
    case 'structure_destroyed': {
      const p = StructureDestroyed.parse(event.payload)
      if (!state.structures[p.id])
        throw new Error(`structure_destroyed for unknown structure ${p.id}`)
      refuseOccupied(state, p.id)
      const { [p.id]: _, ...structures } = state.structures
      return { ...state, structures }
    }
    case 'fire_ignited': {
      const p = FireIgnited.parse(event.payload)
      const s = state.structures[p.structureId]
      if (!s) throw new Error(`fire_ignited for unknown structure ${p.structureId}`)
      return {
        ...state,
        structures: { ...state.structures, [p.structureId]: { ...s, burning: true, burnTicks: 0 } },
      }
    }
    case 'fire_spread': {
      const p = FireSpread.parse(event.payload)
      if (!state.structures[p.fromId])
        throw new Error(`fire_spread from unknown structure ${p.fromId}`)
      const s = state.structures[p.toId]
      if (!s) throw new Error(`fire_spread to unknown structure ${p.toId}`)
      return {
        ...state,
        structures: { ...state.structures, [p.toId]: { ...s, burning: true, burnTicks: 0 } },
      }
    }
    case 'fire_extinguished': {
      const p = FireExtinguished.parse(event.payload)
      // The place and the hands are colour; the structure is the fact the fold cannot do without.
      if (p.structureId === undefined) throw new Error('fire_extinguished names no structure')
      const s = state.structures[p.structureId]
      if (!s) throw new Error(`fire_extinguished for unknown structure ${p.structureId}`)
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.structureId]: { ...s, burning: false, burnTicks: 0 },
        },
      }
    }
    case 'action_started': {
      const p = ActionStarted.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`action_started for unknown agent ${p.agentId}`)
      let path: [number, number][] | undefined
      if (p.verb === 'walk') {
        const w = WalkParams.parse(p.params)
        const found = findPath(state, a, w, config)
        if (!found) throw new Error(`action_started walk with no path for ${p.agentId}`)
        path = found
      }
      const activity = {
        verb: p.verb,
        ticksRemaining: p.duration,
        params: p.params,
        ...(path ? { path } : {}),
      }
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, activity } } }
    }
    case 'action_progressed': {
      const p = ActionProgressed.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`action_progressed for unknown agent ${p.agentId}`)
      if (!a.activity) throw new Error(`action_progressed for idle agent ${p.agentId}`)
      const activity = { ...a.activity, ticksRemaining: a.activity.ticksRemaining - p.ticks }
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, activity } } }
    }
    case 'action_completed': {
      const p = ActionCompleted.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`action_completed for unknown agent ${p.agentId}`)
      const body = p.verb === 'eat' ? rested(a) : a
      // A meal is remembered by kind for as long as the variety window is wide, and the
      // remembering happens before the belly fills — the kind just eaten counts toward it.
      const kind = p.verb === 'eat' ? p.results?.kind : undefined
      if (typeof kind !== 'string' || !config.foodVariety.enabled) {
        return { ...state, agents: { ...state.agents, [p.agentId]: { ...body, activity: null } } }
      }
      const day = Math.floor(event.tick / MINUTES_PER_DAY)
      const recentFoods = [...(body.recentFoods ?? []), { kind, day }].filter(
        (m) => day - m.day < config.foodVariety.windowDays,
      )
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...body, recentFoods, activity: null } },
      }
    }
    case 'action_interrupted': {
      const p = ActionInterrupted.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`action_interrupted for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, activity: null } } }
    }
    case 'skill_gained': {
      const p = SkillGained.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`skill_gained for unknown agent ${p.agentId}`)
      const skills = { ...a.skills, [p.track]: (a.skills[p.track] ?? 0) + p.xp }
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, skills } } }
    }
    case 'agent_woke': {
      const p = AgentWoke.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_woke for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, asleep: false } } }
    }
    case 'agent_slept': {
      const p = AgentSlept.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_slept for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...rested(a), asleep: true } } }
    }
    case 'agent_entered': {
      const p = AgentEntered.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_entered for unknown agent ${p.agentId}`)
      if (!state.structures[p.structureId])
        throw new Error(`agent_entered for unknown structure ${p.structureId}`)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, insideId: p.structureId } },
      }
    }
    case 'agent_exited': {
      const p = AgentExited.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_exited for unknown agent ${p.agentId}`)
      const { insideId: _, ...body } = a
      return { ...state, agents: { ...state.agents, [p.agentId]: body } }
    }
    case 'agent_spoke': {
      const p = AgentSpoke.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_spoke for unknown agent ${p.agentId}`)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, lastSpokeTick: event.tick } },
      }
    }
    // The ladder is counted here and climbed by mortality.ts. Gated on the flag so a world
    // with mortality off keeps the earlier body shape, hash and all.
    case 'agent_collapsed': {
      const p = AgentCollapsed.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_collapsed for unknown agent ${p.agentId}`)
      const rung = config.mortality.enabled
        ? { collapsesWithoutRecovery: (a.collapsesWithoutRecovery ?? 0) + 1 }
        : {}
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, collapsedSinceTick: event.tick, ...rung } },
      }
    }
    case 'agent_conceived': {
      const p = AgentConceived.parse(event.payload)
      const mother = state.agents[p.motherId]
      if (!mother) throw new Error(`agent_conceived for unknown agent ${p.motherId}`)
      if (!state.agents[p.fatherId])
        throw new Error(`agent_conceived for unknown agent ${p.fatherId}`)
      return {
        ...state,
        agents: {
          ...state.agents,
          [p.motherId]: { ...mother, pregnant: { sinceDay: p.day, byId: p.fatherId } },
        },
      }
    }
    // One event, one body: the child arrives where the mother stands, inside her walls if
    // she has any, and her term ends in the same fold.
    case 'agent_born': {
      const p = AgentBorn.parse(event.payload)
      const mother = state.agents[p.motherId]
      if (!mother) throw new Error(`agent_born for unknown agent ${p.motherId}`)
      const { pregnant: _, ...delivered } = mother
      return {
        ...state,
        agents: {
          ...state.agents,
          [p.motherId]: delivered,
          [p.id]: {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            alive: true,
            asleep: false,
            needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
            // Twelve years on this world's calendar, which is 364 days long — not 365.
            hp: config.health.maxHp,
            injuries: [],
            ill: false,
            ageDays: SPAWN_AGE_YEARS * DAYS_PER_YEAR,
            sex: p.sex,
            parents: [p.motherId, p.fatherId],
            ...(mother.insideId === undefined ? {} : { insideId: mother.insideId }),
            skills: {},
            activity: null,
            collapsedSinceTick: null,
            zeroHungerSinceTick: null,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    // A night together is a fact; partnership is the count of them. A gap wider than
    // the window ends the run — and if the pair had reached partnership, that is a breakup.
    case 'co_slept': {
      const p = CoSlept.parse(event.payload)
      for (const id of [p.aId, p.bId]) {
        if (!state.agents[id]) throw new Error(`co_slept for unknown agent ${id}`)
      }
      const key = pairKey(p.aId, p.bId)
      const prev = state.pairNights?.[key]
      const broken =
        prev !== undefined && p.day - prev.lastNightDay > config.reproduction.partnerWindowDays
      const nights = prev === undefined || broken ? 1 : prev.nights + 1
      let formedTick = prev?.formedTick ?? null
      let dissolvedTick = prev?.dissolvedTick ?? null
      if (broken && formedTick !== null) dissolvedTick = event.tick
      if (
        nights >= config.reproduction.coSleepNightsToPartner &&
        (formedTick === null || dissolvedTick !== null)
      ) {
        formedTick = event.tick
        dissolvedTick = null
      }
      return {
        ...state,
        pairNights: {
          ...state.pairNights,
          [key]: { nights, lastNightDay: p.day, formedTick, dissolvedTick },
        },
      }
    }
    // Nothing changes. The payload is checked so a replay cannot invent a happening
    // the table never authored, and the state is returned untouched, same object.
    case 'mystery_event': {
      const p = MysteryEvent.parse(event.payload)
      if (MYSTERY_BY_KIND[p.kind] === undefined)
        throw new Error(`mystery_event for unknown mystery ${p.kind}`)
      return state
    }
    case 'weather_changed': {
      const p = WeatherChanged.parse(event.payload)
      return { ...state, weather: { kind: p.kind, temperatureC: p.temperatureC } }
    }
    case 'agent_aged': {
      const p = AgentAged.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_aged for unknown agent ${p.agentId}`)
      // The day turning is also when a wound closes: keep exactly the window septicWounds rolls on.
      const day = Math.floor(event.tick / MINUTES_PER_DAY)
      const injuries = a.injuries.filter((w) => day - w.day < INJURY_HEAL_DAYS)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, ageDays: a.ageDays + 1, injuries } },
      }
    }
    case 'agent_died': {
      const p = AgentDied.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_died for unknown agent ${p.agentId}`)
      const { insideId: _, ...body } = a
      return {
        ...state,
        agents: {
          ...state.agents,
          [p.agentId]: { ...body, alive: false, asleep: false, activity: null },
        },
      }
    }
    // The wound on the record, and only that: the hp comes off through the `agent_harmed` the
    // same blow emits, which is the one event that can name the hand behind it.
    case 'agent_injured': {
      const p = AgentInjured.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_injured for unknown agent ${p.agentId}`)
      const injuries = [
        ...a.injuries,
        { kind: p.kind, day: Math.floor(event.tick / MINUTES_PER_DAY) },
      ]
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, injuries } } }
    }
    case 'agent_infected': {
      const p = AgentInfected.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_infected for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, ill: true } } }
    }
    case 'agent_fell_ill': {
      const p = AgentFellIll.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_fell_ill for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, ill: true } } }
    }
    case 'agent_recovered': {
      const p = AgentRecovered.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_recovered for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, ill: false } } }
    }
    case 'agent_tended': {
      const p = AgentTended.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_tended for unknown agent ${p.agentId}`)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, tendedTick: event.tick } },
      }
    }
    case 'agent_harmed': {
      const p = AgentHarmed.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_harmed for unknown agent ${p.agentId}`)
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, hp: Math.max(0, a.hp - p.amount) } },
      }
    }
    // A second dose of the same thing is the same illness, worse: severity sums and the clock
    // keeps its original start, so "how long has she been ill" survives the second exposure.
    case 'agent_afflicted': {
      const p = AgentAfflicted.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_afflicted for unknown agent ${p.agentId}`)
      const prev = a.afflictions ?? []
      const existing = prev.find((x) => x.kind === p.kind)
      const sourceId = existing?.sourceId ?? p.sourceId
      const merged: Affliction = {
        kind: p.kind,
        severity: (existing?.severity ?? 0) + p.severity,
        sinceTick: existing?.sinceTick ?? event.tick,
        ...(sourceId === undefined ? {} : { sourceId }),
      }
      const afflictions = [...prev.filter((x) => x.kind !== p.kind), merged].sort((l, r) =>
        l.kind.localeCompare(r.kind),
      )
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, afflictions } } }
    }
    case 'affliction_worsened': {
      const p = AfflictionWorsened.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`affliction_worsened for unknown agent ${p.agentId}`)
      if (!a.afflictions?.some((x) => x.kind === p.kind))
        throw new Error(`affliction_worsened: ${p.agentId} has no ${p.kind}`)
      const afflictions = a.afflictions.map((x) =>
        x.kind === p.kind ? { ...x, severity: p.severity } : x,
      )
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, afflictions } } }
    }
    // Losing the last one restores the absent shape, so a body that recovered fully hashes
    // exactly like one that was never ill.
    case 'affliction_recovered': {
      const p = AfflictionRecovered.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`affliction_recovered for unknown agent ${p.agentId}`)
      if (!a.afflictions?.some((x) => x.kind === p.kind))
        throw new Error(`affliction_recovered: ${p.agentId} has no ${p.kind}`)
      const afflictions = a.afflictions.filter((x) => x.kind !== p.kind)
      if (afflictions.length > 0) {
        return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, afflictions } } }
      }
      const { afflictions: _, ...body } = a
      return { ...state, agents: { ...state.agents, [p.agentId]: body } }
    }
    // The one structure the world places and nobody builds: no builder, no owner, complete
    // the moment it exists. Its shape comes from the same recipe table every building reads.
    case 'grave_placed': {
      const p = GravePlaced.parse(event.payload)
      if (!state.agents[p.agentId]) throw new Error(`grave_placed for unknown agent ${p.agentId}`)
      const row = config.structures.recipes.grave
      if (row === undefined) throw new Error('grave_placed but structures.recipes has no grave row')
      for (const s of Object.values(state.structures)) {
        if (p.x < s.x + s.w && s.x < p.x + row.w && p.y < s.y + s.h && s.y < p.y + row.h) {
          throw new Error(`grave_placed ${p.id} overlaps structure ${s.id}`)
        }
      }
      return {
        ...state,
        structures: {
          ...state.structures,
          [p.id]: {
            id: p.id,
            kind: 'grave',
            x: p.x,
            y: p.y,
            w: row.w,
            h: row.h,
            hp: row.maxHp,
            maxHp: row.maxHp,
            flammable: row.flammable,
            stage: 'complete',
            progressTicks: 0,
            builtBy: null,
            burning: false,
            burnTicks: 0,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'thirst_changed': {
      const p = ThirstChanged.parse(event.payload)
      const a = state.agents[p.id]
      if (!a) throw new Error(`thirst_changed for unknown agent ${p.id}`)
      return {
        ...state,
        agents: { ...state.agents, [p.id]: { ...a, thirst: clamp(thirstOf(a) + p.delta) } },
      }
    }
    case 'agent_drank': {
      const p = AgentDrank.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_drank for unknown agent ${p.agentId}`)
      const agents = {
        ...state.agents,
        [p.agentId]: { ...a, thirst: clamp(thirstOf(a) + config.thirst.drinkRestore) },
      }
      if (p.source !== 'item' || p.itemId === undefined) return { ...state, agents }
      const item = state.items[p.itemId]
      if (!item) throw new Error(`agent_drank from unknown item ${p.itemId}`)
      const charges = Math.max(0, (item.charges ?? 0) - 1)
      return { ...state, agents, items: { ...state.items, [p.itemId]: { ...item, charges } } }
    }
    case 'hp_changed': {
      const p = HpChanged.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`hp_changed for unknown agent ${p.agentId}`)
      const hp = Math.max(0, Math.min(config.health.maxHp, a.hp + p.delta))
      let collapsedSinceTick = a.collapsedSinceTick
      if (
        collapsedSinceTick !== null &&
        a.needs.hunger >= config.needs.collapseThreshold &&
        a.needs.energy >= config.needs.collapseThreshold &&
        hp >= config.health.collapseHp
      )
        collapsedSinceTick = null
      return {
        ...state,
        agents: { ...state.agents, [p.agentId]: { ...a, hp, collapsedSinceTick } },
      }
    }
    case 'crop_planted': {
      const p = CropPlanted.parse(event.payload)
      // Replanting a tile clears any withered husk there, so they never pile up.
      const crops = Object.fromEntries(
        Object.entries(state.crops).filter(([, c]) => !(c.withered && c.x === p.x && c.y === p.y)),
      )
      return {
        ...state,
        crops: {
          ...crops,
          [p.id]: {
            id: p.id,
            kind: p.kind,
            x: p.x,
            y: p.y,
            plantedDay: p.plantedDay,
            stage: 0,
            withered: false,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'crop_grew': {
      const p = CropGrew.parse(event.payload)
      const c = state.crops[p.cropId]
      if (!c) throw new Error(`crop_grew for unknown crop ${p.cropId}`)
      return { ...state, crops: { ...state.crops, [p.cropId]: { ...c, stage: p.stage } } }
    }
    case 'crop_withered': {
      const p = CropWithered.parse(event.payload)
      const c = state.crops[p.cropId]
      if (!c) throw new Error(`crop_withered for unknown crop ${p.cropId}`)
      return { ...state, crops: { ...state.crops, [p.cropId]: { ...c, withered: true } } }
    }
    case 'crop_harvested': {
      const p = CropHarvested.parse(event.payload)
      if (!state.crops[p.cropId]) throw new Error(`crop_harvested for unknown crop ${p.cropId}`)
      const { [p.cropId]: _, ...crops } = state.crops
      return { ...state, crops }
    }
    case 'wildlife_changed': {
      const p = WildlifeChanged.parse(event.payload)
      return {
        ...state,
        wildlife: { fish: p.fish ?? state.wildlife.fish, deer: p.deer ?? state.wildlife.deer },
      }
    }
    // The map is absent until the first arrival and absent again when the last one is gone, so a
    // world with no herd hashes exactly as one that never had any.
    case 'fauna_spawned': {
      const p = FaunaSpawned.parse(event.payload)
      if (state.fauna?.[p.id]) throw new Error(`fauna_spawned for existing fauna ${p.id}`)
      return {
        ...state,
        fauna: {
          ...state.fauna,
          [p.id]: {
            kind: p.kind,
            x: p.x,
            y: p.y,
            alive: true,
            ...(p.stock === undefined ? {} : { stock: p.stock }),
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'fauna_moved': {
      const p = FaunaMoved.parse(event.payload)
      const fauna = { ...state.fauna }
      for (const m of p.moves) {
        const f = fauna[m.id]
        if (!f) throw new Error(`fauna_moved for unknown fauna ${m.id}`)
        fauna[m.id] = { ...f, x: m.x, y: m.y }
      }
      return { ...state, fauna }
    }
    case 'fauna_stock_changed': {
      const p = FaunaStockChanged.parse(event.payload)
      const f = state.fauna?.[p.id]
      if (!f) throw new Error(`fauna_stock_changed for unknown fauna ${p.id}`)
      return { ...state, fauna: { ...state.fauna, [p.id]: { ...f, stock: p.stock } } }
    }
    case 'fauna_killed': {
      const p = FaunaKilled.parse(event.payload)
      if (!state.fauna?.[p.id]) throw new Error(`fauna_killed for unknown fauna ${p.id}`)
      const { [p.id]: _, ...fauna } = state.fauna
      const next: WorldState = { ...state }
      if (Object.keys(fauna).length > 0) next.fauna = fauna
      else delete next.fauna
      return next
    }
    case 'forageable_spawned': {
      const p = ForageableSpawned.parse(event.payload)
      if (state.forageables?.[p.id]) throw new Error(`forageable_spawned for existing node ${p.id}`)
      return {
        ...state,
        forageables: {
          ...state.forageables,
          [p.id]: {
            kind: p.kind,
            x: p.x,
            y: p.y,
            stock: p.stock,
            ...(p.fullStock === undefined ? {} : { fullStock: p.fullStock }),
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'forageable_stock_changed':
    case 'forageable_depleted':
    case 'forageable_regrown': {
      const p =
        event.type === 'forageable_depleted'
          ? { ...ForageableDepleted.parse(event.payload), stock: 0 }
          : event.type === 'forageable_regrown'
            ? ForageableRegrown.parse(event.payload)
            : ForageableStockChanged.parse(event.payload)
      const node = state.forageables?.[p.id]
      if (!node) throw new Error(`${event.type} for unknown node ${p.id}`)
      return {
        ...state,
        forageables: { ...state.forageables, [p.id]: { ...node, stock: p.stock } },
      }
    }
    case 'terrain_changed': {
      const p = TerrainChanged.parse(event.payload)
      const row = state.terrain[p.y]
      if (!row || p.x < 0 || p.x >= row.length)
        throw new Error(`terrain_changed out of bounds (${p.x}, ${p.y})`)
      const terrain = state.terrain.map((r, y) =>
        y === p.y ? r.map((t, x) => (x === p.x ? (p.tile as TileId) : t)) : r,
      )
      return { ...state, terrain }
    }
    case 'tile_changed': {
      const p = TileChanged.parse(event.payload)
      const row = state.terrain[p.y]
      if (!row || p.x < 0 || p.x >= row.length)
        throw new Error(`tile_changed out of bounds (${p.x}, ${p.y})`)
      if (row[p.x] !== p.from) throw new Error(`tile_changed from-mismatch at (${p.x}, ${p.y})`)
      const terrain = state.terrain.map((r, y) =>
        y === p.y ? r.map((t, x) => (x === p.x ? (p.to as TileId) : t)) : r,
      )
      // The maturity clock is stamped where the seed fell and dropped however the sapling
      // leaves — grown, chopped, paved or tilled. Nothing else is stored about it.
      if (p.from !== SAPLING_TILE && p.to !== SAPLING_TILE) return { ...state, terrain }
      const key = saplingKey(p.x, p.y)
      const saplings = { ...state.saplings }
      if (p.to === SAPLING_TILE) saplings[key] = Math.floor(event.tick / MINUTES_PER_DAY)
      else delete saplings[key] // eslint-disable-line @typescript-eslint/no-dynamic-delete -- key order is hashed
      const next: WorldState = { ...state, terrain }
      if (Object.keys(saplings).length > 0) next.saplings = saplings
      else delete next.saplings
      return next
    }
    // Growing north or west moves the origin, so every stored coordinate moves with it —
    // inside this one fold, or a replay would find the town standing beside itself.
    case 'world_grown': {
      const p = WorldGrown.parse(event.payload)
      const h = state.terrain.length
      const w = state.terrain[0]!.length
      const vertical = p.edge === 'n' || p.edge === 's'
      const rows = vertical ? p.depth : h
      const cols = vertical ? w : p.depth
      if (p.tiles.length !== rows || p.tiles.some((r) => r.length !== cols)) {
        throw new Error(
          `world_grown strip is ${p.tiles.length}x${p.tiles[0]?.length ?? 0}, not ${rows}x${cols}`,
        )
      }
      const strip = p.tiles.map((r) => r.map((t) => t as TileId))
      let terrain: TileId[][]
      if (p.edge === 'n') terrain = [...strip, ...state.terrain]
      else if (p.edge === 's') terrain = [...state.terrain, ...strip]
      else if (p.edge === 'w') terrain = state.terrain.map((r, y) => [...strip[y]!, ...r])
      else terrain = state.terrain.map((r, y) => [...r, ...strip[y]!])

      const growths = (state.growths ?? 0) + 1

      const dx = p.edge === 'w' ? p.depth : 0
      const dy = p.edge === 'n' ? p.depth : 0
      if (dx === 0 && dy === 0) return { ...state, terrain, growths }

      // Params are translated on the `{x, y}` pair every landed coordinate-taking verb uses
      // (walk, till, plant, build): a destination in the old frame is a different tile now.
      const shiftParams = (params: Record<string, unknown>): Record<string, unknown> =>
        typeof params.x === 'number' && typeof params.y === 'number'
          ? { ...params, x: params.x + dx, y: params.y + dy }
          : params
      const agents = Object.fromEntries(
        Object.entries(state.agents).map(([id, a]) => [
          id,
          {
            ...a,
            x: a.x + dx,
            y: a.y + dy,
            ...(a.activity === null
              ? {}
              : {
                  activity: {
                    ...a.activity,
                    params: shiftParams(a.activity.params),
                    ...(a.activity.path === undefined
                      ? {}
                      : {
                          path: a.activity.path.map(([x, y]): [number, number] => [x + dx, y + dy]),
                        }),
                  },
                }),
          },
        ]),
      )
      const structures = Object.fromEntries(
        Object.entries(state.structures).map(([id, s]) => [id, { ...s, x: s.x + dx, y: s.y + dy }]),
      )
      const items = Object.fromEntries(
        Object.entries(state.items).map(([id, i]) => [
          id,
          i.loc.t === 'tile' ? { ...i, loc: { ...i.loc, x: i.loc.x + dx, y: i.loc.y + dy } } : i,
        ]),
      )
      const crops = Object.fromEntries(
        Object.entries(state.crops).map(([id, c]) => [id, { ...c, x: c.x + dx, y: c.y + dy }]),
      )
      const shiftKeys = (m: Record<string, number>): Record<string, number> =>
        Object.fromEntries(
          Object.entries(m).map(([k, v]) => {
            const at = fromTrafficKey(k)
            return [trafficKey(at.x + dx, at.y + dy), v]
          }),
        )
      const fauna =
        state.fauna === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(state.fauna).map(([id, f]) => [
                id,
                { ...f, x: f.x + dx, y: f.y + dy },
              ]),
            )
      const forageables =
        state.forageables === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(state.forageables).map(([id, f]) => [
                id,
                { ...f, x: f.x + dx, y: f.y + dy },
              ]),
            )
      // Saplings are stamped by coordinate, so they move with everything else — in this same
      // fold, or a replay would find the wood growing back in the wrong place.
      const shiftSaplings = (m: Record<string, number>): Record<string, number> =>
        Object.fromEntries(
          Object.entries(m).map(([k, v]) => {
            const at = fromSaplingKey(k)
            return [saplingKey(at.x + dx, at.y + dy), v]
          }),
        )
      // The array's origin walked with everything else, so the AUTHORED frame is now that much
      // further back — which is what lets the next strip continue the same river.
      const origin = { x: (state.origin?.x ?? 0) - dx, y: (state.origin?.y ?? 0) - dy }
      return {
        ...state,
        terrain,
        growths,
        agents,
        structures,
        items,
        crops,
        origin,
        ...(fauna === undefined ? {} : { fauna }),
        ...(forageables === undefined ? {} : { forageables }),
        ...(state.traffic === undefined ? {} : { traffic: shiftKeys(state.traffic) }),
        ...(state.quietSince === undefined ? {} : { quietSince: shiftKeys(state.quietSince) }),
        ...(state.saplings === undefined ? {} : { saplings: shiftSaplings(state.saplings) }),
      }
    }
    // One night's worth of grass growing back through the ruts, and a fresh stamp on every
    // trail the town has stopped using. Pure arithmetic over what the world already holds.
    case 'traffic_decayed': {
      TrafficDecayed.parse(event.payload)
      const traffic: Record<string, number> = {}
      // A tile worn back to nothing leaves the map — every reader of it is already `?? 0`.
      for (const [key, value] of Object.entries(state.traffic ?? {})) {
        const worn = decayTraffic(value, config)
        if (worn > 0) traffic[key] = worn
      }
      const quietSince = quietPathsAt(
        state,
        traffic,
        Math.floor(event.tick / MINUTES_PER_DAY),
        config,
      )
      const next: WorldState = { ...state }
      if (Object.keys(traffic).length > 0) next.traffic = traffic
      else delete next.traffic
      if (Object.keys(quietSince).length > 0) next.quietSince = quietSince
      else delete next.quietSince
      return next
    }
    // The whitelist is the whole of the authority: an operator, a bug or a doctored
    // log can only ever move a dial this table already agreed to.
    case 'config_changed': {
      const p = ConfigChanged.parse(event.payload)
      const schema = TOGGLABLE_PATHS[p.path]
      if (schema === undefined) throw new Error(`config_changed: ${p.path} is not a world law`)
      const parsed = schema.safeParse(p.value)
      if (!parsed.success) throw new Error(`config_changed: value rejected for ${p.path}`)
      return { ...state, laws: { ...state.laws, [p.path]: parsed.data } }
    }
    default:
      throw new Error(`unknown event type: ${event.type}`)
  }
}
