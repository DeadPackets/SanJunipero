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
  BeatCard,
  DirectorCue,
  DossierRail,
  Drawer,
  Figures,
  LowerThird,
  Nameplate,
  ShotBoard,
  StoryStrip,
  Ticker,
  SpeechLive,
  SubjectRing,
  SceneCard,
  DayBar,
  toggleFullscreen,
  useSafeInsets,
  useStageKeys,
  type RingVerb,
  type Subject,
} from './stage/index.js'
import { HelpButton } from './stage/HelpButton.js'
import { ReplayScene } from './stage/ReplayScene.js'
import { KeyMap } from './stage/KeyMap.js'
import { ThoughtsButton } from './stage/ThoughtsButton.js'
import { Soundscape } from './stage/Soundscape.js'
import { DirectorMode } from './ui/DirectorMode.js'
import { FpsOverlay } from './ui/FpsOverlay.js'
import { useAutoCut } from './ui/autoCut.js'
import { playClosesPaper, pointPlay, useMomentEnd, type MomentPlay } from './ui/replayRun.js'
import { sceneCueFor, useSceneStage, useStageCue } from './ui/stageCue.js'
import { FIRST_FRAME_COPY, dismissFirstFrame, firstFrameNote } from './ui/firstFrame.js'
import { useDressed } from './ui/bustStyle.js'
import { useDensity } from './ui/density.js'
import { escapeStep } from './ui/interaction.js'
import { adminToken } from './ui/lawsModel.js'
import { localStore, paperDock, rememberPaperDock, sessionStore } from './ui/storage.js'
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

/** The one way back out of a replay, which stands for as long as the town is off its live edge.
 *  A stream frame has no hands, and the strip that used to carry a second one is gone. */
export const wayBack = (live: boolean, broadcast: boolean): boolean => !live && !broadcast

