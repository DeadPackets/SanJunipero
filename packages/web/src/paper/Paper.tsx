import { useEffect, useRef, useState } from 'react'
import { flingFrom, trackDrag, type DragTrack } from '../render/fling.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Subject } from '../stage/index.js'
import { PageBoundary } from './PageBoundary.js'
import { PageBody } from './pages/index.js'
import type { Thing } from './pages/types.js'
import {
  PAGE_TABS,
  PAGE_TITLE,
  gripDismiss,
  hasTab,
  tabFromKey,
  type PageKey,
} from './pageModel.js'

/** Upward, the sheet is already at the top of its travel, so it gives a third of the throw. */
const RUBBER_BAND = 3

type Drag = { from: number; dim: number; tall: number; at: number; track: DragTrack }

/** A sheet of paper the town hands up when you ask it something. Non-modal on purpose: the
 *  town keeps living above it, and a click on the town puts it away. */
export function Paper({
  page,
  tab,
  subject,
  thing,
  momentId,
  store,
  scene,
  operatorToken,
  insideId,
  gapTicks,
  onTab,
  onClose,
  onSubject,
  onInside,
  onJump,
  onLive,
  onMoment,
}: {
  page: PageKey | null
  tab: string
  subject: Subject | null
  thing: Thing | null
  momentId: number | null
  store: WorldStore
  scene: Scene | null
  operatorToken: string | null
  insideId: string | null
  gapTicks: number | null
  onTab: (tab: string) => void
  onClose: () => void
  onSubject: (subject: Subject) => void
  onInside: (structureId: string | null) => void
  onJump: (tick: number) => void
  onLive: () => void
  onMoment: (id: number | null) => void
}) {
  const open = page !== null
  const tabsRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const dimRef = useRef<HTMLDivElement>(null)
  // The page is held for the 300 ms it takes to slide out, so the sheet is never blank in flight.
  const [shown, setShown] = useState<PageKey | null>(page)
  if (page !== null && page !== shown) setShown(page)

  const key = shown ?? 'folk'

  // [open, key]: switching arms while the sheet is up unmounts the focused tab, and focus fell
  // to <body>.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    tabsRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      opener?.focus()
    }
  }, [open, key])

  /** Hand the sheet and the scrim back to the stylesheet, whatever the drag wrote on them. */
  const release = (): void => {
    if (sheetRef.current !== null) sheetRef.current.style.cssText = ''
    if (dimRef.current !== null) dimRef.current.style.cssText = ''
  }
  useEffect(() => {
    if (open) release()
  }, [open])

  // The drag is written straight to the DOM: a sheet following a finger through React state
  // would re-render the whole page on every pointer sample. The sheet's height and the scrim's
  // rest opacity are read once on the way down, so no sample flushes layout.
  const drag = useRef<Drag | null>(null)
  const paint = (down: number, d: Drag): void => {
    const sheet = sheetRef.current
    const y = Math.round(down > 0 ? down : down / RUBBER_BAND)
    if (sheet === null || y === d.at) return
    d.at = y
    sheet.style.transform = `translate(-50%, ${y}px)`
    // the town brightening under your thumb is the whole feeling
    if (dimRef.current !== null) {
      dimRef.current.style.opacity = `${d.dim * (1 - Math.min(1, y / d.tall))}`
    }
  }

  const tabs = PAGE_TABS[key] as readonly string[]
  const current = hasTab(key, tab) ? tab : tabs[0]!
  const title =
    key === 'person' || key === 'building' ? (subject?.name ?? PAGE_TITLE[key]) : PAGE_TITLE[key]

  return (
    <>
      <div
        className="town-dim"
        data-open={open ? 'yes' : 'no'}
        onClick={onClose}
        aria-hidden="true"
        ref={dimRef}
      />
      <section
        className="paper"
        data-open={open ? 'yes' : 'no'}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        aria-labelledby="paper-title"
        inert={!open}
        ref={sheetRef}
      >
        <div
          className="paper-grip"
          aria-hidden="true"
          onPointerDown={(e) => {
            const sheet = sheetRef.current
            if (sheet === null) return
            e.currentTarget.setPointerCapture(e.pointerId)
            // The sheet's CSS transition is what normally earns it a compositor layer, and the
            // drag turns it off, so the layer is asked for by hand for the length of the drag.
            sheet.style.transition = 'none'
            sheet.style.willChange = 'transform'
            const dim = dimRef.current
            const rest = dim === null ? 0 : Number(getComputedStyle(dim).opacity)
            // ...and the scrim's own 300ms would restart from the interpolated value on every
            // sample, so it never reaches the finger.
            if (dim !== null) dim.style.transition = 'none'
            drag.current = {
              from: e.clientY,
              dim: rest,
              tall: sheet.offsetHeight,
              at: 0,
              // the camera's own tail, so the sheet and the town read a throw the same way
              track: trackDrag(null, 0, e.clientY, e.timeStamp),
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (d === null) return
            d.track = trackDrag(d.track, 0, e.clientY, e.timeStamp)
            paint(e.clientY - d.from, d)
          }}
          onPointerUp={(e) => {
            const d = drag.current
            const sheet = sheetRef.current
            drag.current = null
            if (d === null || sheet === null) return
            const thrown = flingFrom(trackDrag(d.track, 0, e.clientY, e.timeStamp), e.timeStamp)
            release()
            if (!gripDismiss(e.clientY - d.from, thrown?.vy ?? 0)) return
            // the CSS owns the way down again, and its own rule makes it instant under reduce
            sheet.style.transform = 'translate(-50%, 102%)'
            if (dimRef.current !== null) dimRef.current.style.opacity = '0'
            onClose()
          }}
          onPointerCancel={() => {
            drag.current = null
            release()
          }}
        />
        <header className="paper-head">
          <h2 className="paper-title" id="paper-title">
            {title}
          </h2>
          <div
            className="paper-tabs"
            role="tablist"
            aria-label={title}
            aria-describedby="paper-tabs-keys"
            ref={tabsRef}
            onKeyDown={(e) => {
              const next = tabFromKey(key, e.key, current)
              if (next === null) return
              e.preventDefault()
              onTab(next)
              e.currentTarget.querySelector<HTMLButtonElement>(`#paper-tab-${next}`)?.focus()
            }}
          >
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`paper-tab-${t}`}
                aria-selected={t === current}
                aria-controls="paper-sheet"
                tabIndex={t === current ? 0 : -1}
                className={t === current ? 'paper-tab on' : 'paper-tab'}
                onClick={() => {
                  onTab(t)
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {/* A hint, not a name: as the label it was re-announced on every tab focus. */}
          <p className="stage-sr" id="paper-tabs-keys">
            Left and right arrow keys move between pages
          </p>
          <button type="button" className="paper-close" onClick={onClose}>
            close<span className="paper-close-key"> · Esc</span>
          </button>
        </header>
        <div className="paper-sheet" id="paper-sheet" role="tabpanel" tabIndex={-1}>
          {open ? (
            // Keyed by the page, not the tab: a tab switch must not drop the page's feeds and
            // refetch them, so a caught page clears on the next arm or the next time it is opened.
            <PageBoundary key={key}>
              <PageBody
                page={key}
                tab={current}
                subject={subject}
                thing={thing}
                momentId={momentId}
                store={store}
                scene={scene}
                operatorToken={operatorToken}
                insideId={insideId}
                gapTicks={gapTicks}
                onSubject={onSubject}
                onInside={onInside}
                onJump={onJump}
                onLive={onLive}
                onMoment={onMoment}
              />
            </PageBoundary>
          ) : null}
        </div>
      </section>
    </>
  )
}
