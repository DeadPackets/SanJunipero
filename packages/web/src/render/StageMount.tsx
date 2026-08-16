import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { createScene, type Scene } from './scene.js'

// The ONLY React/Pixi contact point — React renders nothing inside the canvas (spec §15).
export function StageMount({ store, onScene }: { store: WorldStore; onScene?: (scene: Scene) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    let scene: Scene | null = null
    let disposed = false
    void createScene(rootEl, store).then((s) => {
      if (disposed) {
        s.destroy()
        return
      }
      scene = s
      onScene?.(s)
    })
    return () => {
      disposed = true
      scene?.destroy()
    }
  }, [])

  return <div ref={rootRef} className="stage-mount" />
}
