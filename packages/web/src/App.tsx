import { useCallback, useEffect, useRef, useState } from 'react'
import { momentToTick, tickToMoment } from '@sj/shared'
import { createWorldStore } from './state/worldStore.js'
import { connectObservatory, type LinkStatus, type ObservatoryHandle } from './net/socket.js'
import { parseRoute, routeToPath, type Route } from './ui/route.js'
import { StageMount } from './render/StageMount.js'
import { BROADCAST_TEXT_SCALE } from './render/textFaces.js'
import type { Scene } from './render/scene.js'
import {
  DirectorCue,
  Figures,
  LowerThird,
  Nameplate,
  Ticker,
  SpeechLive,
  SubjectRing,
  QuietStamp,
  toggleFullscreen,
  useStageKeys,
  type RingVerb,
  type Subject,
} from './stage/index.js'
import { DirectorMode } from './ui/DirectorMode.js'
import { FpsOverlay } from './ui/FpsOverlay.js'
import { useAutoCut } from './ui/autoCut.js'
import { kindWords } from './ui/broadcastReady.js'
import { escapeStep } from './ui/interaction.js'
import { adminToken } from './ui/lawsModel.js'
import { Paper } from './paper/Paper.js'
import { Signpost } from './paper/Signpost.js'
import { firstTab, type Arm, type PageKey } from './paper/pageModel.js'
import type { Thing } from './paper/pages/index.js'

/** What the paper is showing, or `null` while it is down. */
type Sheet = { page: PageKey; tab: string }

