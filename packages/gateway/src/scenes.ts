import type Database from 'better-sqlite3'
import { ServerScene, type ServerTranscript, type SimEvent } from '@sj/shared'

type SceneState = ServerScene['scene']

export function makeSceneRelay(): {
  fold(events: readonly SimEvent[]): ServerScene[]
  snapshot(): ServerScene[]
  transcripts(atTick: number): ServerTranscript[]
} {
  const open = new Map<string, SceneState>()
  const transcripts = new Map<string, { lines: ServerTranscript['lines']; truncated: boolean }>()
  const fold = (events: readonly SimEvent[]): ServerScene[] => {
    const out: ServerScene[] = []
    for (const ev of events) {
      if (ev.type === 'scene_opened') {
        const p = ev.payload as Omit<SceneState, 'open'>
        const scene: SceneState = {
          id: p.id,
          kind: p.kind,
          participants: p.participants,
          topic: p.topic,
          stakes: p.stakes,
          open: true,
        }
        open.set(scene.id, scene)
        transcripts.set(scene.id, { lines: [], truncated: false })
        out.push({ t: 'scene', scene })
      } else if (ev.type === 'scene_line') {
        const p = ev.payload as { id: string; agentId: string; text: string }
        const transcript = transcripts.get(p.id)
        if (transcript === undefined || transcript.lines.some((line) => line.seq === ev.seq))
          continue
        transcript.lines.push({ seq: ev.seq, tick: ev.tick, agentId: p.agentId, text: p.text })
        if (transcript.lines.length > 100) {
          transcript.lines.shift()
          transcript.truncated = true
        }
      } else if (ev.type === 'scene_turned') {
        const p = ev.payload as Pick<SceneState, 'id' | 'kind' | 'participants' | 'stakes'>
        const was = open.get(p.id)
        if (was === undefined) continue
        const scene: SceneState = {
          ...was,
          kind: p.kind,
          participants: p.participants,
          stakes: p.stakes,
        }
        open.set(scene.id, scene)
        out.push({ t: 'scene', scene })
      } else if (ev.type === 'scene_closed') {
        const p = ev.payload as { id: string; summary: string; beat?: string }
        const was = open.get(p.id)
        if (was === undefined) continue
        open.delete(p.id)
        transcripts.delete(p.id)
        const beat = p.beat === undefined || p.beat === '' ? {} : { beat: p.beat }
        out.push({ t: 'scene', scene: { ...was, open: false, summary: p.summary, ...beat } })
      }
    }
    return out
  }
  return {
    fold,
    snapshot: () => [...open.values()].map((scene) => ({ t: 'scene', scene })),
    transcripts: (atTick) =>
      [...transcripts].map(([sceneId, transcript]) => ({
        t: 'transcript',
        sceneId,
        atTick,
        catchup: true,
        ...transcript,
      })),
  }
}

export function scenesAt(db: Database.Database, tick: number): ReturnType<typeof makeSceneRelay> {
  const relay = makeSceneRelay()
  const rows = db
    .prepare(`
    SELECT seq, tick, type, payload FROM events
    WHERE type IN ('scene_opened', 'scene_turned', 'scene_line') AND tick <= ?
      AND json_extract(payload, '$.id') IN (
        SELECT json_extract(o.payload, '$.id') FROM events o
        WHERE o.type = 'scene_opened' AND o.tick <= ?
          AND NOT EXISTS (
            SELECT 1 FROM events c WHERE c.type = 'scene_closed' AND c.tick <= ?
              AND json_extract(c.payload, '$.id') = json_extract(o.payload, '$.id')
          )
      )
    ORDER BY seq
  `)
    .all(tick, tick, tick) as { seq: number; tick: number; type: string; payload: string }[]
  relay.fold(rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) as unknown })))
  return relay
}
