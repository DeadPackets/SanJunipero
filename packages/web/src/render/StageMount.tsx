import { useEffect, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { parseRoute, routeToPath } from '../ui/route.js'
import { FIRST_FRAME_COPY, firstFrameStuck } from '../ui/firstFrame.js'
import { cameraActionFor, stepZoom } from './cameraNav.js'
import { createScene, type Scene } from './scene.js'
import { installFaces } from './textFaces.js'
import { TextureBook } from './textures.js'
import { syncEntities, type WorldPick } from './entities.js'
import { createCharacterLayer, type CharacterLayer } from './characters.js'
import { createBubbleLayer, type BubbleLayer } from './bubbles.js'
import { createActLayer, type ActLayer } from './acts.js'
import { createAtmosphere, type Atmosphere } from './atmosphere.js'
import { createWeatherLayer, type WeatherLayer } from './weatherFx.js'
import { createAmbient, type AmbientDirector } from './ambient.js'
import { createLightPools, type LightPools } from './lightPools.js'
import { createSmoke, type SmokeLayer } from './smoke.js'
import { createVignette, type Vignette } from './vignette.js'
import { advanceWind } from './wind.js'
import { createInteriorScene, type InteriorScene } from './interiorScene.js'
import { createLandmarkLayer, type LandmarkLayer } from './landmarks.js'
import { createToponymLayer, type ToponymLayer } from './toponyms.js'

// The ONLY React/Pixi contact point — React renders nothing inside the canvas (spec §15).
export function StageMount({
  store,
  onScene,
  onInterior,
  onPick,
  onGround,
}: {
  store: WorldStore
  /** The live scene, and `null` the moment it is torn down — React must never be left
   *  holding a destroyed one, whose `app.ticker` is null and throws on the next touch. */
  onScene?: (scene: Scene | null) => void
  /** the interior sub-scene opened or closed — App draws the back-to-town chrome from it */
  onInterior?: (structureId: string | null) => void
  /** what the pointer landed on — App draws the popover, the canvas draws nothing of the kind */
  onPick?: (pick: WorldPick) => void
  /** a click that landed on the bare ground, which is how a viewer puts a pick back down */
  onGround?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const interiorRef = useRef<InteriorScene | null>(null)
  // read in the Pixi callbacks, never subscribed to — a follow change must not remount Pixi
  const onInteriorRef = useRef(onInterior)
  onInteriorRef.current = onInterior
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const onGroundRef = useRef(onGround)
  onGroundRef.current = onGround

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
    let acts: ActLayer | null = null
    let atmosphere: Atmosphere | null = null
    let weather: WeatherLayer | null = null
    let ambient: AmbientDirector | null = null
    let lightPools: LightPools | null = null
    let smoke: SmokeLayer | null = null
    let vignette: Vignette | null = null
    let interior: InteriorScene | null = null
    let landmarks: LandmarkLayer | null = null
    let toponyms: ToponymLayer | null = null
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
        toponyms = createToponymLayer(s, store)
        const marks = landmarks
        const carved = toponyms
        const nameTown = (): void => {
          marks.rebuild()
          marks.place()
          carved.rebuild()
          carved.place()
        }
        const pick = (p: WorldPick): void => onPickRef.current?.(p)
        // The rig already refuses a drag and anything that landed on a body or a building, so
        // what reaches here is bare ground — and bare ground is how a pick is put back down.
        s.onTilePointer(() => onGroundRef.current?.())
        offSync = store.subscribe(() => {
          syncEntities(s, book, store, openDoor, pick)
          nameTown()
        })
        syncEntities(s, book, store, openDoor, pick)
        // a place name is a map legend: it fades on the way in, so it follows the camera too
        offCamera = s.onCamera(() => {
          marks.place()
          carved.place()
        })
        nameTown()
        // click-to-inspect: the G6 check — route change only, React owns the chrome. The town
        // and the room pick a person the same way, so one ring answers for both.
        const selectAgent = (agentId: string): void => {
          const route = parseRoute(location.pathname, location.search)
          history.pushState(null, '', routeToPath({ ...route, agentId }))
          window.dispatchEvent(new PopStateEvent('popstate'))
        }
        chars = createCharacterLayer(s, book, store, selectAgent)
        bubbles = createBubbleLayer(s, store)
        acts = createActLayer(s, store)
        atmosphere = createAtmosphere(s)
        weather = createWeatherLayer(s, store)
        ambient = createAmbient(s, store, { weather, bubbles, chars })
        lightPools = createLightPools(s, store)
        smoke = createSmoke(s, store)
        vignette = createVignette(s.app) // last onto app.stage: over the weather
        sceneRef.current = s
        const charLayer = chars
        s.anchorOf = (agentId) => {
          const sp = charLayer.getSprite(agentId)
          return sp === null ? null : { x: sp.x, y: sp.y }
        }
        // The track over a head is the act layer's number, drawn by the character layer that
        // owns the slot it wraps. Same shape as `anchorOf`, and for the same reason.
        const actLayer = acts
        s.actFraction = (agentId) => actLayer.fractionOf(agentId)
        interior = createInteriorScene(s, store, book, selectAgent)
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
            } else if (ev.type === 'action_started') {
              // The one place the act's TRUE length exists: the world state carries what is
              // left to run, never what was asked for, and the night penalty is already in it.
              const p = ev.payload as { agentId: string; verb: string; duration: number }
              acts?.noteStart(p.agentId, p.verb, p.duration)
            }
          }
        })
        let seenThoughts = store.thoughtsSeq()
        let lastMs = performance.now()
        tickFn = () => {
          const now = performance.now()
          const dt = now - lastMs
          lastMs = now
          advanceWind(dt)
          chars?.tick(now)
          s.sortDepth() // one painter's order for the whole frame, after every box is published
          bubbles?.tick(now)
          acts?.tick()
          weather?.tick(dt)
          ambient?.tick(dt)
          lightPools?.tick(dt)
          smoke?.tick(dt)
          vignette?.tick()
          const state = store.getState()
          if (state !== null) {
            atmosphere?.update(state)
            weather?.setKind(state.weather.kind)
          }
          // Counted, not indexed: the log is a capped ring, so its indices are reused.
          const said = store.thoughtsSeq()
          if (said > seenThoughts) {
            const log = store.thoughtsLog()
            for (const t of log.slice(Math.max(0, log.length - (said - seenThoughts))))
              bubbles?.spawnThought(t.agentId, t.text)
            seenThoughts = said
          }
        }
        s.app.ticker.add(tickFn)
        published = true
        onScene?.(s)
      })
      .catch(() => {
        // No WebGL, no WebGPU, a context lost mid-build: without this the card sits on
        // "Looking for the town…" forever and never says why.
        if (disposed) return
        firstFrameStuck(FIRST_FRAME_COPY.blind)
        scene?.destroy()
        scene = null
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
      toponyms?.destroy()
      interior?.destroy()
      chars?.destroy()
      bubbles?.destroy()
      acts?.destroy()
      ambient?.destroy()
      lightPools?.destroy()
      smoke?.destroy()
      vignette?.destroy()
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
