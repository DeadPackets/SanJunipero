import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { cameraActionFor, stepZoom } from './cameraNav.js'
import { createScene, type Scene } from './scene.js'
import { TextureBook } from './textures.js'
import { syncEntities } from './entities.js'
import { createCharacterLayer, type CharacterLayer } from './characters.js'
import { createBubbleLayer, type BubbleLayer } from './bubbles.js'
import { createAtmosphere, type Atmosphere } from './atmosphere.js'
import { createWeatherLayer, type WeatherLayer } from './weatherFx.js'
import { createAmbient, type AmbientDirector } from './ambient.js'
import { createInteriorScene, type InteriorScene } from './interiorScene.js'

// The ONLY React/Pixi contact point — React renders nothing inside the canvas (spec §15).
export function StageMount(
  { store, onScene, onInterior }: {
    store: WorldStore
    onScene?: (scene: Scene) => void
    /** the interior sub-scene opened or closed — App draws the back-to-town chrome from it */
    onInterior?: (structureId: string | null) => void
  },
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const interiorRef = useRef<InteriorScene | null>(null)
  // read in the Pixi callbacks, never subscribed to — a follow change must not remount Pixi
  const onInteriorRef = useRef(onInterior)
  onInteriorRef.current = onInterior

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const s = sceneRef.current
    if (s === null) return
    const action = cameraActionFor(e.key)
    if (action === null) return
    e.preventDefault()
    if (action.kind === 'pan') s.panBy(action.dx, action.dy)
    else if (action.kind === 'zoom') s.setZoom(stepZoom(s.getZoom(), action.dir))
    else s.centerHome()
  }

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
    let ambient: AmbientDirector | null = null
    let interior: InteriorScene | null = null
    let offInterior: (() => void) | null = null
    let offEvents: (() => void) | null = null
    let tickFn: (() => void) | null = null
    void createScene(rootEl, store).then((s) => {
      if (disposed) {
        s.destroy()
        return
      }
      scene = s
      const book = new TextureBook()
      const openDoor = (structureId: string): void => interiorRef.current?.setActive(structureId)
      offSync = store.subscribe(() => syncEntities(s, book, store, openDoor))
      syncEntities(s, book, store, openDoor)
      chars = createCharacterLayer(s, book, store, (agentId) => {
        // click-to-inspect: the G6 check — route change only, React owns the chrome
        const url = `${location.pathname}?lens=inspector&agent=${encodeURIComponent(agentId)}`
        history.pushState(null, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      bubbles = createBubbleLayer(s, store)
      atmosphere = createAtmosphere(s)
      weather = createWeatherLayer(s)
      ambient = createAmbient(s, store, { weather, bubbles, chars })
      sceneRef.current = s
      const charLayer = chars
      s.anchorOf = (agentId) => {
        const sp = charLayer.getSprite(agentId)
        return sp === null ? null : { x: sp.x, y: sp.y }
      }
      interior = createInteriorScene(s, store, book)
      s.interior = interior
      interiorRef.current = interior
      offInterior = interior.onChange((id) => onInteriorRef.current?.(id))
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
        ambient?.tick(dt)
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
      offInterior?.()
      if (tickFn !== null && scene !== null) scene.app.ticker.remove(tickFn)
      interiorRef.current = null
      interior?.destroy()
      chars?.destroy()
      bubbles?.destroy()
      ambient?.destroy()
      weather?.destroy()
      atmosphere?.destroy()
      scene?.destroy()
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="stage-mount"
      tabIndex={0}
      role="application"
      aria-label="Town map — arrow keys pan, plus and minus zoom, Home recenters"
      onKeyDown={onKeyDown}
    />
  )
}