function waitingNote(link: LinkStatus): string {
  if (link === 'reconnecting') return FIRST_FRAME_COPY.lost
  return link === 'online' ? DRESSING_NOTE : FIRST_FRAME_COPY.looking
}

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
    route.momentId === null ? null : { page: 'chronicle', tab: 'Record' },
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
  // Where the Almanac stands. It lives here, not in the sheet, because Watch has to ask.
  const [dock, setDock] = useState(() => paperDock(localStore()))
  const [following, setFollowing] = useState<string | null>(null)
  // Operator-only: absent for every viewer who did not put a token in this session.
  const [operatorToken] = useState<string | null>(() => adminToken(sessionStore()))
  const appRef = useRef<HTMLDivElement>(null)
  const signpostRef = useRef<HTMLElement>(null)
  const { autoCut, handbackAt, toggle: toggleDirector, hold: holdDirector } = useAutoCut()
  // How much of the chrome is up: Stage, Watch or Deck. One owner, and the sheet does the rest.
  const density = useDensity()
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
            setSheet({ page: 'person', tab: 'Now' })
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

  // The card leaves when the town is DRESSED, never when the scene object exists: art in hand
  // is the only thing that makes the reveal a town rather than an empty field.
  const dressed = useDressed(store)
  useEffect(() => {
    void whenDressed().then(store.setDressed)
  }, [store])
  // One way only: a socket that drops after the town can be seen is the stamp's news, not this.
  useEffect(() => {
    if (scene !== null && link === 'online' && dressed) dismissFirstFrame()
    else firstFrameNote(waitingNote(link))
  }, [scene, link, dressed])

  const onShot = useCallback((cast: readonly string[], sceneId: string | null) => {
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
      // As a sheet the paper takes 66% of the screen and dims the town, and a replay behind it
      // is invisible. Docked it takes 380px and dims nothing, so it stays up.
      if (playClosesPaper(dock) || !window.matchMedia('(min-width: 1000px)').matches) closePaper()
      setFollowing(null)
      setPlay(next)
      handle?.replay(next.from)
      address(next.from)
    },
    [handle, address, closePaper, dock],
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
    if (next.kind === 'agent') density.show('deck')
    openPage(next.kind === 'agent' ? 'person' : 'building')
  }

  const enterInterior = (structureId: string | null): void => {
    scene?.interior?.setActive(structureId)
  }

  const onVerb = (verb: RingVerb): void => {
    if (subject === null) return
    if (subject.kind === 'structure') {
      if (verb === 'inside') enterInterior(insideId === subject.id ? null : subject.id)
      else openPage('building', 'About')
      return
    }
    switch (verb) {
      case 'follow':
        setFollowing((prev) => (prev === subject.id ? null : subject.id))
        return
      case 'story':
        openPage('person', 'Now')
        return
      case 'bonds':
        openPage('person', 'Relationships')
        return
      case 'home': {
        // A person's home is the building they own — the world records ownership, never an
        // address on the person.
        const home = Object.values(store.getState()?.structures ?? {}).find(
          (s) => s.owner === subject.id,
        )
        if (home === undefined) return
        setSubject({ id: home.id, kind: 'structure', name: structureTitle(home) })
        openPage('building', 'About')
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

  // The 1000px floor is the sheet's, not this file's: every dock rule sits inside that media
  // query, so below it the attribute flips and the Almanac stays the sheet it was.
  const toggleDock = useCallback(() => {
    const next = dock === 'docked' ? 'sheet' : 'docked'
    setDock(next)
    rememberPaperDock(localStore(), next)
  }, [dock])

  const toggleThoughts = useCallback(() => {
    const next = thoughts === 'hidden' ? 'shown' : 'hidden'
    setThoughts(next)
    rememberThoughts(localStore(), next)
  }, [thoughts])

  useStageKeys({
    onSignpost: () => {
      signpostRef.current?.querySelector<HTMLButtonElement>('.journal-toggle')?.focus()
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
    onDensity: density.cycle,
    onDock: toggleDock,
  })

  return (
    <div
      className="app"
      ref={appRef}
      data-broadcast={route.broadcast ? 'on' : undefined}
      data-density={density.mode}
      data-paper={sheet === null ? undefined : 'on'}
      data-replay={play === null || route.broadcast ? undefined : 'on'}
    >
      <h1 className="stage-sr">San Junipero</h1>
      <a className="skip" href="#signpost">
        Skip to the town journal
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
            openPage('found', 'Discoveries')
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
      {wayBack(mode.live, route.broadcast) && (
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
        onOpen={(next) => {
          setSubject(next)
          density.show('deck')
        }}
      />
      <Nameplate store={store} scene={scene} cast={shot.cast} focus={focus ?? subject} />
      <SubjectRing subject={subject} scene={scene} store={store} onVerb={onVerb} />
      <DayBar
        store={store}
        link={link}
        handle={handle}
        onAt={onScrub}
        onWatch={(tick) => {
          setPlay(null)
          setFollowing(null)
          if (playClosesPaper(dock) || !window.matchMedia('(min-width: 1000px)').matches)
            closePaper()
          handle?.replay(tick)
          address(tick)
        }}
        onLive={onLive}
        autoCut={autoCut}
        handbackAt={handbackAt}
        broadcast={route.broadcast}
      />
      <DirectorCue text={cue} moment={moment} scene={sceneCue} why={why} />
      {/* The stream is its own composition and keeps the card it has captions for. Everywhere
          else the beat card is the one card, and Stage has neither. */}
      {route.broadcast && <SceneCard store={store} cast={shot.cast} sceneId={shot.sceneId} />}
      {/* Below 1000px the frame has no room for the three, so the drawer is their room. Above
          it the drawer is `display: contents` and they stand in their own areas. */}
      {!route.broadcast && (
        <Drawer>
          <BeatCard store={store} />
          <ShotBoard store={store} />
          <DossierRail store={store} />
        </Drawer>
      )}
      <StoryStrip store={store} />
      <LowerThird store={store} shot={shot.cast} broadcast={route.broadcast} />
      {route.broadcast && <Ticker scene={scene} />}
      <DirectorMode
        store={store}
        scene={scene}
        autoCut={autoCut}
        pinned={following}
        moment={play?.cast ?? NO_CAST}
        opening
        onCue={setCue}
        onWhy={setWhy}
        onShot={onShot}
      />
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
        dock={dock}
        onDock={toggleDock}
        onTab={(tab) => {
          setSheet((prev) => (prev === null ? prev : { ...prev, tab }))
        }}
        onClose={closePaper}
        onBrowse={openPage}
        onWatch={(next) => {
          setSubject(next)
          if (next.kind === 'agent') {
            setFollowing(next.id)
            const a = store.getState()?.agents[next.id]
            if (a) scene?.centerOn(a.x, a.y)
          } else {
            setFollowing(null)
            setPlay(null)
            holdDirector()
            scene?.setFollow(null)
            const place = store.getState()?.structures[next.id]
            if (place) scene?.centerOn(place.x + place.w / 2, place.y + place.h / 2)
          }
          closePaper()
        }}
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
