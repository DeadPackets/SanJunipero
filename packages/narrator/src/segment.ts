import { MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import type { SceneSegment, SegmentConfig } from './types.js'

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  silenceTicks: 20,
  maxTicks: 240,
  minEvents: 2,
}

// Bare payload.id is an AGENT id only on these types; elsewhere it names a structure/item/crop.
const ID_IS_AGENT = new Set(['agent_spawned', 'agent_moved', 'needs_changed'])

type P = Record<string, unknown>

export function eventAgentIds(ev: SimEvent): string[] {
  const p = (ev.payload ?? {}) as P
  const ids: string[] = []
  if (typeof p.agentId === 'string') ids.push(p.agentId)
  if (ID_IS_AGENT.has(ev.type) && typeof p.id === 'string') ids.push(p.id)
  if (ev.type === 'structure_planned' && typeof p.builderId === 'string') ids.push(p.builderId)
  return ids
}

export function eventLocation(ev: SimEvent): { x: number; y: number } | null {
  const p = (ev.payload ?? {}) as P
  return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null
}

export function segmentScenes(
  events: SimEvent[],
  cfg: SegmentConfig = DEFAULT_SEGMENT_CONFIG,
): SceneSegment[] {
  const raw: SimEvent[][] = []
  let current: SimEvent[] = []
  for (const e of events) {
    if (current.length > 0) {
      const last = current[current.length - 1]!
      const start = current[0]!
      const boundary =
        e.tick - last.tick > cfg.silenceTicks ||
        e.tick - start.tick > cfg.maxTicks ||
        Math.floor(e.tick / MINUTES_PER_DAY) !== Math.floor(last.tick / MINUTES_PER_DAY)
      if (boundary) {
        raw.push(current)
        current = []
      }
    }
    current.push(e)
  }
  if (current.length > 0) raw.push(current)

  return raw
    .filter((evs) => evs.length >= cfg.minEvents)
    .map((evs) => {
      const cast: string[] = []
      let loc: { x: number; y: number } | null = null
      for (const e of evs) {
        for (const id of eventAgentIds(e)) if (!cast.includes(id)) cast.push(id)
        const l = eventLocation(e)
        if (l !== null) loc = l
      }
      return {
        day: Math.floor(evs[0]!.tick / MINUTES_PER_DAY),
        startTick: evs[0]!.tick,
        endTick: evs[evs.length - 1]!.tick,
        eventIds: evs.map((e) => e.seq),
        cast,
        location: loc === null ? null : `${loc.x},${loc.y}`,
      }
    })
}
