import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentToTick, tickToMoment } from '@sj/shared'
import { createWorldStore, type WorldStore } from './state/worldStore.js'
import { connectObservatory, type LinkStatus, type ObservatoryHandle } from './net/socket.js'
import { parseRoute, routeToPath, type Lens, type Route } from './ui/route.js'
import { lensFromKey, lensKeyAllowed } from './ui/interaction.js'
import { StageMount } from './render/StageMount.js'
import { InspectorPanel } from './ui/InspectorPanel.js'
import { RosterPanel } from './ui/RosterPanel.js'
import { ChroniclePanel } from './ui/ChroniclePanel.js'
import { SocietyLens } from './ui/SocietyLens.js'
import { DirectorMode } from './ui/DirectorMode.js'
import { MomentsLens } from './ui/MomentsLens.js'
import { DigestModal } from './ui/DigestModal.js'
import { StageVeil } from './ui/StageVeil.js'
import { InteriorBar } from './ui/InteriorBar.js'
import { LensTabs, StatusStrip } from './ui/StatusStrip.js'
import { CameraHud } from './ui/CameraHud.js'
import { FpsOverlay } from './ui/FpsOverlay.js'
import { LAST_SEEN_KEY } from './net/socket.js'
import { Timeline } from './ui/Timeline.js'
import { WorldLaws } from './panels/WorldLaws.js'
import { LawsDashboard } from './admin/LawsDashboard.js'
import { adminToken } from './panels/lawsModel.js'
import type { Scene } from './render/scene.js'

function ScrubBanner({ store }: { store: WorldStore }) {
  const mode = useSyncExternalStore(store.subscribe, store.getMode)
  if (mode.live) return null
  const m = tickToMoment(mode.tick)
  return (
    <div className="scrub-banner" role="status">
      Viewing Day {m.day} {m.time} — the town has moved on
    </div>
  )
}

function TickBadge({ store }: { store: WorldStore }) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const live = useSyncExternalStore(store.subscribe, () => store.getMode().live)
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)
  if (!awake) return <div className="tick-badge waking">Waking…</div>
  const m = tickToMoment(tick)
  return (
    <div className={live ? 'tick-badge' : 'tick-badge past'}>
      {live ? 'Now' : 'Back then'} · Day {m.day} · {m.time}
    </div>
  )
}

