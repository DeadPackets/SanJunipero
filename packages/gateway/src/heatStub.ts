import type { SimEvent } from '@sj/shared'

// Deterministic drama scorer — C7 replaces this reader, the /api/heat shape stays.
export const HEAT_WINDOW_TICKS = 60
export const HEAT_WEIGHTS: Record<string, number> = {
  agent_died: 20, fire_ignited: 12, fire_spread: 10, agent_injured: 8,
  structure_completed: 6, agent_collapsed: 6, crop_harvested: 3, agent_spoke: 2, item_moved: 1,
}

export type HeatWindow = { fromTick: number; toTick: number; agentId: string; score: number }

/** `${windowIndex}\n${agentId}` → score. The whole of what heat needs to remember: one number
 *  per 60-tick window an agent was in, which is the answer itself and not the events behind it. */
export type HeatScores = Map<string, number>
export const heatKey = (tick: number, agentId: string): string =>
  `${Math.floor(tick / HEAT_WINDOW_TICKS)}\n${agentId}`

/** Add one event's drama to a running score map. `api.ts` keeps ONE of these alive for the world
 *  and folds each event into it exactly once, so the log never has to be held to answer /api/heat. */
export function scoreEvent(scores: HeatScores, ev: SimEvent): void {
  const weight = HEAT_WEIGHTS[ev.type] ?? 0
  if (weight === 0) return
  const p = ev.payload as { agentId?: string; builderId?: string }
  const agentId = p.agentId ?? p.builderId ?? null
  if (agentId === null) return
  const key = heatKey(ev.tick, agentId)
  scores.set(key, (scores.get(key) ?? 0) + weight)
}

export function heatFromScores(scores: ReadonlyMap<string, number>): HeatWindow[] {
  return [...scores.entries()]
    .map(([key, score]) => {
      const [w, agentId] = key.split('\n') as [string, string]
      const fromTick = Number(w) * HEAT_WINDOW_TICKS
      return { fromTick, toTick: fromTick + HEAT_WINDOW_TICKS - 1, agentId, score }
    })
    .sort((a, b) => a.fromTick - b.fromTick || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
}

// readonly: the caller's array is never retained past this call.
export function heatWindows(events: readonly SimEvent[]): HeatWindow[] {
  const scores: HeatScores = new Map()
  for (const ev of events) scoreEvent(scores, ev)
  return heatFromScores(scores)
}
