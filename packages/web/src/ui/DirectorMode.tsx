import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentBody } from '@sj/engine/state'
import type { StakeScore } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { fitStop, type ZoomStop } from '../render/camera.js'
import { type Facing, facingFrom, tileToScreen } from '../render/iso.js'
import { rendersOnMap } from '../render/characters.js'
import { agentName, PEAK_SCORE } from '@sj/shared'
import { sceneBox, sceneShot } from '../render/sceneFraming.js'
import type { TensionTurn } from '../render/tension.js'
import { CUT_MIN_MS, type CameraClaim, cameraClaim, townAsleep } from './directorCut.js'
import { cutFloor, quietRound } from './autoCut.js'
import { openingShot } from './coldOpen.js'
import {
  driftAt,
  nextShot,
  PEAK_TURN_HOLD_MS,
  pushedStop,
  type Shot,
  type ShotKind,
  type ShotSpec,
  shotKindFor,
  shotOnTurn,
} from './shot.js'

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
const NEVER_TAKEN = { current: false } as const

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
const keyOf = (cut: StakeScore): string => cut.agentIds.join(' ')

/** The first name in a shot key, without cutting the whole key into an array for it. */
function firstOf(key: string): string | null {
  if (key === '') return null
  const at = key.indexOf(' ')
  return at === -1 ? key : key.slice(0, at)
}

/** The camera surface the director drives, named on its own so a shot can be taken over a fake
 *  one: where the camera ended up is the one thing a test of this file has to be able to read. */
export type ShotCamera = Pick<
  Scene,
  'setZoom' | 'setFollow' | 'centerHome' | 'pointOf' | 'anchorOf' | 'interior'
> & { app: { screen: { width: number; height: number } } }

/** What the shot is OF, off the claim alone. Every rule the camera and the caption follow is
 *  here rather than inside an effect, so a test can read them without a React tree. */
/** The talk a pinned body is standing in, which is the floor a viewer who picked somebody
 *  should get. Null when they are in none, because a floor round one person says the opposite
 *  of what a floor is for. */
export function shotSceneFor(
  followed: string,
  open: readonly { id: string; participants: readonly string[] }[],
): string | null {
  return open.find((sc) => sc.participants.includes(followed))?.id ?? null
}

export function shotOf(
  claim: CameraClaim,
  held: StakeScore | null,
): {
  castKey: string
  followed: string | null
  sceneId: string | null
  shotKey: string
  isCut: boolean
  why: string | null
} {
  const framedTogether =
    claim.by === 'cut' || claim.by === 'moment' || claim.by === 'interior' ? claim.cast : null
  const castKey = framedTogether === null ? '' : framedTogether.join(' ')
  const followed = claim.by === 'pinned' || claim.by === 'round' ? claim.agentId : null
  // The sentence and the scene belong to the gateway's own shot, never to a moment being
  // replayed: a caption off the live cut would describe people who are not in the picture.
  const gateway = claim.by === 'cut' || claim.by === 'interior'
  return {
    castKey,
    followed,
    sceneId: gateway ? (held?.sceneId ?? null) : null,
    // Who the camera is ON, which is not the same question as who it frames TOGETHER: a round
    // turn is a shot too, and the caption over it has to follow the face it moved to.
    shotKey: castKey !== '' ? castKey : (followed ?? ''),
    isCut: framedTogether !== null,
    why: gateway ? (held?.why ?? null) : null,
  }
}

/** What the camera does for one claim, and how to put it back. A claim it cannot show HOLDS, and
 *  a released claim moves nothing at all: the overview is an opening shot, never the thing the
 *  camera does on its way out of a claim. */
