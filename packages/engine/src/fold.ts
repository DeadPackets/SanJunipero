import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import type { TileId, WorldState } from './state.js'
import {
  ActionCompleted, ActionInterrupted, ActionProgressed, ActionStarted,
  AgentAged, AgentCollapsed, AgentDied, AgentFellIll, AgentInfected, AgentInjured, AgentMoved,
  AgentRecovered, AgentSlept, AgentSpawned, AgentTended, AgentWoke,
  CropGrew, CropHarvested, CropPlanted, CropWithered, HpChanged,
  ItemMoved, ItemQtyChanged, ItemSpawned, NeedChanged,
  SkillGained, StructureCompleted, StructureDamaged, StructureDestroyed, StructurePlanned,
  StructureProgressed, TerrainChanged, TickAdvanced, WeatherChanged, WildlifeChanged,
} from './events.def.js'
import { findPath } from './path.js'
import { WalkParams } from './verbs.js'

const clamp = (v: number) => Math.max(0, Math.min(100, v))

// Counter law: entity-creating events carry their id; the counter only ever rises.
function bumpCounter(counters: WorldState['counters'], id: string): WorldState['counters'] {
  const m = /_(\d+)$/.exec(id)
  if (!m) return counters
  const next = Number(m[1]) + 1
  return next > counters.nextEntityId ? { ...counters, nextEntityId: next } : counters
}

