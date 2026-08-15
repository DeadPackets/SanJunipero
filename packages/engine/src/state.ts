import { z } from 'zod'
import type { SimEvent } from '@sj/shared'

export type AgentBody = { id: string; x: number; y: number; needs: { hunger: number; energy: number } }
export type WorldState = { tick: number; agents: Record<string, AgentBody> }

export function genesisState(): WorldState { return { tick: 0, agents: {} } }

const Spawned = z.object({ id: z.string(), x: z.number(), y: z.number() })
const Moved = Spawned
const NeedChanged = z.object({ id: z.string(), need: z.enum(['hunger', 'energy']), delta: z.number() })

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export function fold(state: WorldState, event: SimEvent): WorldState {
  switch (event.type) {
    case 'tick_advanced':
      return { ...state, tick: event.tick }
    case 'agent_spawned': {
      const p = Spawned.parse(event.payload)
      return { ...state, agents: { ...state.agents, [p.id]: { id: p.id, x: p.x, y: p.y, needs: { hunger: 100, energy: 100 } } } }
    }
    case 'agent_moved': {
      const p = Moved.parse(event.payload)
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
