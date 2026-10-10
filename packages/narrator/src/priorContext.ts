import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY, isSeededStructureEvent, type SimEvent } from '@sj/shared'
import { eventAgentIds } from './segment.js'
import { pickMoments } from './moments.js'
import type { PublicRecord } from './types.js'

export function priorContext(
  db: Database.Database,
  today: readonly SimEvent[],
  nameOf: (id: string) => string,
): PublicRecord[] {
  if (today.length === 0) return []
  const start = Math.floor(today[0]!.tick / MINUTES_PER_DAY) * MINUTES_PER_DAY
  const cast = new Set(today.flatMap(eventAgentIds))
  const rows = db
    .prepare(`SELECT seq, tick, type, payload FROM events
    WHERE tick < ? AND tick >= ? AND type IN
    ('scene_closed', 'agent_spoke', 'scene_line', 'agent_died', 'agent_injured',
     'agent_recovered', 'action_completed', 'structure_completed', 'crop_harvested')
    ORDER BY seq DESC LIMIT 200`)
    .all(start, Math.max(0, start - 14 * MINUTES_PER_DAY)) as {
    seq: number
    tick: number
    type: string
    payload: string
  }[]
  const out: PublicRecord[] = []
  const town: PublicRecord[] = []
  const said = new Set<string>()
  for (const row of rows) {
    const ev: SimEvent = { ...row, payload: JSON.parse(row.payload) as unknown }
    if (isSeededStructureEvent(ev)) continue
    const townOutcome = ev.type === 'structure_completed' || ev.type === 'crop_harvested'
    if (!townOutcome && !eventAgentIds(ev).some((id) => cast.has(id))) continue
    const into = townOutcome ? town : out
    if (into.length >= (townOutcome ? 2 : 12)) continue
    const moment = pickMoments([ev], nameOf, 1)[0]
    if (!moment || said.has(moment.text)) continue
    said.add(moment.text)
    into.push({ eventSeq: row.seq, day: Math.floor(row.tick / MINUTES_PER_DAY), text: moment.text })
  }
  return [...out.slice(0, 12 - town.length), ...town].sort((a, b) => a.eventSeq - b.eventSeq)
}