export function App() {
  const [store] = useState(createWorldStore)
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search))
  const [scene, setScene] = useState<Scene | null>(null)
  const [handle, setHandle] = useState<ObservatoryHandle | null>(null)
  const [link, setLink] = useState<LinkStatus>('connecting')
  const [gapTicks, setGapTicks] = useState<number | null>(null)
  // which interior the camera is inside; the Pixi sub-scene owns the truth, this mirrors it
  const [insideId, setInsideId] = useState<string | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  // the figure the keyboard is on; the plate follows it, and Enter opens the ring round it
  const [focus, setFocus] = useState<Subject | null>(null)
  // an item or a crop the viewer clicked: it has no ring, so the record answers for it
  const [thing, setThing] = useState<Thing | null>(null)
  // `/moment/:id` is a link to a recorded day, so the sheet comes up on the filmstrip.
  const [sheet, setSheet] = useState<Sheet | null>(() =>
    route.momentId === null ? null : { page: 'chronicle', tab: 'Moments' },
  )
  const [cue, setCue] = useState<string | null>(null)
  const [following, setFollowing] = useState<string | null>(null)
  // Operator-only: absent for every viewer who did not put a token in this session.
  const [operatorToken] = useState<string | null>(() => adminToken(sessionStorage))
  const appRef = useRef<HTMLDivElement>(null)
  const signpostRef = useRef<HTMLElement>(null)
  const { autoCut, toggle: toggleDirector } = useAutoCut()

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

    // deep link: once the first snapshot lands, scrub to the linked moment
    const initial = parseRoute(location.pathname, location.search)
    if (initial.moment) {
      const off = store.subscribe(() => {
        if (store.getState() === null) return
        sock.scrub(momentToTick(initial.moment!.day, initial.moment!.time))
        off()
      })
    }

    // A pasted `/agent/:id` lands on the person it names: their sheet comes up and the camera
    // pins to them. An id the town does not have is simply the town, with nothing said.
    const linked = initial.agentId
    if (linked !== null) {
      const off = store.subscribe(() => {
        const state = store.getState()
        if (state === null) return
        off()
        const name = state.agents[linked]?.name
        if (name === undefined) return
        setSubject({ id: linked, kind: 'agent', name })
        setSheet({ page: 'person', tab: 'Story' })
        setFollowing(linked)
      })
    }

    // The canvas picks a figure by writing the person into the address and firing popstate
    // (render/StageMount).
    const onPop = (): void => {
      setRoute(parseRoute(location.pathname, location.search))
    }
    window.addEventListener('popstate', onPop)
    return () => {
      sock.close()
      window.removeEventListener('popstate', onPop)
    }
  }, [store])

  // A figure clicked on the canvas becomes the ring's subject.
  const agentId = route.agentId
  useEffect(() => {
    if (agentId === null) return
    const name = store.getState()?.agents[agentId]?.name ?? agentId
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address bar is the canvas's only way to name a pick; this mirrors it into the ring.
    setSubject({ id: agentId, kind: 'agent', name })
  }, [agentId, store])

  // Every viewed moment is shareable: the socket and the address bar move together, so a link
  // a viewer copies mid-playback reopens the minute they were watching.
  const goTo = useCallback(
    (tick: number | null): void => {
      if (tick === null) handle?.goLive()
      else handle?.scrub(tick)
      setRoute((prev) => {
        const next: Route = { ...prev, moment: tick === null ? null : tickToMoment(tick) }
        history.replaceState(null, '', routeToPath(next))
        return next
      })
    },
    [handle],
  )
  const onJump = useCallback(
    (tick: number) => {
      goTo(tick)
    },
    [goTo],
  )
  const onLive = useCallback(() => {
    goTo(null)
  }, [goTo])

  /** The recorded day the filmstrip has open, in the address bar. */
  const onMoment = useCallback((id: number | null) => {
    setRoute((prev) => {
      const next: Route = { ...prev, momentId: id }
      history.replaceState(null, '', routeToPath(next))
      return next
    })
  }, [])

  const openPage = (page: PageKey, tab?: string): void => {
    setSheet({ page, tab: tab ?? firstTab(page) })
  }
  const closePaper = useCallback(() => {
    setSheet(null)
  }, [])

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

  // ONE place where a ring verb becomes a thing that happens.
  const onVerb = (verb: RingVerb): void => {
    if (subject === null) return
    if (subject.kind === 'structure') {
      if (verb === 'home') enterInterior(insideId === subject.id ? null : subject.id)
      else openPage('building', verb === 'bonds' ? 'Inside' : 'Provenance')
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
        setSubject({ id: home.id, kind: 'structure', name: kindWords(home.kind) })
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

  useStageKeys({
    onSignpost: () => {
      signpostRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    },
    onEscape: () => {
      const rung = escapeStep({
        paper: sheet !== null,
        interior: insideId !== null,
        subject: subject !== null,
        fullscreen: document.fullscreenElement !== null,
      })
      if (rung === 'paper') closePaper()
      else if (rung === 'interior') enterInterior(null)
      else if (rung === 'subject') setSubject(null)
      else if (rung === 'fullscreen') toggleFullscreen(appRef.current)
    },
    onFullscreen: () => {
      toggleFullscreen(appRef.current)
    },
    onDirector: toggleDirector,
  })

  return (
    <div className="app" ref={appRef} data-broadcast={route.broadcast ? 'on' : undefined}>
      <StageMount
        store={store}
        onScene={setScene}
        onInterior={setInsideId}
        onPick={(pick) => {
          if (pick.kind === 'structure') {
            const s = store.getState()?.structures[pick.id]
            if (s === undefined) return
            setSubject({ id: s.id, kind: 'structure', name: kindWords(s.kind) })
            return
          }
          // A thing on the ground has no ring; the record it came out of is its surface.
          setThing({ kind: pick.kind, id: pick.id })
          openPage('found', 'Things')
        }}
      />
      <SpeechLive store={store} />
      <Figures scene={scene} store={store} onFocus={setFocus} onOpen={setSubject} />
      <Nameplate subject={focus ?? subject} scene={scene} />
      <SubjectRing subject={subject} scene={scene} onVerb={onVerb} />
      <QuietStamp store={store} link={link} />
      <DirectorCue text={cue} />
      {route.broadcast && <LowerThird store={store} />}
      {route.broadcast && <Ticker scene={scene} />}
      <DirectorMode
        store={store}
        scene={scene}
        autoCut={autoCut}
        pinned={following}
        onCue={setCue}
      />
      <Signpost open={sheet?.page ?? null} onOpen={onArm} ref={signpostRef} />
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
        onJump={onJump}
        onLive={onLive}
        onMoment={onMoment}
      />
      <FpsOverlay />
    </div>
  )
}
