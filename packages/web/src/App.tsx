import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentToTick, structureTitle, tickToMoment } from '@sj/shared'
import { createWorldStore, onFirstSnapshot } from './state/worldStore.js'
import { connectObservatory, type LinkStatus, type ObservatoryHandle } from './net/socket.js'
import { parseRoute, routeToPath, titleFor, type Route } from './ui/route.js'
import { StageMount } from './render/StageMount.js'
import { BROADCAST_TEXT_SCALE } from './render/textFaces.js'
import { whenDressed } from './render/textures.js'
import type { Scene } from './render/scene.js'
import {
  DirectorCue,
  Figures,
  LowerThird,
  Nameplate,
  Ticker,
  SpeechLive,
  SubjectRing,
  SceneCard,
  SkyArc,
  toggleFullscreen,
  useSafeInsets,
  useStageKeys,
  type RingVerb,
  type Subject,
} from './stage/index.js'
import { HelpButton } from './stage/HelpButton.js'
import { ReplayScene } from './stage/ReplayScene.js'
import { Transport } from './stage/Transport.js'
import { KeyMap } from './stage/KeyMap.js'
import { ThoughtsButton } from './stage/ThoughtsButton.js'
import { Soundscape } from './stage/Soundscape.js'
import { DirectorMode } from './ui/DirectorMode.js'
import { CameraChip } from './stage/CameraChip.js'
import { FpsOverlay } from './ui/FpsOverlay.js'
import { useAutoCut } from './ui/autoCut.js'
import { pointPlay, useMomentEnd, type MomentPlay } from './ui/replayRun.js'
import { sceneCueFor, useSceneStage, useStageCue } from './ui/stageCue.js'
import {
  FIRST_FRAME_COPY,
  dismissFirstFrame,
  fadeFirstLines,
  firstWorryLine,
  tellFirstWorry,
  firstFrameNote,
  showFirstLines,
} from './ui/firstFrame.js'
import { aimsFeed } from './ui/feeds.js'
import { useFeed } from './ui/useEndpoint.js'
import { escapeStep } from './ui/interaction.js'
import { adminToken } from './ui/lawsModel.js'
import { localStore, sessionStore } from './ui/storage.js'
import { rememberThoughts, thoughtsSetting } from './ui/thoughts.js'
import { Paper } from './paper/Paper.js'
import { Signpost } from './paper/Signpost.js'
import { firstTab, type Arm, type PageKey } from './paper/pageModel.js'
import type { Thing } from './paper/pages/types.js'

type Sheet = { page: PageKey; tab: string }

const NO_CAST: readonly string[] = []

/** The card's line once the town is answering but its art is still landing. "Looking for the
 *  town" is a lie by then, and an empty field is what dismissing the card early reveals. */
const DRESSING_NOTE = 'The town is coming into focus…'

function waitingNote(link: LinkStatus): string {
  if (link === 'reconnecting') return FIRST_FRAME_COPY.lost
  return link === 'online' ? DRESSING_NOTE : FIRST_FRAME_COPY.looking
}

/** How many minds are alive to be watched — what the first two lines count. */
const livingCount = (agents: Record<string, { alive: boolean }> | undefined): number =>
  Object.values(agents ?? {}).filter((a) => a.alive).length

/** Safari throttles history writes to 100 per 30 s, and 8x playback asks for sixteen a second. */
const ADDRESS_BAR_MS = 500
let addressAt = 0
function writeAddress(next: Route, now: boolean): void {
  const at = performance.now()
  if (!now && at - addressAt < ADDRESS_BAR_MS) return
  addressAt = at
  history.replaceState(null, '', routeToPath(next))
}

