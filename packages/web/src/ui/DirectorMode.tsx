import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentBody } from '@sj/engine/state'
import type { StakeScore } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { rendersOnMap } from '../render/characters.js'
import { agentName } from '@sj/shared'
import { sceneShot } from '../render/sceneFraming.js'
import { CUT_MIN_MS, cameraClaim, quietSubject, townAsleep } from './directorCut.js'

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

const NO_CAST: readonly string[] = []

/** Who is alive and has no body on the town map — indoors, where the exterior view draws
 *  nothing. `rendersOnMap` is the character layer's own answer, asked here rather than guessed. */
function indoorsIn(state: { agents: Record<string, AgentBody> } | null): Set<string> {
  const out = new Set<string>()
  for (const a of Object.values(state?.agents ?? {})) {
    if (a.alive && !rendersOnMap(a)) out.add(a.id)
  }
  return out
}

/** Whom the quiet round may turn over: alive, and drawn on the street. Sorted, so the round is
 *  the same order for every viewer and a rename cannot reshuffle it. */
function outdoorLiving(
  state: { agents: Record<string, AgentBody> } | null,
  indoors: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const a of Object.values(state?.agents ?? {})) {
    if (a.alive && !indoors.has(a.id)) out.push(a.id)
  }
  return out.sort()
}

/** The one string that says which shot is on screen. A cut whose people are the same people is
 *  the same shot, however the score under it moved. */
const keyOf = (cut: StakeScore | null): string => (cut === null ? '' : cut.agentIds.join(' '))

/** The first name in a shot key, without cutting the whole key into an array for it. */
function firstOf(key: string): string | null {
  if (key === '') return null
  const at = key.indexOf(' ')
  return at === -1 ? key : key.slice(0, at)
}

/** `autoCut` is the live town being televised; `pinned` is a viewer who asked to follow one
 *  person, which outranks the gateway. It draws nothing — `DirectorCue` prints the words. */
export function DirectorMode({
  store,
  scene,
  autoCut,
  pinned = null,
  moment = NO_CAST,
  onCue,
  onWhy,
  onShot,
}: {
  store: WorldStore
  scene: Scene | null
  autoCut: boolean
  pinned?: string | null
  /** the cast of the moment being replayed, which the shot is FOR */
  moment?: readonly string[]
  onCue?: (text: string | null) => void
  /** the gateway's sentence for the shot it scored, in the town's own words */
  onWhy?: (why: string | null) => void
  /** who is in frame, the scene it is of, and whether the shot was CUT to (the gateway's or a
   *  moment's) rather than turned to by the quiet round — what the card and the caption follow */
  onShot?: (cast: readonly string[], sceneId: string | null, cut: boolean) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const frame = useSyncExternalStore(store.subscribe, store.getDirector)
  // The overview is OF a town, so it has to wait for one: an empty world has no centre but
  // whatever corner of the ground the camera was created over.
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)
  // The cut the camera is actually on. The gateway may change its mind faster than a viewer can
  // read a face, so the eight-second floor is kept here, over frames, not over polls.
  const [held, setHeld] = useState<StakeScore | null>(null)
  const lastCutRef = useRef(0)

  useEffect(() => {
    const next = autoCut ? (frame?.cut ?? null) : null
    if (next === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the socket IS the external system this synchronises; the frame arrives as a store snapshot and the wall clock decides when it may land.
      setHeld(null)
      return
    }
    // The same people, a fresher sentence: not a cut, so it lands whatever the clock says.
    if (keyOf(next) === keyOf(held)) {
      setHeld(next)
      return
    }
    // No bypass for the first one: arming the director must not yank the camera the instant a
    // frame lands, and toggling it off and on again must not do it every time.
    const now = performance.now()
    if (now - lastCutRef.current >= CUT_MIN_MS) {
      lastCutRef.current = now
      setHeld(next)
    }
  }, [frame, autoCut, held])

  // One object per cut rather than one per render: the ladder reads a frame, and every render
  // that built a fresh literal would re-run the camera effect under it.
  const quiet = autoCut && frame?.quiet === true
  const shotFrame = useMemo(() => ({ cut: held, quiet }), [held, quiet])
  const indoors = indoorsIn(state)
  const asleep = townAsleep(state?.agents)
  const claim = cameraClaim(
    pinned,
    moment,
    indoors,
    shotFrame,
    asleep,
    // A hand on the camera stands the round down with the director, for the same twenty seconds.
    autoCut ? quietSubject(outdoorLiving(state, indoors), store.getTick()) : null,
  )
  const claimBy = claim.by
  const castKey = claim.by === 'cut' || claim.by === 'moment' ? claim.cast.join(' ') : ''
  const followed = claim.by === 'pinned' || claim.by === 'round' ? claim.agentId : null
  const sceneId = claim.by === 'cut' ? (held?.sceneId ?? null) : null
  // Who the camera is ON, which is not the same question as who it frames TOGETHER: a round
  // turn is a shot too, and the caption over it has to follow the face it moved to.
  const shotKey = castKey !== '' ? castKey : (followed ?? '')

  // Centre BEFORE the stop changes: the zoom eases about whatever the middle of the screen holds.
  useEffect(() => {
    if (scene === null) return
    // A shot the exterior view cannot show takes nobody, and it HOLDS where it is: a camera that
    // cut away would be showing three closed doors while the room talks behind them.
    if (claimBy === 'hold') return
    if (castKey !== '') {
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
      // they were when the gateway scored it.
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

  // Split from the key rather than passed as the claim's own array: a fresh array every render
  // would re-run this on every tick of the town.
  const isCut = claimBy === 'cut' || claimBy === 'moment'
  useEffect(() => {
    onShot?.(shotKey === '' ? NO_CAST : shotKey.split(' '), sceneId, isCut)
  }, [shotKey, sceneId, isCut, onShot])

  // Who the camera is on, for the layers that live in the Pixi closure — the thought gate keeps
  // every wisp of the subject, and on a broadcast nobody has picked anybody.
  const subject = castKey === '' ? followed : firstOf(castKey)
  useEffect(() => {
    if (scene === null) return
    // eslint-disable-next-line react-hooks/immutability -- Scene is an external Pixi handle; this writes to the canvas, not to React data.
    scene.cameraSubject = subject
  }, [scene, subject])

  const name = followed === null ? null : agentName(state?.agents, followed)
  useEffect(() => {
    onCue?.(name === null ? null : `${pinned === null ? 'DIRECTOR' : 'FOLLOWING'} · ${name}`)
  }, [name, pinned, onCue])

  // The sentence belongs to the shot the camera is HOLDING, never to a frame it has not taken:
  // a caption that named the newer cut would describe people who are not in the picture.
  const why = claimBy === 'cut' ? (held?.why ?? null) : null
  useEffect(() => {
    onWhy?.(why)
  }, [why, onWhy])

  return null
}
