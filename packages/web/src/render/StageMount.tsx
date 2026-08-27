import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { cameraActionFor, stepZoom } from './cameraNav.js'
import { createScene, type Scene } from './scene.js'
import { installFaces } from './textFaces.js'
import { TextureBook } from './textures.js'
import { syncEntities } from './entities.js'
import { createCharacterLayer, type CharacterLayer } from './characters.js'
import { createBubbleLayer, type BubbleLayer } from './bubbles.js'
import { createAtmosphere, type Atmosphere } from './atmosphere.js'
import { createWeatherLayer, type WeatherLayer } from './weatherFx.js'
import { createAmbient, type AmbientDirector } from './ambient.js'
import { createLightPools, type LightPools } from './lightPools.js'
import { createInteriorScene, type InteriorScene } from './interiorScene.js'
import { createLandmarkLayer, type LandmarkLayer } from './landmarks.js'

// The ONLY React/Pixi contact point — React renders nothing inside the canvas (spec §15).
export function StageMount({
  store,
  onScene,
  onInterior,
}: {
  store: WorldStore
  /** The live scene, and `null` the moment it is torn down — React must never be left
   *  holding a destroyed one, whose `app.ticker` is null and throws on the next touch. */
  onScene?: (scene: Scene | null) => void
  /** the interior sub-scene opened or closed — App draws the back-to-town chrome from it */
  onInterior?: (structureId: string | null) => void
}) {
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
    let published = false
    let offSync: (() => void) | null = null
    let chars: CharacterLayer | null = null
    let bubbles: BubbleLayer | null = null
    let atmosphere: Atmosphere | null = null
    let weather: WeatherLayer | null = null
    let ambient: AmbientDirector | null = null
    let lightPools: LightPools | null = null
    let interior: InteriorScene | null = null
    let landmarks: LandmarkLayer | null = null
    let offCamera: (() => void) | null = null
    let offInterior: (() => void) | null = null
    let offEvents: (() => void) | null = null
    let tickFn: (() => void) | null = null
    // Faces install before the scene exists so the first label drawn is already a bitmap
    // glyph; installFaces resolves even when the webfonts never do.
    void installFaces(document)
      .then(() => createScene(rootEl, store))
      .then((s) => {
        if (disposed) {
          s.destroy()
          return
        }
        scene = s
        const book = new TextureBook()
        const openDoor = (structureId: string): void => {
          s.tags.hideAll() // a destroyed sprite never fires pointerout
          interiorRef.current?.setActive(structureId)
        }
        landmarks = createLandmarkLayer(s, store)
        const marks = landmarks
        offSync = store.subscribe(() => {
          syncEntities(s, book, store, openDoor)
          marks.rebuild()
          marks.place()
        })
        syncEntities(s, book, store, openDoor)
        // a place name is a map legend: it fades on the way in, so it follows the camera too
        offCamera = s.onCamera(() => {
          marks.place()
        })
        marks.rebuild()
        marks.place()
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
        lightPools = createLightPools(s, store)
        sceneRef.current = s
        const charLayer = chars
        s.anchorOf = (agentId) => {
          const sp = charLayer.getSprite(agentId)
          return sp === null ? null : { x: sp.x, y: sp.y }
        }
        interior = createInteriorScene(s, store, book)
        s.interior = interior
        interiorRef.current = interior
        offInterior = interior.onChange((id) => {
          s.tags.hideAll()
          onInteriorRef.current?.(id)
        })
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
          s.sortDepth() // one painter's order for the whole frame, after every box is published
          bubbles?.tick(now)
          weather?.tick(dt)
          ambient?.tick(dt)
          lightPools?.tick(dt)
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
        published = true
        onScene?.(s)
      })
    return () => {
      disposed = true
      // Fast Refresh remounts this component and the effect below destroys the scene; without
      // this line the chrome upstream keeps the dead one and throws on its next ticker call.
      if (published) onScene?.(null)
      offSync?.()
      offEvents?.()
      offCamera?.()
      offInterior?.()
      if (tickFn !== null && scene !== null) scene.app.ticker.remove(tickFn)
      interiorRef.current = null
      landmarks?.destroy()
      interior?.destroy()
      chars?.destroy()
      bubbles?.destroy()
      ambient?.destroy()
      lightPools?.destroy()
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