export function App() {
  const [store] = useState(createWorldStore)
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search))
  // The address is written outside the updater, so two navigations in one frame still compose.
  const routeRef = useRef(route)
  const [scene, setScene] = useState<Scene | null>(null)
  const [handle, setHandle] = useState<ObservatoryHandle | null>(null)
  const [link, setLink] = useState<LinkStatus>('connecting')
  const [gapTicks, setGapTicks] = useState<number | null>(null)
  // which interior the camera is inside; the Pixi sub-scene owns the truth, this mirrors it
  const [insideId, setInsideId] = useState<string | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [focus, setFocus] = useState<Subject | null>(null)
  const [thing, setThing] = useState<Thing | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(() =>
    route.momentId === null ? null : { page: 'chronicle', tab: 'Moments' },
  )
  // The moment being replayed, or null for a town at the live edge or held on one still.
  const [play, setPlay] = useState<MomentPlay | null>(null)
  const [cue, setCue] = useState<string | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  // Who the director has in frame, and the scene it is of: the card and the caption follow this
  // one answer, so neither can name somebody the camera is not on.
  const [shot, setShot] = useState<{ cast: readonly string[]; sceneId: string | null }>(() => ({
    cast: NO_CAST,
    sceneId: null,
  }))
  const [keysOpen, setKeysOpen] = useState(false)
  const [thoughts, setThoughts] = useState(() => thoughtsSetting(localStore()))
  const [following, setFollowing] = useState<string | null>(null)
  // Operator-only: absent for every viewer who did not put a token in this session.
  const [operatorToken] = useState<string | null>(() => adminToken(sessionStore()))
  const appRef = useRef<HTMLDivElement>(null)
  const signpostRef = useRef<HTMLElement>(null)
  const { autoCut, handbackAt, toggle: toggleDirector } = useAutoCut()
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  // What just happened, on the stage: a moment outranks the shot's own caption for six seconds.
  const moment = useStageCue(store)
  // ...and what the town is DOING. One owner for the scene's eight-second hold, so the line and
  // the camera can never disagree about whether the summary is still up.
  const stage = useSceneStage(store)
  const sceneCue = sceneCueFor(stage, store.getState()?.agents)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = connectObservatory({
      url: `${proto}://${location.host}/ws`,
      store,
      onGap: setGapTicks,
      onStatus: setLink,
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the connection IS the external system this effect subscribes to; the tree needs the handle the moment it exists.
    setHandle(sock)

    // deep link: once the first snapshot lands, play the linked moment — the same bounded window
    // a click gets, so a shared link and a clicked line are the same thing.
    const initial = parseRoute(location.pathname, location.search)
    const offMoment =
      initial.moment === null
        ? null
        : onFirstSnapshot(store, () => {
            const at = momentToTick(initial.moment!.day, initial.moment!.time)
            if (!Number.isFinite(at)) return
            const next = pointPlay(at, store.liveEdge(), '')
            setPlay(next)
            sock.replay(next.from)
          })

    // A person ringed beside a moment link is not a pasted `/agent/:id`, and an id the town does
    // not have is simply the town — the ring's own effect answers for both.
    const linked = initial.momentId === null && initial.moment === null ? initial.agentId : null
    const offLink =
      linked === null
        ? null
        : onFirstSnapshot(store, () => {
            if (store.getState()?.agents[linked] === undefined) return
            setSheet({ page: 'person', tab: 'Story' })
            setFollowing(linked)
          })

    // The canvas picks a figure by writing the person into the address and firing popstate
    // (render/StageMount).
    const onPop = (): void => {
      routeRef.current = parseRoute(location.pathname, location.search)
      setRoute(routeRef.current)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      sock.close()
      offMoment?.()
      offLink?.()
      window.removeEventListener('popstate', onPop)
    }
  }, [store])

  // The worries ride the aims feed, a beat behind the town; the effect below runs again when
  // they land, and the first lines gain their second sentence if they are still up.
  const aims = useFeed(aimsFeed).data
  // The card leaves when the town is DRESSED, never when the scene object exists: art in hand
  // is the only thing that makes the reveal a town rather than an empty field.
  const [dressed, setDressed] = useState(false)
  useEffect(() => {
    let live = true
    void whenDressed().then(() => {
      if (live) setDressed(true)
    })
    return () => {
      live = false
    }
  }, [])
  // One way only: a socket that drops after the town can be seen is the stamp's news, not this.
  useEffect(() => {
    if (scene !== null && link === 'online' && dressed) {
      dismissFirstFrame()
      // ...and the two lines take the card's place, over the town they are about.
      showFirstLines(livingCount(store.getState()?.agents))
      if (aims !== null)
        tellFirstWorry(
          firstWorryLine(
            aims.aims,
            (id) => store.getState()?.agents[id]?.name,
            tickToMoment(store.getTick()).day,
          ),
        )
    } else firstFrameNote(waitingNote(link))
  }, [scene, link, store, aims, dressed])

  // The first cut is the first thing worth watching, so the lines get out of its way. A quiet
  // round turn is not one: it happens the instant the town arrives, before anybody has read them.
  const onShot = useCallback((cast: readonly string[], sceneId: string | null, cut: boolean) => {
    if (cut) fadeFirstLines()
    setShot({ cast, sceneId })
  }, [])

  // The address bar moves without a page load, so nothing else would ever rename the tab.
  const named = subject?.kind === 'agent' && subject.id === route.agentId ? subject.name : null
  useEffect(() => {
    document.title = titleFor(route, named)
  }, [route, named])

  // Waits for the world to be able to say who they are, so a stranger's id rings nobody.
  const agentId = route.agentId
  useEffect(() => {
    if (agentId === null) return
    return onFirstSnapshot(store, () => {
      const name = store.getState()?.agents[agentId]?.name
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the address bar is the canvas's only way to name a pick; this mirrors it into the ring.
      if (name !== undefined) setSubject({ id: agentId, kind: 'agent', name })
    })
  }, [agentId, store])

  const closePaper = useCallback(() => {
    setSheet(null)
  }, [])

  // Every viewed moment is shareable: a link copied mid-playback reopens that minute.
  const address = useCallback((tick: number | null): void => {
    const next: Route = {
      ...routeRef.current,
      moment: tick === null ? null : tickToMoment(tick),
    }
    routeRef.current = next
    writeAddress(next, tick === null)
    setRoute(next)
  }, [])

  // SCRUB IS FOR DRAGGING, REPLAY IS FOR CLICKING. A still frame is what a finger on the
  // filmstrip asks for; every other way into the past is a thing the viewer wants to watch.
  const onScrub = useCallback(
    (tick: number) => {
      setPlay(null) // a hand on the filmstrip has left whatever moment was running
      handle?.scrub(tick)
      address(tick)
    },
    [handle, address],
  )
  const onPlay = useCallback(
    (next: MomentPlay) => {
      // The paper sits at 66% of the screen and dims the town: a replay behind it is invisible.
      closePaper()
      setPlay(next)
      handle?.replay(next.from)
      address(next.from)
    },
    [handle, address, closePaper],
  )
  const onLive = useCallback(() => {
    setPlay(null)
    handle?.goLive()
    address(null)
  }, [handle, address])

  // The moment holds its last frame rather than running on into the rest of the day.
  const onMomentEnd = useCallback(
    (until: number) => {
      handle?.scrub(until)
      address(until)
    },
    [handle, address],
  )
  useMomentEnd(store, play, onMomentEnd)

  const onMoment = useCallback((id: number | null) => {
    const next: Route = { ...routeRef.current, momentId: id }
    routeRef.current = next
    writeAddress(next, true)
    setRoute(next)
  }, [])

  const openPage = (page: PageKey, tab?: string): void => {
    setSheet({ page, tab: tab ?? firstTab(page) })
  }

  const onArm = (arm: Arm): void => {
    setSheet((prev) => (prev?.page === arm ? null : { page: arm, tab: firstTab(arm) }))
  }

  const pickSubject = (next: Subject): void => {
    setSubject(next)
    openPage(next.kind === 'agent' ? 'person' : 'building')
  }

  const enterInterior = (structureId: string | null): void => {
    scene?.interior?.setActive(structureId)
  }

  const onVerb = (verb: RingVerb): void => {
    if (subject === null) return
    if (subject.kind === 'structure') {
      if (verb === 'inside') enterInterior(insideId === subject.id ? null : subject.id)
      else openPage('building', 'Provenance')
      return
    }
    switch (verb) {
      case 'follow':
        setFollowing((prev) => (prev === subject.id ? null : subject.id))
        return
      case 'story':
        openPage('person', 'Story')
        return
      case 'bonds':
        openPage('person', 'Bonds')
        return
      case 'home': {
        // A person's home is the building they own — the world records ownership, never an
        // address on the person.
        const home = Object.values(store.getState()?.structures ?? {}).find(
          (s) => s.owner === subject.id,
        )
        if (home === undefined) return
        setSubject({ id: home.id, kind: 'structure', name: structureTitle(home) })
        openPage('building', 'Provenance')
        scene?.centerOn(home.x, home.y)
      }
    }
  }

  // The stream frame's half of R2 that CSS cannot reach: the town's own speech is a bitmap
  // face in the canvas, and 16px of it is 4.00px on a 480-wide player.
  useEffect(() => {
    if (scene === null) return
    // eslint-disable-next-line react-hooks/immutability -- Scene is an external Pixi handle kept in state only so children re-render when it lands; this writes to the canvas, not to React data.
    scene.textScale = route.broadcast ? BROADCAST_TEXT_SCALE : 1
  }, [scene, route.broadcast])

  // The same reach for the same reason: the bubble layer lives in a Pixi closure React never
  // re-renders, so the setting is written onto the scene handle rather than passed as a prop.
  useEffect(() => {
    scene?.bubbles?.setThoughts(thoughts)
  }, [scene, thoughts])
  useSafeInsets(scene)

  // ONE label over the thing a viewer picked: the nameplate. The canvas layers read the pick
  // off the handle and stand down for it.
  useEffect(() => {
    if (scene === null) return
    // eslint-disable-next-line react-hooks/immutability -- Scene is an external Pixi handle; this writes to the canvas, not to React data.
    scene.pickedId = subject?.id ?? null
  }, [scene, subject])

  const toggleThoughts = useCallback(() => {
    const next = thoughts === 'hidden' ? 'shown' : 'hidden'
    setThoughts(next)
    rememberThoughts(localStore(), next)
  }, [thoughts])

  useStageKeys({
    onSignpost: () => {
      signpostRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    },
    onEscape: () => {
      const rung = escapeStep({
        keys: keysOpen,
        paper: sheet !== null,
        interior: insideId !== null,
        subject: subject !== null,
        fullscreen: document.fullscreenElement !== null,
      })
      if (rung === 'keys') setKeysOpen(false)
      else if (rung === 'paper') closePaper()
      else if (rung === 'interior') enterInterior(null)
      else if (rung === 'subject') setSubject(null)
      else if (rung === 'fullscreen') toggleFullscreen(appRef.current)
    },
    onFullscreen: () => {
      toggleFullscreen(appRef.current)
    },
    onDirector: toggleDirector,
    onThoughts: toggleThoughts,
  })

  return (
    <div
      className="app"
      ref={appRef}
      data-broadcast={route.broadcast ? 'on' : undefined}
      data-paper={sheet === null ? undefined : 'on'}
      data-replay={play === null || route.broadcast ? undefined : 'on'}
    >
      <h1 className="stage-sr">San Junipero</h1>
      <a className="skip" href="#signpost">
        Skip to the signpost
      </a>
      <main>
        <StageMount
          store={store}
          onScene={setScene}
          onInterior={setInsideId}
          onPick={(pick) => {
            if (pick.kind === 'structure') {
              const s = store.getState()?.structures[pick.id]
              if (s === undefined) return
              setSubject({ id: s.id, kind: 'structure', name: structureTitle(s) })
              return
            }
            // A thing on the ground has no ring; the record it came out of is its surface.
            setThing({ kind: pick.kind, id: pick.id })
            openPage('found', 'Things')
          }}
          onGround={() => {
            setSubject(null)
            setThing(null)
          }}
        />
      </main>
      {insideId !== null && (
        <button
          type="button"
          className="stage-exit"
          onClick={() => {
            enterInterior(null)
            // the button goes with the room, so the focus it held has to be handed somewhere
            appRef.current?.querySelector<HTMLElement>('.stage-mount')?.focus()
          }}
        >
          <span aria-hidden="true">← </span>Back to town
        </button>
      )}
      {/* The one way back out of a replay: a stream frame has no hands. */}
      {!mode.live && !route.broadcast && play === null && (
        <button type="button" className="stage-live" onClick={onLive}>
          Return to now<span aria-hidden="true"> →</span>
        </button>
      )}
      {!route.broadcast && <ReplayScene store={store} play={play} />}
      <SpeechLive store={store} />
      <Figures
        scene={scene}
        store={store}
        paperOpen={sheet !== null}
        onFocus={setFocus}
        onOpen={setSubject}
      />
      <Nameplate store={store} scene={scene} cast={shot.cast} focus={focus ?? subject} />
      <SubjectRing subject={subject} scene={scene} store={store} onVerb={onVerb} />
      <SkyArc store={store} link={link} />
      <DirectorCue text={cue} moment={moment} scene={sceneCue} why={why} />
      <SceneCard store={store} cast={shot.cast} sceneId={shot.sceneId} />
      <LowerThird store={store} shot={shot.cast} broadcast={route.broadcast} />
      {route.broadcast && <Ticker scene={scene} />}
      <DirectorMode
        store={store}
        scene={scene}
        autoCut={autoCut}
        pinned={following}
        moment={play?.cast ?? NO_CAST}
        onCue={setCue}
        onWhy={setWhy}
        onShot={onShot}
      />
      <CameraChip autoCut={autoCut} handbackAt={handbackAt} />
      {!route.broadcast && (
        <Transport store={store} play={play} handle={handle} onLive={onLive} onAt={address} />
      )}
      <Signpost open={sheet?.page ?? null} onOpen={onArm} ref={signpostRef} />
      <HelpButton
        open={keysOpen}
        onToggle={() => {
          setKeysOpen((v) => !v)
        }}
      />
      <ThoughtsButton thoughts={thoughts} onToggle={toggleThoughts} />
      <Soundscape store={store} scene={scene} />
      <Paper
        page={sheet?.page ?? null}
        tab={sheet?.tab ?? ''}
        subject={subject}
        thing={thing}
        momentId={route.momentId}
        store={store}
        scene={scene}
        operatorToken={operatorToken}
        insideId={insideId}
        gapTicks={gapTicks}
        onTab={(tab) => {
          setSheet((prev) => (prev === null ? prev : { ...prev, tab }))
        }}
        onClose={closePaper}
        onSubject={pickSubject}
        onInside={enterInterior}
        onScrub={onScrub}
        onPlay={onPlay}
        onLive={onLive}
        onMoment={onMoment}
      />
      <KeyMap open={keysOpen} onOpenChange={setKeysOpen} />
      <FpsOverlay />
    </div>
  )
}
