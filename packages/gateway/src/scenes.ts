import { ServerScene, type SimEvent } from '@sj/shared'

type SceneState = ServerScene['scene']

/** Scene STATE off the log, as the socket frame. `scene_line` makes no frame: the lines already
 *  reach a viewer as speech. A close carries only its id, so the open frame is held until then;
 *  a turn re-sends it, because a talk that became a quarrel is the same scene saying so. */
export function makeSceneRelay(): (events: readonly SimEvent[]) => ServerScene[] {
  const open = new Map<string, SceneState>()
  return (events) => {
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
        out.push({ t: 'scene', scene })
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
        const p = ev.payload as { id: string; summary: string }
        const was = open.get(p.id)
        if (was === undefined) continue
        open.delete(p.id)
        out.push({ t: 'scene', scene: { ...was, open: false, summary: p.summary } })
      }
    }
    return out
  }
}