export function driveShot(
  scene: ShotCamera,
  store: Pick<WorldStore, 'getState'>,
  claim: {
    by: CameraClaim['by']
    castKey: string
    followed: string | null
    structureId: string | null
    awake: boolean
  },
  framed: { current: boolean },
  /** Whether the viewer has ever taken the camera. `framed` says the world has been shown, which
   *  is a different fact: a session that opened on a HOLD had shown nothing and jumped home. */
  taken: { readonly current: boolean } = NEVER_TAKEN,
  shot: Shot | null = null,
): (() => void) | undefined {
  // A shot the exterior view cannot show takes nobody, and it HOLDS where it is: a camera that
  // cut away would be showing three closed doors while the room talks behind them.
  if (claim.by === 'hold') return undefined
  // ANY shot is the framing this viewer got. After one, a hand has been on the lens and the
  // town may never be thrown home under its own drag.
  const opening = !framed.current
  if (claim.awake) framed.current = true
  const room = claim.structureId
  if (claim.by === 'interior' && room !== null) {
    scene.setFollow(null)
    // A viewer who opened a room keeps it: the director walks into an empty stage or none.
    if ((scene.interior?.activeId() ?? null) === null) scene.interior?.setActive(room)
    return () => {
      if (scene.interior?.activeId() === room) scene.interior.setActive(null)
    }
  }
  if (claim.castKey !== '') {
    const cast = claim.castKey.split(' ')
    const stageBox = { w: scene.app.screen.width, h: scene.app.screen.height }
    const pointsNow = (): { sx: number; sy: number }[] =>
      cast
        .map((id) => scene.pointOf('agent', id))
        .filter((p): p is { sx: number; sy: number } => p !== null)
    const where = (): ReturnType<typeof sceneShot> => sceneShot(pointsNow(), stageBox)
    // The subject faces whoever they are framed with, which is the character layer's own rule
    // for a body standing in a scene. One body alone has no direction and does not drift.
    const facing = (): Facing | null => {
      const agents = store.getState()?.agents
      const a = agents?.[cast[0] ?? '']
      const b = agents?.[cast[1] ?? '']
      return a === undefined || b === undefined ? null : facingFrom(b.x - a.x, b.y - a.y)
    }
    // A close is the one stop that is a clock rather than the framing box, and it may pass the
    // two-shot cap. It may never pass the box: a turn in a gathering pushed in past the cast.
    const stopNow = (fitted: ZoomStop): ZoomStop => {
      if (shot?.kind !== 'close') return fitted
      const push = pushedStop(shot, performance.now())
      const box = sceneBox(pointsNow())
      const cap = box === null ? fitted : fitStop(box, stageBox)
      return push < cap ? push : cap
    }
    const first = where()
    if (first !== null) scene.setZoom(stopNow(first.stop))
    // Resolved on the ticker: the shot is cut to where they are standing NOW, and a cast the
    // character layer has not drawn yet is waited for rather than dropped.
    let stopped = first !== null
    const until = performance.now() + CUT_MIN_MS
    scene.setFollow(() => {
      // Past one shot's own minimum the wait is over. The shot stands DOWN rather than answering
      // null for the rest of the claim, which left the camera stranded wherever the last one ended.
      if (!stopped && performance.now() > until) {
        scene.setFollow(null)
        return null
      }
      const at = where()
      if (at === null) return null
      // A close re-asks every frame: its stop is a clock, not the framing box.
      if (!stopped || (shot !== null && shot.kind === 'close')) {
        stopped = true
        scene.setZoom(stopNow(at.stop))
      }
      if (shot === null) return { x: at.sx, y: at.sy }
      const d = driftAt(shot, facing(), performance.now())
      return { x: at.sx + Math.round(d.dx), y: at.sy + Math.round(d.dy) }
    })
    return () => {
      scene.setFollow(null)
    }
  }
  const followed = claim.followed
  if (followed === null) {
    // Standing down means the camera STOPS. Only the very first frame is framed for the
    // viewer: after that a hand on the lens got the town thrown home under its own drag.
    if (!claim.awake || !opening || taken.current) return undefined
    scene.centerHome()
    scene.setZoom(OVERVIEW_ZOOM)
    return undefined
  }
  // The stop is a function of the window, so a resize has to re-ask it: dragged across 1280
  // the wrong stop stood until the claim next changed.
  const stop = (): void => {
    scene.setZoom(directorZoom(window.innerWidth))
  }
  stop()
  window.addEventListener('resize', stop)
  scene.setFollow(() => {
    const anchor = scene.anchorOf?.(followed)
    if (anchor !== undefined && anchor !== null) return anchor
    const a = store.getState()?.agents[followed]
    if (a === undefined) return null
    const { sx, sy } = tileToScreen(a.x, a.y)
    return { x: sx, y: sy }
  })
  return () => {
    window.removeEventListener('resize', stop)
    scene.setFollow(null)
  }
}

