import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentToTick, tickToMoment } from '@sj/shared'
import { createWorldStore, type WorldStore } from './state/worldStore.js'
import { connectObservatory, type ObservatoryHandle } from './net/socket.js'
import { LENSES, parseRoute, routeToPath, type Lens, type Route } from './ui/route.js'
import { StageMount } from './render/StageMount.js'
import { InspectorPanel } from './ui/InspectorPanel.js'
import { ChroniclePanel } from './ui/ChroniclePanel.js'
import { SocietyLens } from './ui/SocietyLens.js'
import { Timeline } from './ui/Timeline.js'
import type { Scene } from './render/scene.js'

// chrome copy speaks about townsfolk, never machinery (spec §5)
const LENS_LABELS: Record<Lens, string> = {
  map: 'Town', inspector: 'Townsfolk', chronicle: 'Chronicle', society: 'Bonds', director: 'Moments',
}

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

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const handle = connectObservatory({ url: `${proto}://${location.host}/ws`, store })
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

  // the bonds graph replaces the canvas; pause the Pixi ticker while hidden (60fps budget honesty)
  useEffect(() => {
    if (scene === null) return
    if (route.lens === 'society') scene.app.ticker.stop()
    else scene.app.ticker.start()
  }, [route.lens, scene])

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="px-title">San Junipero</h1>
        <nav className="lens-tabs">
          {LENSES.map((lens) => (
            <button key={lens} className={lens === route.lens ? 'tab active' : 'tab'} onClick={() => nav(lens)}>
              {LENS_LABELS[lens]}
            </button>
          ))}
        </nav>
        <TickBadge store={store} />
      </header>
      <div className="stage-row">
        <main id="stage-root" className={route.lens === 'society' ? 'stage-hidden' : undefined}>
          <StageMount store={store} onScene={setScene} />
          <ScrubBanner store={store} />
          {route.lens === 'chronicle' && <Timeline store={store} handle={handle} onView={onView} />}
          {route.lens === 'society' && <SocietyLens store={store} onPick={pickAgent} />}
        </main>
        <aside
          id="panel-outlet"
          className={(route.lens === 'inspector' && route.agentId !== null) || route.lens === 'chronicle' ? 'open' : undefined}
        >
          {route.lens === 'inspector' && route.agentId !== null && (
            <InspectorPanel store={store} agentId={route.agentId} scene={scene} />
          )}
          {route.lens === 'chronicle' && <ChroniclePanel store={store} />}
        </aside>
      </div>
    </div>
  )
}
