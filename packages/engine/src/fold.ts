import { DEFAULT_CONFIG, type SimConfig, type SimEvent } from '@sj/shared'
import type { WorldState } from './state.js'
import { AgentMoved, AgentSpawned, NeedChanged, TickAdvanced } from './events.def.js'

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
    default:
      throw new Error(`unknown event type: ${event.type}`)
  }
}