export function fold(state: WorldState, event: SimEvent, config: SimConfig = DEFAULT_CONFIG): WorldState {
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
            id: p.id, name: p.name, x: p.x, y: p.y, alive: true, asleep: false,
            needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
            hp: config.health.maxHp, injuries: [], ill: false, ageDays: p.ageDays,
            skills: {}, activity: null, collapsedSinceTick: null, zeroHungerSinceTick: null,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'agent_moved': {
      const p = AgentMoved.parse(event.payload)
      const a = state.agents[p.id]
      if (!a) throw new Error(`agent_moved for unknown agent ${p.id}`)
      return { ...state, agents: { ...state.agents, [p.id]: { ...a, x: p.x, y: p.y } } }
    }
    case 'need_changed': {
      const p = NeedChanged.parse(event.payload)
      const a = state.agents[p.id]
      if (!a) throw new Error(`need_changed for unknown agent ${p.id}`)
      const needs = { ...a.needs, [p.need]: clamp(a.needs[p.need] + p.delta) }
      let zeroHungerSinceTick = a.zeroHungerSinceTick
      if (p.need === 'hunger') zeroHungerSinceTick = needs.hunger <= 0 ? (zeroHungerSinceTick ?? event.tick) : null
      let collapsedSinceTick = a.collapsedSinceTick
      if (collapsedSinceTick !== null
        && needs.hunger >= config.needs.collapseThreshold && needs.energy >= config.needs.collapseThreshold
        && a.hp >= config.health.collapseHp) collapsedSinceTick = null
      return { ...state, agents: { ...state.agents, [p.id]: { ...a, needs, zeroHungerSinceTick, collapsedSinceTick } } }
    }
    case 'item_spawned': {
      const p = ItemSpawned.parse(event.payload)
      return {
        ...state,
        items: { ...state.items, [p.id]: { id: p.id, kind: p.kind, qty: p.qty, loc: p.loc } },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'item_moved': {
      const p = ItemMoved.parse(event.payload)
      const item = state.items[p.id]
      if (!item) throw new Error(`item_moved for unknown item ${p.id}`)
      return { ...state, items: { ...state.items, [p.id]: { ...item, loc: p.loc } } }
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
            id: p.id, kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h,
            hp: 1, maxHp: p.maxHp, flammable: p.flammable, stage: 'construction',
            progressTicks: 0, builtBy: p.builderId, burning: false, burnTicks: 0,
          },
        },
        counters: bumpCounter(state.counters, p.id),
      }
    }
    case 'structure_progressed': {
      const p = StructureProgressed.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_progressed for unknown structure ${p.id}`)
      return { ...state, structures: { ...state.structures, [p.id]: { ...s, progressTicks: s.progressTicks + p.ticks } } }
    }
    case 'structure_completed': {
      const p = StructureCompleted.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_completed for unknown structure ${p.id}`)
      return { ...state, structures: { ...state.structures, [p.id]: { ...s, stage: 'complete', hp: s.maxHp } } }
    }
    case 'structure_damaged': {
      const p = StructureDamaged.parse(event.payload)
      const s = state.structures[p.id]
      if (!s) throw new Error(`structure_damaged for unknown structure ${p.id}`)
      const hp = s.hp - p.amount
      if (hp <= 0) {
        const { [p.id]: _, ...structures } = state.structures
        return { ...state, structures }
      }
      return { ...state, structures: { ...state.structures, [p.id]: { ...s, hp } } }
    }
    case 'structure_destroyed': {
      const p = StructureDestroyed.parse(event.payload)
      if (!state.structures[p.id]) throw new Error(`structure_destroyed for unknown structure ${p.id}`)
      const { [p.id]: _, ...structures } = state.structures
      return { ...state, structures }
    }
    case 'action_started': {
      const p = ActionStarted.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`action_started for unknown agent ${p.agentId}`)
      let path: Array<[number, number]> | undefined
      if (p.verb === 'walk') {
        const w = WalkParams.parse(p.params)
        const found = findPath(state, a, w)
        if (!found) throw new Error(`action_started walk with no path for ${p.agentId}`)
        path = found
      }
      const activity = { verb: p.verb, ticksRemaining: p.duration, params: p.params, ...(path ? { path } : {}) }
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
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, activity: null } } }
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
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, asleep: true } } }
    }
    case 'agent_collapsed': {
      const p = AgentCollapsed.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_collapsed for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, collapsedSinceTick: event.tick } } }
    }
    case 'weather_changed': {
      const p = WeatherChanged.parse(event.payload)
      return { ...state, weather: { kind: p.kind, temperatureC: p.temperatureC } }
    }
    case 'agent_aged': {
      const p = AgentAged.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_aged for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, ageDays: a.ageDays + 1 } } }
    }
    case 'agent_died': {
      const p = AgentDied.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_died for unknown agent ${p.agentId}`)
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, alive: false, asleep: false, activity: null } } }
    }
    case 'agent_injured': {
      const p = AgentInjured.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`agent_injured for unknown agent ${p.agentId}`)
      const hp = Math.max(0, a.hp - config.health.injuryDamage[p.kind])
      const injuries = [...a.injuries, { kind: p.kind, day: Math.floor(event.tick / MINUTES_PER_DAY) }]
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, hp, injuries } } }
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
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, tendedTick: event.tick } } }
    }
    case 'hp_changed': {
      const p = HpChanged.parse(event.payload)
      const a = state.agents[p.agentId]
      if (!a) throw new Error(`hp_changed for unknown agent ${p.agentId}`)
      const hp = Math.max(0, Math.min(config.health.maxHp, a.hp + p.delta))
      let collapsedSinceTick = a.collapsedSinceTick
      if (collapsedSinceTick !== null
        && a.needs.hunger >= config.needs.collapseThreshold && a.needs.energy >= config.needs.collapseThreshold
        && hp >= config.health.collapseHp) collapsedSinceTick = null
      return { ...state, agents: { ...state.agents, [p.agentId]: { ...a, hp, collapsedSinceTick } } }
    }
    case 'crop_planted': {
      const p = CropPlanted.parse(event.payload)
      return {
        ...state,
        crops: {
          ...state.crops,
          [p.id]: { id: p.id, kind: p.kind, x: p.x, y: p.y, plantedDay: p.plantedDay, stage: 0, withered: false },
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
      return { ...state, wildlife: { fish: p.fish ?? state.wildlife.fish, deer: p.deer ?? state.wildlife.deer } }
    }
    case 'terrain_changed': {
      const p = TerrainChanged.parse(event.payload)
      const row = state.terrain[p.y]
      if (!row || p.x < 0 || p.x >= row.length) throw new Error(`terrain_changed out of bounds (${p.x}, ${p.y})`)
      const terrain = state.terrain.map((r, y) => (y === p.y ? r.map((t, x) => (x === p.x ? (p.tile as TileId) : t)) : r))
      return { ...state, terrain }
    }
    default:
      throw new Error(`unknown event type: ${event.type}`)
  }
}
