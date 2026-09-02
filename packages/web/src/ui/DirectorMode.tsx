import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentBody } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { rendersOnMap } from '../render/characters.js'
import { agentName, type HeatWindow } from '@sj/shared'
import { sceneCast, sceneShot } from '../render/sceneFraming.js'
import { CUT_MIN_MS, subjectFor } from './directorCut.js'
import type { SceneStage } from './stageCue.js'
import { useEndpointFor, useFeed } from './useEndpoint.js'

export const HEAT_POLL_MS = 5000
export const DIRECTOR_ZOOM = 3 as const
/** Two speakers two tiles apart are 156 world px apart, which a 1280-wide frame holds at 2×
 *  and no frame holds at 3× — and a two-person exchange is what the director exists to find.
 *  Narrower than that the wider stop spends the whole face to gain nothing beside it. */
export const DIRECTOR_ZOOM_WIDE = 2 as const
export const WIDE_VIEWPORT_PX = 1280
export const OVERVIEW_ZOOM = 1 as const

export function directorZoom(width: number): typeof DIRECTOR_ZOOM | typeof DIRECTOR_ZOOM_WIDE {
  return width >= WIDE_VIEWPORT_PX ? DIRECTOR_ZOOM_WIDE : DIRECTOR_ZOOM
}

/** A heat read the gateway refused reads as "no window scored", so the quiet round keeps turning
 *  while it is down. The broadcast path has no operator to notice a caption stuck on one face. */
const NO_HEAT: HeatWindow[] = []

/** Who is alive and has no body on the town map — indoors, where the exterior view draws
 *  nothing. `rendersOnMap` is the character layer's own answer, asked here rather than guessed. */
function indoorsIn(state: { agents: Record<string, AgentBody> } | null): Set<string> {
  const out = new Set<string>()
  for (const a of Object.values(state?.agents ?? {})) {
    if (a.alive && !rendersOnMap(a)) out.add(a.id)
  }
  return out
}

/** Who the camera answers to, closest claim first. A viewer who asked to follow somebody always
 *  wins: automation never overrules a hand on the lens. Below that a scene owns the shot — it is
 *  the thing the town is doing — and the heat director only gets what is left. */
export type CameraClaim =
  | { by: 'pinned'; agentId: string }
  | { by: 'scene'; cast: readonly string[] }
  | { by: 'cut'; agentId: string }
  /** A scene the map cannot show: the director still stands down, and the shot HOLDS. */
  | { by: 'hold' }
  | { by: 'town' }

export function cameraClaim(
  pinned: string | null,
  stage: SceneStage | null,
  indoors: ReadonlySet<string>,
  cut: string | null,
): CameraClaim {
  if (pinned !== null) return { by: 'pinned', agentId: pinned }
  if (stage !== null) {
    const cast = sceneCast(stage.scene.participants, indoors)
    return cast.length === 0 ? { by: 'hold' } : { by: 'scene', cast }
  }
  return cut === null ? { by: 'town' } : { by: 'cut', agentId: cut }
}

/** `autoCut` is the live town being televised; `pinned` is a viewer who asked to follow one
 *  person, which outranks the heat. It draws nothing — `DirectorCue` prints the word. */
