import type { SimEvent } from '@sj/shared'

// Deterministic drama scorer — C7 replaces this reader, the /api/heat shape stays.
export const HEAT_WINDOW_TICKS = 60
export const HEAT_WEIGHTS: Record<string, number> = {
  agent_died: 20, fire_ignited: 12, fire_spread: 10, agent_injured: 8,
  structure_completed: 6, agent_collapsed: 6, crop_harvested: 3, agent_spoke: 2, item_moved: 1,
}

export type HeatWindow = { fromTick: number; toTick: number; agentId: string; score: number }

// readonly: the caller's array is memoised per world generation and shared between endpoints.
export function heatWindows(events: readonly SimEvent[]): HeatWindow[] {
  const scores = new Map<string, number>() // `${windowIndex}\n${agentId}` → score
  for (const ev of events) {
    const weight = HEAT_WEIGHTS[ev.type] ?? 0
    if (weight === 0) continue
    const p = ev.payload as { agentId?: string; builderId?: string }
    const agentId = p.agentId ?? p.builderId ?? null
    if (agentId === null) continue
    const key = `${Math.floor(ev.tick / HEAT_WINDOW_TICKS)}\n${agentId}`
    scores.set(key, (scores.get(key) ?? 0) + weight)
  }
  return [...scores.entries()]
    .map(([key, score]) => {
      const [w, agentId] = key.split('\n') as [string, string]
      const fromTick = Number(w) * HEAT_WINDOW_TICKS
      return { fromTick, toTick: fromTick + HEAT_WINDOW_TICKS - 1, agentId, score }
    })
    .sort((a, b) => a.fromTick - b.fromTick || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
}
