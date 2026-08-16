import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { createScene, type Scene } from './scene.js'
import { TextureBook } from './textures.js'
import { syncEntities } from './entities.js'
import { createCharacterLayer, type CharacterLayer } from './characters.js'
import { createBubbleLayer, type BubbleLayer } from './bubbles.js'
import { createAtmosphere, type Atmosphere } from './atmosphere.js'
import { createWeatherLayer, type WeatherLayer } from './weatherFx.js'

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
    let bubbles: BubbleLayer | null = null
    let atmosphere: Atmosphere | null = null
    let weather: WeatherLayer | null = null
    let offEvents: (() => void) | null = null
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
      bubbles = createBubbleLayer(s, store)
      atmosphere = createAtmosphere(s)
      weather = createWeatherLayer(s)
      offEvents = store.onEvents((evts) => {
        for (const ev of evts) {
          if (ev.type === 'agent_spoke') {
            const p = ev.payload as { agentId: string; text: string }
            bubbles?.spawnSpeech(p.agentId, p.text)
          }
        }
      })
      let seenThoughts = store.thoughtsLog().length
      let lastMs = performance.now()
      tickFn = () => {
        const now = performance.now()
        const dt = now - lastMs
        lastMs = now
        chars?.tick(now)
        bubbles?.tick(now)
        weather?.tick(dt)
        const state = store.getState()
        if (state !== null) {
          atmosphere?.update(state)
          weather?.setKind(state.weather.kind)
        }
        const log = store.thoughtsLog()
        for (; seenThoughts < log.length; seenThoughts++) {
          const t = log[seenThoughts]!
          bubbles?.spawnThought(t.agentId, t.text)
        }
      }
      s.app.ticker.add(tickFn)
      onScene?.(s)
    })
    return () => {
      disposed = true
      offSync?.()
      offEvents?.()
      if (tickFn !== null && scene !== null) scene.app.ticker.remove(tickFn)
      chars?.destroy()
      bubbles?.destroy()
      weather?.destroy()
      atmosphere?.destroy()
      scene?.destroy()
    }
  }, [])

  return <div ref={rootRef} className="stage-mount" />
}
