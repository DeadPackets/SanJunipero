import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { createScene, type Scene } from './scene.js'
import { TextureBook } from './textures.js'
import { syncEntities } from './entities.js'
import { createCharacterLayer, type CharacterLayer } from './characters.js'

// The ONLY React/Pixi contact point — React renders nothing inside the canvas (spec §15).
export function StageMount({ store, onScene }: { store: WorldStore; onScene?: (scene: Scene) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    let scene: Scene | null = null
    let disposed = false
    let offSync: (() => void) | null = null
    let chars: CharacterLayer | null = null
    let tickFn: (() => void) | null = null
    void createScene(rootEl, store).then((s) => {
      if (disposed) {
        s.destroy()
        return
      }
      scene = s
      const book = new TextureBook()
      offSync = store.subscribe(() => syncEntities(s, book, store))
      syncEntities(s, book, store)
      chars = createCharacterLayer(s, book, store, (agentId) => {
        // click-to-inspect: the G6 check — route change only, React owns the chrome
        const url = `${location.pathname}?lens=inspector&agent=${encodeURIComponent(agentId)}`
        history.pushState(null, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      tickFn = () => chars?.tick(performance.now())
      s.app.ticker.add(tickFn)
      onScene?.(s)
    })
    return () => {
      disposed = true
      offSync?.()
      if (tickFn !== null && scene !== null) scene.app.ticker.remove(tickFn)
      chars?.destroy()
      scene?.destroy()
    }
  }, [])

  return <div ref={rootRef} className="stage-mount" />
}