export function App() {
  const storeRef = useRef<WorldStore | null>(null)
  storeRef.current ??= createWorldStore()
  const store = storeRef.current
  const sockRef = useRef<ObservatoryHandle | null>(null)
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search))
  const [scene, setScene] = useState<Scene | null>(null)
  const [handle, setHandle] = useState<ObservatoryHandle | null>(null)
  const [gapTicks, setGapTicks] = useState<number | null>(null)
  const [link, setLink] = useState<LinkStatus>('connecting')
  // which interior the camera is inside; the Pixi sub-scene owns the truth, this mirrors it
  const [insideId, setInsideId] = useState<string | null>(null)
  // Operator-only: absent for every viewer who did not put a token in this session.
  const [operatorToken] = useState<string | null>(() => adminToken(sessionStorage))

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const handle = connectObservatory({ url: `${proto}://${location.host}/ws`, store, onGap: setGapTicks, onStatus: setLink })
    sockRef.current = handle
    setHandle(handle)

    // deep link: once the first snapshot lands, scrub to the linked moment
    const initial = parseRoute(location.pathname, location.search)
    if (initial.moment) {
      const off = store.subscribe(() => {
        if (store.getState() === null) return
        handle.scrub(momentToTick(initial.moment!.day, initial.moment!.time))
        off()
      })
    }

    const onPop = (): void => setRoute(parseRoute(location.pathname, location.search))
    window.addEventListener('popstate', onPop)
    return () => { handle.close(); window.removeEventListener('popstate', onPop) }
  }, [store])

  // every viewed moment is shareable: scrubs rewrite the address bar in place
  const onView = (tick: number | null): void => {
    const next: Route = { ...route, moment: tick === null ? null : tickToMoment(tick) }
    history.replaceState(null, '', routeToPath(next))
    setRoute(next)
  }

  const nav = (lens: Lens): void => {
    const next = { ...route, lens }
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  const pickAgent = (agentId: string): void => {
    const next: Route = { ...route, lens: 'inspector', agentId }
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  // Opening a recorded day puts its id in the address bar and keeps it there while it plays,
  // so the link a viewer copies mid-playback reopens the same day.
  const openMoment = (momentId: number | null): void => {
    const next: Route = { ...route, lens: 'director', momentId, moment: null }
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  // Left/right walk the lens bar from anywhere in the chrome. The map owns the arrows for
  // panning and a text field owns them for typing, so both keep them (lensKeyAllowed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      const inApplication = t?.closest?.('[role="application"]') != null
      if (!lensKeyAllowed(t?.tagName ?? '', t?.isContentEditable ?? false, inApplication)) return
      const next = lensFromKey(e.key, route.lens)
      if (next === null) return
      e.preventDefault()
      nav(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route])

  // the bonds graph replaces the canvas; pause the Pixi ticker while hidden (60fps budget honesty)
  useEffect(() => {
    if (scene === null) return
    if (route.lens === 'society') scene.app.ticker.stop()
    else scene.app.ticker.start()
  }, [route.lens, scene])

  // The Moments lens has two readings: the live town televised (the C6 auto-cut) and a
  // recorded day playing back. Opening a day retires the auto-cut so its heat-driven camera
  // cannot fight the playback; LIVE brings it back.
  const televised = route.lens === 'director' && route.momentId === null

  // leaving the televised view: keep the director mounted briefly so the letterboxes slide out
  const [directorLeaving, setDirectorLeaving] = useState(false)
  const prevTelevisedRef = useRef(televised)
  useEffect(() => {
    const was = prevTelevisedRef.current
    prevTelevisedRef.current = televised
    if (was && !televised) {
      setDirectorLeaving(true)
      const t = setTimeout(() => setDirectorLeaving(false), 260)
      return () => clearTimeout(t)
    }
  }, [televised])

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="px-title">San Junipero</h1>
        <LensTabs store={store} lens={route.lens} onNav={nav} />
        {link === 'reconnecting' && (
          <div className="link-pill" role="status">Reaching the town…</div>
        )}
        <TickBadge store={store} />
      </header>
      <StatusStrip store={store} />
      <div className="stage-row">
        <main id="stage-root" className={route.lens === 'society' ? 'stage-hidden' : undefined}>
          <StageMount store={store} onScene={setScene} onInterior={setInsideId} />
          <StageVeil store={store} />
          <InteriorBar
            store={store}
            structureId={insideId}
            onBack={() => scene?.interior?.setActive(null)}
          />
          <ScrubBanner store={store} />
          {(route.lens === 'map' || route.lens === 'inspector') && <CameraHud scene={scene} />}
          <FpsOverlay />
          {route.lens === 'chronicle' && <Timeline store={store} handle={handle} onView={onView} />}
          {route.lens === 'society' && <SocietyLens store={store} onPick={pickAgent} />}
          {(televised || directorLeaving) && (
            <DirectorMode store={store} scene={scene} leaving={!televised} />
          )}
          {route.lens === 'director' && (
            <MomentsLens store={store} handle={handle} momentId={route.momentId} onOpen={openMoment} />
          )}
        </main>
        <aside
          id="panel-outlet"
          className={route.lens === 'inspector' || route.lens === 'chronicle' || route.lens === 'laws' ? 'open' : undefined}
        >
          {route.lens === 'inspector' && route.agentId !== null && (
            <InspectorPanel store={store} agentId={route.agentId} scene={scene} />
          )}
          {route.lens === 'inspector' && route.agentId === null && (
            <RosterPanel store={store} onPick={pickAgent} />
          )}
          {route.lens === 'chronicle' && <ChroniclePanel store={store} handle={handle} onView={onView} />}
          {route.lens === 'laws' && (
            <>
              <WorldLaws store={store} />
              <LawsDashboard store={store} token={operatorToken} />
            </>
          )}
        </aside>
      </div>
      {gapTicks !== null && (
        <DigestModal
          store={store}
          missedTicks={gapTicks}
          onMoment={(tick) => {
            sockRef.current?.scrub(tick)
            onView(tick)
            dismissDigest()
          }}
          onClose={dismissDigest}
        />
      )}
    </div>
  )

  function dismissDigest(): void {
    try { localStorage.setItem(LAST_SEEN_KEY, String(store.getTick())) } catch { /* private mode */ }
    setGapTicks(null)
  }
}
