import { DEFAULT_CONFIG, type SimConfig, type SimEvent } from '@sj/shared'
import type { WorldState } from './state.js'
import {
  ActionCompleted, ActionInterrupted, ActionProgressed, ActionStarted,
  AgentMoved, AgentSpawned, AgentWoke, ItemMoved, ItemQtyChanged, ItemSpawned, NeedChanged,
  SkillGained, StructureCompleted, StructureDamaged, StructureDestroyed, StructurePlanned,
  StructureProgressed, TickAdvanced,
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
      return { ...state, agents: { ...state.agents, [p.id]: { ...a, needs: { ...a.needs, [p.need]: clamp(a.needs[p.need] + p.delta) } } } }
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
    default:
      throw new Error(`unknown event type: ${event.type}`)
  }
}
