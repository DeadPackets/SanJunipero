import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentToTick, tickToMoment } from '@sj/shared'
import { createWorldStore, type WorldStore } from './state/worldStore.js'
import { connectObservatory, type ObservatoryHandle } from './net/socket.js'
import { LENSES, parseRoute, routeToPath, type Lens, type Route } from './ui/route.js'
import { StageMount } from './render/StageMount.js'

// chrome copy speaks about townsfolk, never machinery (spec §5)
const LENS_LABELS: Record<Lens, string> = {
  map: 'Town', inspector: 'Townsfolk', chronicle: 'Chronicle', society: 'Bonds', director: 'Moments',
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

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const handle = connectObservatory({ url: `${proto}://${location.host}/ws`, store })
    sockRef.current = handle

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

  const nav = (lens: Lens): void => {
    const next = { ...route, lens }
    history.pushState(null, '', routeToPath(next))
    setRoute(next)
  }

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
        <main id="stage-root">
          <StageMount store={store} />
        </main>
        <aside id="panel-outlet" />
      </div>
    </div>
  )
}