/** The shot on screen and what it is of. One value, so the caption can never describe a cast
 *  the floor turned away. */
type Shown = {
  shot: Shot
  by: CameraClaim['by']
  structureId: string | null
  of: {
    castKey: string
    followed: string | null
    sceneId: string | null
    isCut: boolean
    why: string | null
  }
}

/** What the world is asking the camera for, or null for a claim that asks for no shot at all. */
function specOf(
  by: CameraClaim['by'],
  kind: Exclude<ShotKind, 'overview'>,
  room: string | null,
  of: Shown['of'],
): ShotSpec | null {
  if (by === 'hold') return null
  if (room !== null) return { kind, target: { at: 'room', structureId: room }, why: of.why ?? '' }
  if (of.castKey !== '')
    return { kind, target: { at: 'cast', ids: of.castKey.split(' ') }, why: of.why ?? '' }
  if (of.followed !== null) return { kind, target: { at: 'body', id: of.followed }, why: '' }
  return { kind: 'overview', target: { at: 'town' }, why: '' }
}

/** The shot ON SCREEN, kept across renders, which is not always the shot the world is asking
 *  for: one inside its own floor is not replaced, so a round turn and a stand-down wait as long
 *  as a cut does. */
export function shotHold(): (
  want: { spec: ShotSpec | null; byHand: boolean; turn: TensionTurn | null } & Omit<Shown, 'shot'>,
) => Shown | null {
  let on: Shown | null = null
  /** the newest turn the world sent, when it landed, and whether a shot has taken it */
  let turn: { it: TensionTurn; atMs: number; taken: boolean } | null = null
  return (want) => {
    const now = performance.now()
    const shot = nextShot(on?.shot ?? null, want.spec, now, want.byHand)
    if (shot === null) on = null
    else if (shot !== on?.shot)
      on = { shot, by: want.by, structureId: want.structureId, of: want.of }
    // The same people with a newer sentence keep the shot. A cast the floor turned away must not
    // have its words printed over the picture that is still up.
    else if (
      on.of.castKey === want.of.castKey &&
      on.of.followed === want.of.followed &&
      (on.of.why !== want.of.why || on.of.sceneId !== want.of.sceneId)
    )
      on = { ...on, of: want.of }
    if (want.turn !== null && want.turn !== turn?.it)
      turn = { it: want.turn, atMs: now, taken: false }
    // A turn is taken once, by the shot that is ON its scene. It is what makes the director cut
    // there, so it usually lands a render before the camera does, and waits out its aftermath.
    if (turn !== null && !turn.taken && on !== null && now - turn.atMs < PEAK_TURN_HOLD_MS) {
      const turned = shotOnTurn(on.shot, on.of.sceneId, turn.it, now)
      if (turned !== on.shot) {
        turn = { ...turn, taken: true }
        on = { ...on, shot: turned }
      }
    }
    return on
  }
}

/** `autoCut` is the live town being televised; `pinned` is a viewer who asked to follow one
 *  person, which outranks the gateway. It draws nothing — `DirectorCue` prints the words. */