export function DirectorMode({
  store,
  scene,
  stage = null,
  autoCut,
  pinned = null,
  onCue,
}: {
  store: WorldStore
  scene: Scene | null
  /** the scene the town is holding, while it is open and while its summary is still up */
  stage?: SceneStage | null
  autoCut: boolean
  pinned?: string | null
  onCue?: (text: string | null) => void
}) {
  const [cut, setCut] = useState<string | null>(null)
  const followedRef = useRef<string | null>(null)
  const lastCutRef = useRef(0)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  // The overview is OF a town, so it has to wait for one: an empty world has no centre but
  // whatever corner of the ground the camera was created over.
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)

  const feed = useEndpointFor<HeatWindow[]>(
    autoCut && pinned === null ? '/api/heat' : null,
    undefined,
    HEAT_POLL_MS,
  )
  const heat = useFeed(feed)
  // The round turns on the POLL, not on the answer changing: an unchanged heat body hands back
  // the same read, and a director that only cut when the numbers moved would freeze on one face.
  const beat = useSyncExternalStore(feed.subscribe, feed.beat)

  // `autoCut` is also the hands-off-the-camera signal: it drops for twenty seconds after a pan
  // or a zoom, and a scene must not take a camera the viewer has just steered either.
  const claim = cameraClaim(pinned, autoCut ? stage : null, indoorsIn(state), autoCut ? cut : null)
  const claimBy = claim.by
  const castKey = claim.by === 'scene' ? claim.cast.join(' ') : ''
  const followed = claim.by === 'pinned' || claim.by === 'cut' ? claim.agentId : null

  useEffect(() => {
    if (!autoCut) {
      followedRef.current = null
      return
    }
    // A scene owns the shot while it runs, so the round waits rather than cutting away from it.
    if (claimBy === 'scene' || claimBy === 'hold') return
    if (!heat.loaded) return
    // read here, never subscribed to — the town changing must not turn the round
    const living = Object.values(store.getState()?.agents ?? {}).filter((a) => a.alive)
    const people = living.map((a) => a.id).sort()
    const next = subjectFor(
      heat.data ?? NO_HEAT,
      followedRef.current,
      store.getTick(),
      people,
      // the character layer's own answer to "does the exterior view draw this body"
      indoorsIn(store.getState()),
    )
    const now = performance.now()
    if (next !== null && next !== followedRef.current && now - lastCutRef.current >= CUT_MIN_MS) {
      followedRef.current = next
      lastCutRef.current = now
      setCut(next)
    }
  }, [store, autoCut, claimBy, heat, beat])

  // Centre BEFORE the stop changes: the zoom eases about whatever the middle of the screen holds.
  useEffect(() => {
    if (scene === null) return
    // A scene the exterior view cannot show takes nobody, and the shot HOLDS where it is: a
    // camera that cut away would be showing three closed doors while the room talks behind them.
    if (claimBy === 'hold') return
    if (claimBy === 'scene') {
      const cast = castKey.split(' ')
      const stageBox = { w: scene.app.screen.width, h: scene.app.screen.height }
      const where = (): ReturnType<typeof sceneShot> =>
        sceneShot(
          cast
            .map((id) => scene.pointOf('agent', id))
            .filter((p): p is { sx: number; sy: number } => p !== null),
          stageBox,
        )
      const opening = where()
      if (opening === null) return
      scene.setZoom(opening.stop)
      // The room, every frame: the shot is cut to where they are standing NOW, not to where
      // they were when the coordinator opened it.
      scene.setFollow(() => {
        const shot = where()
        return shot === null ? null : { x: shot.sx, y: shot.sy }
      })
      return () => {
        scene.setFollow(null)
      }
    }
    if (followed === null) {
      scene.setFollow(null)
      if (awake) {
        scene.centerHome()
        scene.setZoom(OVERVIEW_ZOOM)
      }
      return
    }
    scene.setZoom(directorZoom(window.innerWidth))
    scene.setFollow(() => {
      const anchor = scene.anchorOf?.(followed)
      if (anchor !== undefined && anchor !== null) return anchor
      const a = store.getState()?.agents[followed]
      if (a === undefined) return null
      const { sx, sy } = tileToScreen(a.x, a.y)
      return { x: sx, y: sy }
    })
    return () => {
      scene.setFollow(null)
    }
  }, [scene, store, claimBy, castKey, followed, awake])

  const name = followed === null ? null : agentName(state?.agents, followed)
  useEffect(() => {
    onCue?.(name === null ? null : `${pinned === null ? 'DIRECTOR' : 'FOLLOWING'} · ${name}`)
  }, [name, pinned, onCue])

  return null
}
