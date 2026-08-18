import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentToTick, tickToMoment } from '@sj/shared'
import { createWorldStore, type WorldStore } from './state/worldStore.js'
import { connectObservatory, type LinkStatus, type ObservatoryHandle } from './net/socket.js'
import {
  backToRoster, isSingleAgentView, navToLens, parseRoute, routeToPath, type Lens, type Route,
} from './ui/route.js'
import { lensFromKey, lensKeyAllowed } from './ui/interaction.js'
import { StageMount } from './render/StageMount.js'
import { InspectorPanel } from './ui/InspectorPanel.js'
import { RosterPanel } from './ui/RosterPanel.js'
import { expandReducer } from './ui/roster/expand.js'
import { ChroniclePanel } from './ui/ChroniclePanel.js'
import { SocietyLens } from './ui/SocietyLens.js'
import { MomentsLens } from './ui/MomentsLens.js'
import { DigestModal } from './ui/DigestModal.js'
import { StageVeil } from './ui/StageVeil.js'
import { InteriorBar } from './ui/InteriorBar.js'
import { LensTabs, StatusStrip } from './ui/StatusStrip.js'
import { ControlBar } from './ui/ControlBarView.js'
import { controlItems, type ControlAction } from './ui/controlBar.js'
import { HudDock } from './ui/HudDock.js'
import {
  DEFAULT_HUD, HUD_TOGGLE_KEY, hudReducer, hudToggle, loadHud, saveHud, type HudEv,
} from './ui/hudLayout.js'
import { stepZoom } from './render/cameraNav.js'
import type { ZoomStop } from './render/camera.js'
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
  // what the bottom bar reads: the camera's own stop, and whether the chrome is put away
  const [zoomStop, setZoomStop] = useState<ZoomStop>(1)
  // WHERE THE CHROME SITS. Slot-based, persisted per viewer, and never able to hide its own
  // way back — HudDock is not itself a Dockable.
  const [hud, setHud] = useState(() => {
    try { return loadHud(localStorage) } catch { return DEFAULT_HUD }
  })
  const [dockOpen, setDockOpen] = useState(false)
  // the key handler is registered once; it reads the layout through a ref rather than
  // re-registering on every dock change
  const hudRef = useRef(hud)
  hudRef.current = hud
  const hudHidden = hud.controlBar === 'hidden'
  const applyHud = (ev: HudEv): void => {
    setHud((prev) => {
      const next = hudReducer(prev, ev)
      try { saveHud(localStorage, next) } catch { /* private mode */ }
      return next
    })
  }

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

  // ADAPTER: the nav item is the way back a viewer reaches for first, so TOWNSFOLK returns
  // to the roster when one person is already open (see navToLens).
  const nav = (lens: Lens): void => {
    const next = navToLens(route, lens)
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  // ADAPTER: the back affordance in the single-character view.
  const showRoster = (): void => {
    const next = backToRoster(route)
    if (next === route) return
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  const pickAgent = (agentId: string): void => {
    const next: Route = { ...route, lens: 'inspector', agentId, openId: null }
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

  // Opening a roster row is a state of the LIST, not a navigation: the list never unmounts, so
  // there is no back to get wrong. It is still shareable, as `?open=`.
  const toggleRow = (agentId: string): void => {
    const nextState = expandReducer({ openId: route.openId }, { kind: 'toggle', id: agentId }, [agentId])
    const next: Route = { ...route, openId: nextState.openId }
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

  // ADAPTER: Escape steps back out of one person to the roster — but only when no interior
  // is open, because the room claimed Escape first and a viewer expects one step at a time.
  useEffect(() => {
    if (!isSingleAgentView(route) || insideId !== null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      e.preventDefault()
      showRoster()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, insideId])

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

  const live = useSyncExternalStore(store.subscribe, () => store.getMode().live)

  // A viewer who puts the controls away must always be able to get them back: `H` toggles
  // from anywhere, so hiding is never a trap. Task 78 adds the pointer's way back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== HUD_TOGGLE_KEY) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      if (t !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (t?.isContentEditable === true) return
      e.preventDefault()
      applyHud(hudToggle(hudRef.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // the bar mirrors the camera's rest stop; the camera owns the truth, this follows it
  useEffect(() => {
    if (scene === null) return
    setZoomStop(scene.getZoomStop())
    return scene.onCamera(() => setZoomStop(scene.getZoomStop()))
  }, [scene])

  // ONE place where a control becomes a thing that happens. The bar has no logic of its own.
  const onControl = (a: ControlAction): void => {
    switch (a.kind) {
      case 'lens': nav(a.lens); return
      case 'zoom': scene?.setZoom(stepZoom(scene.getZoomStop(), a.dir)); return
      case 'fit': scene?.fitToTown(); return
      case 'live': sockRef.current?.goLive(); return
      case 'follow': scene?.setFollow(null); return
      case 'exit-interior': scene?.interior?.setActive(null); return
      case 'hud': applyHud({ kind: a.op === 'hide' ? 'hide-all' : 'show-all' }); return
    }
  }

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
      {hud.statusStrip !== 'hidden' && <StatusStrip store={store} />}
      <div className="stage-row">
        <main
          id="stage-root"
          data-dock-controls={hud.controlBar}
          className={route.lens === 'society' ? 'stage-hidden' : undefined}
        >
          <div className="stage-cell">
          <StageMount store={store} onScene={setScene} onInterior={setInsideId} />
          <StageVeil store={store} />
          <InteriorBar
            store={store}
            structureId={insideId}
            onBack={() => scene?.interior?.setActive(null)}
          />
          <ScrubBanner store={store} />
          {hud.fps !== 'hidden' && <FpsOverlay />}
          {route.lens === 'chronicle' && hud.timeline !== 'hidden' && (
            <Timeline store={store} handle={handle} onView={onView} />
          )}
          {route.lens === 'society' && <SocietyLens store={store} onPick={pickAgent} />}
          {(route.lens === 'director' || directorLeaving) && (
            <MomentsLens
              store={store}
              handle={handle}
              scene={scene}
              momentId={route.momentId}
              televised={televised}
              leaving={route.lens !== 'director'}
              onOpen={openMoment}
            />
          )}
          </div>
          <HudDock
            layout={hud}
            open={dockOpen}
            onEvent={(ev) => { applyHud(ev); if (ev.kind !== 'dock') setDockOpen(false) }}
            onOpen={setDockOpen}
          />
          {!hudHidden && (
            <ControlBar
              items={controlItems({
                lens: route.lens, live, zoom: zoomStop, following: null, insideId, hudHidden,
              })}
              onAction={onControl}
            />
          )}
        </main>
        <aside
          id="panel-outlet"
          className={route.lens === 'inspector' || route.lens === 'chronicle' || route.lens === 'laws' ? 'open' : undefined}
        >
          {route.lens === 'inspector' && route.agentId !== null && (
            <InspectorPanel store={store} agentId={route.agentId} scene={scene} onBack={showRoster} />
          )}
          {route.lens === 'inspector' && route.agentId === null && (
            <RosterPanel store={store} openId={route.openId} onToggle={toggleRow} onOpenFull={pickAgent} />
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
