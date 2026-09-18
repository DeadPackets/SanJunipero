import type { WorldStore } from '../state/worldStore.js'
import { screenAnchor } from '../stage/anchor.js'
import type { Scene } from './scene.js'

export function agentScreenAnchor(scene: Scene, store: WorldStore, id: string) {
  const a = store.getState()?.agents[id]
  if (!a?.alive) return null
  if (scene.interior?.isActive()) {
    if (a.insideId !== scene.interior.activeId()) return null
    return scene.interior.speechAnchor?.(id) ?? null
  }
  if (a.insideId != null) return null
  const at = scene.pointOf('agent', id)
  if (!at) return null
  const foot = screenAnchor(scene.viewRect(), scene.getZoom(), at.sx, at.sy)
  return foot.onScreen ? { x: foot.x, y: foot.y - 40 * scene.getZoom(), footY: foot.y } : null
}
