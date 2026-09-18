import { GameIcon, BOOK_ICON } from './game/shared.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flingFrom, trackDrag, type DragTrack } from '../render/fling.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Subject } from '../stage/index.js'
import { PageBoundary } from './PageBoundary.js'
import { PageBody } from './pages/index.js'
import type { PaperNotice, Thing } from './pages/types.js'
import type { MomentPlay } from '../ui/replayRun.js'
import type { PaperDock } from '../ui/storage.js'
import { PAGE_TITLE, gripDismiss, hasTab, type PageKey } from './pageModel.js'

/** Upward, the sheet is already at the top of its travel, so it gives a third of the throw. */
const RUBBER_BAND = 3
const tabId = (tab: string) => `paper-tab-${tab.toLowerCase().replaceAll(' ', '-')}`

type Drag = { from: number; dim: number; tall: number; at: number; track: DragTrack }

/** Non-modal on purpose: the town keeps living above it, and a click on the town puts it away. */
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
  dock,
  onTab,
  onBrowse,
  onWatch,
  onDock,
  onClose,
  onSubject,
  onInside,
  onScrub,
  onPlay,
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
  dock: PaperDock
  onBrowse: (page: PageKey, tab?: string) => void
  onWatch: (subject: Subject) => void
  onTab: (tab: string) => void
  onDock: () => void
  onClose: () => void
  onSubject: (subject: Subject) => void
  onInside: (structureId: string | null) => void
  onScrub: (tick: number) => void
  onPlay: (play: MomentPlay) => void
  onLive: () => void
  onMoment: (id: number | null) => void
}) {
  const open = page !== null
  const tabsRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const sheetBoxRef = useRef<HTMLDivElement>(null)
  const dimRef = useRef<HTMLDivElement>(null)
  // The page is held for the 300 ms it takes to slide out, so the sheet is never blank in flight.
  const [shown, setShown] = useState<PageKey | null>(page)
  if (page !== null && page !== shown) setShown(page)

  const key = shown ?? 'folk'
  const primary = {
    folk: ['Everyone', 'Following'],
    chronicle: ['Catch up', 'Timeline', 'Firsts'],
    found: ['Places', 'Discoveries'],
    laws: ['Agreements', 'Milestones', 'How it works'],
    person: ['Now', 'Relationships', 'History'],
    building: ['About', 'Inside'],
  }
  const tabs: readonly string[] =
    primary[key].includes(tab) || !hasTab(key, tab) ? primary[key] : [...primary[key], tab]
  const current = hasTab(key, tab) ? tab : tabs[0]!
  const [notice, setNotice] = useState<PaperNotice | null>(null)
  const docked = dock === 'docked'

  // The opener is whatever was pressed to raise the sheet, and it gets the focus back on the way
  // down. Its own effect, so a tab change does not bounce focus through it and announce twice.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    return () => {
      opener?.focus()
    }
  }, [open])

  // Switching arms unmounts the focused tab and focus would fall to <body>. Seating it on the tab
  // being shown, not the first one, is also what tells a reader a tab change landed somewhere.
  useEffect(() => {
    if (!open) return
    tabsRef.current
      ?.querySelector<HTMLButtonElement>(`#${tabId(current)}`)
      ?.focus({ preventScroll: true })
  }, [open, key, current, subject?.id])

  // A layout effect, not a passive one: Found runs its own scroll-to-row in a child passive
  // effect, which is later, so this returns the box to the top without undoing that.
  useLayoutEffect(() => {
    if (sheetBoxRef.current !== null) sheetBoxRef.current.scrollTop = 0
  }, [open, key, current, subject?.id])

  const release = (): void => {
    if (sheetRef.current !== null) sheetRef.current.style.cssText = ''
    if (dimRef.current !== null) dimRef.current.style.cssText = ''
  }
  useEffect(() => {
    if (open) release()
  }, [open])

  // Written straight to the DOM: a sheet following a finger through React state would re-render
  // the whole page on every pointer sample, and the read-once values keep layout out of the loop.
  const drag = useRef<Drag | null>(null)
  const paint = (down: number, d: Drag): void => {
    const sheet = sheetRef.current
    const y = Math.round(down > 0 ? down : down / RUBBER_BAND)
    if (sheet === null || y === d.at) return
    d.at = y
    sheet.style.transform = `translateY(${y}px)`
    if (dimRef.current !== null) {
      dimRef.current.style.opacity = `${d.dim * (1 - Math.min(1, y / d.tall))}`
    }
  }

  const title =
    key === 'person' || key === 'building' ? (subject?.name ?? PAGE_TITLE[key]) : PAGE_TITLE[key]

  return (
    <>
      <div
        className="town-dim"
        data-open={open ? 'yes' : 'no'}
        data-dock={docked ? 'on' : 'off'}
        onClick={onClose}
        aria-hidden="true"
        ref={dimRef}
      />
      <section
        className="paper sj-paper"
        id="paper"
        data-open={open ? 'yes' : 'no'}
        data-dock={docked ? 'on' : 'off'}
        data-book={key === 'person' ? 'folk' : key === 'building' ? 'found' : key}
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
            sheet.style.transform = 'translateY(102%)'
            if (dimRef.current !== null) dimRef.current.style.opacity = '0'
            onClose()
          }}
          onPointerCancel={() => {
            drag.current = null
            release()
          }}
        />
        <header className="paper-head">
          <nav className="sj-books" aria-label="Browse the town">
            {(['folk', 'chronicle', 'found', 'laws'] as const).map((book) => (
              <button
                type="button"
                key={book}
                data-book={book}
                aria-current={
                  (key === 'person' ? 'folk' : key === 'building' ? 'found' : key) === book
                    ? 'page'
                    : undefined
                }
                onClick={() => {
                  onBrowse(book)
                }}
              >
                <GameIcon kind={BOOK_ICON[book]} />
                {PAGE_TITLE[book]}
              </button>
            ))}
          </nav>
          <h2 className="paper-title" id="paper-title">
            <GameIcon kind={BOOK_ICON[key]} />
            {title}
          </h2>
          <p className="sj-book-intro">
            {
              {
                folk: 'Get to know the people who make this place.',
                person: 'A small window into a life.',
                chronicle: 'The moments that make a town.',
                found: 'Explore what they build and discover.',
                building: 'A place in the life of the town.',
                laws: 'How a town learns to live together.',
              }[key]
            }
          </p>
          <div className="paper-dateline">
            <div
              className="paper-tabs"
              role="tablist"
              aria-label={title}
              aria-describedby="paper-tabs-keys"
              ref={tabsRef}
              onKeyDown={(e) => {
                const index = tabs.indexOf(current)
                const next =
                  e.key === 'ArrowRight'
                    ? tabs[(index + 1) % tabs.length]
                    : e.key === 'ArrowLeft'
                      ? tabs[(index - 1 + tabs.length) % tabs.length]
                      : e.key === 'Home'
                        ? tabs[0]
                        : e.key === 'End'
                          ? tabs[tabs.length - 1]
                          : null
                if (next == null) return
                e.preventDefault()
                onTab(next)
                e.currentTarget.querySelector<HTMLButtonElement>(`#${tabId(next)}`)?.focus()
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={tabId(t)}
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
            {/* The narrow dateline lifts this flank to row 1, off the tabs' own row. */}
            <div className="paper-marginalia">
              <button type="button" className="paper-dock" aria-pressed={docked} onClick={onDock}>
                {docked ? 'Undock' : 'Dock'}
              </button>
              <button type="button" className="paper-close" onClick={onClose}>
                Close<span className="paper-close-key"> · Esc</span>
              </button>
            </div>
          </div>
        </header>
        {key === 'laws' && notice !== null && (
          <p className="laws-notice" role="status" aria-live={notice.ok ? 'polite' : 'assertive'}>
            {notice.words}
          </p>
        )}
        <div
          className="paper-sheet"
          id="paper-sheet"
          role="tabpanel"
          aria-labelledby={tabId(current)}
          tabIndex={-1}
          ref={sheetBoxRef}
        >
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
                onScrub={onScrub}
                onPlay={onPlay}
                onLive={onLive}
                onMoment={onMoment}
                onNotice={setNotice}
                onBrowse={onBrowse}
              />
            </PageBoundary>
          ) : null}
        </div>
        {open && subject !== null && (key === 'person' || key === 'building') && (
          <footer className="sj-watch-footer">
            <button
              type="button"
              className="sj-primary"
              onClick={() => {
                onWatch(subject)
              }}
            >
              <GameIcon kind="compass" />
              {key === 'person' ? `Watch ${subject.name}` : 'Find this place in town'} →
            </button>
            <p>Move your view. The town keeps making its own choices.</p>
          </footer>
        )}
      </section>
    </>
  )
}