export function DirectorMode({
  store,
  scene,
  autoCut,
  pinned = null,
  moment = NO_CAST,
  opening = false,
  onCue,
  onWhy,
  onShot,
}: {
  store: WorldStore
  scene: Scene | null
  autoCut: boolean
  pinned?: string | null
  /** whether the cold open is still running, which the session's first shot opens with */
  opening?: boolean
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
  const [floor] = useState(() => cutFloor<StakeScore>(setHeld, keyOf))
  const [round] = useState(() => quietRound())
  const [hold] = useState(() => shotHold())
  const [openShot] = useState(() => openingShot())
  useEffect(() => floor.clear, [floor])
  // The one moment worth pushing over: a give_way the world recorded after three presses. The
  // fold is the store's, so a remount cannot take the turn signal down with it.
  const [turn, setTurn] = useState<TensionTurn | null>(null)
  useEffect(() => store.tension.onTurn(setTurn), [store])
  // Whether the town has ever been framed for this viewer, so the overview is an opening shot
  // and never the thing the camera does on its way out of a claim.
  const framedRef = useRef(false)
  // A hand on the camera, ever. `autoCut` goes false only when a viewer drives it.
  const takenRef = useRef(false)
  useEffect(() => {
    if (!autoCut) takenRef.current = true
  }, [autoCut])

  useEffect(() => {
    floor.offer(autoCut ? (frame?.cut ?? null) : null, performance.now())
  }, [frame, autoCut, floor])

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
    autoCut ? round(outdoorLiving(state, indoors), store.getTick()) : null,
    (id) => state?.agents[id]?.insideId ?? null,
  )
  const claimBy = claim.by
  const wantRoom = claim.by === 'interior' ? claim.structureId : null
  const want = shotOf(claim, held)
  const wantCast = want.castKey
  const wantFollowed = want.followed
  // Never before there is a town to look at: a claim that asks for no shot at all would spend
  // the session's one opening on nothing.
  const wantKind = shotKindFor({
    opening: openShot(opening && awake && claimBy !== 'hold'),
    peak: claimBy === 'cut' && (held?.score ?? 0) >= PEAK_SCORE,
    indoors: wantRoom !== null,
    walking: wantFollowed !== null && state?.agents[wantFollowed]?.activity?.path !== undefined,
    cast: wantCast === '' ? (wantFollowed === null ? 0 : 1) : wantCast.split(' ').length,
  })

  const on = hold({
    spec: specOf(claimBy, wantKind, wantRoom, want),
    // A hand on the lens outranks the floor: a viewer who pinned somebody, opened a moment or
    // took the camera waits for nothing.
    byHand: !autoCut || pinned !== null || moment.length > 0,
    turn,
    by: claimBy,
    structureId: wantRoom,
    of: want,
  })

  const shot = on?.shot ?? null
  const driveBy = on?.by ?? 'hold'
  const structureId = on?.structureId ?? null
  const castKey = on?.of.castKey ?? ''
  const followed = on?.of.followed ?? null
  const sceneId = on?.of.sceneId ?? null
  const isCut = on?.of.isCut ?? false
  const why = on?.of.why ?? null
  const shotKey = castKey !== '' ? castKey : (followed ?? '')

  // Centre BEFORE the stop changes: the zoom eases about whatever the middle of the screen holds.
  useEffect(() => {
    if (scene === null) return
    return driveShot(
      scene,
      store,
      { by: driveBy, castKey, followed, structureId, awake },
      framedRef,
      takenRef,
      shot,
    )
  }, [scene, store, driveBy, castKey, followed, structureId, awake, shot])

  // Split from the key rather than passed as the claim's own array: a fresh array every render
  // would re-run this on every tick of the town.
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

  // The floor, the bars and the speech column all stand under the scene the camera is framing,
  // and only the director knows which that is: a pinned body is a talk the town never cut to.
  useEffect(() => {
    if (sceneId !== null || followed === null) {
      store.setShotScene(sceneId)
      return undefined
    }
    // A pinned body may not be in a talk yet, so this watches for the one they walk into.
    const look = (): void => {
      store.setShotScene(shotSceneFor(followed, store.openScenes()))
    }
    look()
    return store.subscribe(look)
  }, [store, sceneId, followed])

  const name = followed === null ? null : agentName(state?.agents, followed)
  useEffect(() => {
    onCue?.(name === null ? null : `${pinned === null ? 'DIRECTOR' : 'FOLLOWING'} · ${name}`)
  }, [name, pinned, onCue])

  useEffect(() => {
    onWhy?.(why)
  }, [why, onWhy])

  return null
}
