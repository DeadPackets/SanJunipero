import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Subject } from '../stage/index.js'
import { PageBody } from './pages/index.js'
import {
  GRIP_CLOSE_PX,
  PAGE_TABS,
  PAGE_TITLE,
  hasTab,
  tabFromKey,
  type PageKey,
} from './pageModel.js'

/** A sheet of paper the town hands up when you ask it something. Non-modal on purpose: the
 *  town keeps living above it, and a click on the town puts it away. */
export function Paper({
  page,
  tab,
  subject,
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
}: {
  page: PageKey | null
  tab: string
  subject: Subject | null
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
}) {
  const open = page !== null
  const tabsRef = useRef<HTMLDivElement>(null)
  // The page is held for the 300 ms it takes to slide out, so the sheet is never blank in flight.
  const [shown, setShown] = useState<PageKey | null>(page)
  if (page !== null && page !== shown) setShown(page)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    tabsRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      opener?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const dragRef = useRef<number | null>(null)
  useEffect(() => {
    if (!open) return
    const onUp = (e: PointerEvent): void => {
      const from = dragRef.current
      dragRef.current = null
      if (from !== null && e.clientY - from > GRIP_CLOSE_PX) onClose()
    }
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
    }
  }, [open, onClose])

  const key = shown ?? 'folk'
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
      />
      <section
        className="paper"
        data-open={open ? 'yes' : 'no'}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        aria-labelledby="paper-title"
      >
        <div
          className="paper-grip"
          aria-hidden="true"
          onPointerDown={(e) => {
            dragRef.current = e.clientY
          }}
        />
        <header className="paper-head">
          <h2 className="paper-title" id="paper-title">
            {title}
          </h2>
          <div
            className="paper-tabs"
            role="tablist"
            aria-label={`${title} — left and right arrow keys move between pages`}
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
          <button type="button" className="paper-close" onClick={onClose}>
            close · Esc
          </button>
        </header>
        <div className="paper-sheet" id="paper-sheet" role="tabpanel" tabIndex={-1}>
          {open ? (
            <PageBody
              page={key}
              tab={current}
              subject={subject}
              store={store}
              scene={scene}
              operatorToken={operatorToken}
              insideId={insideId}
              gapTicks={gapTicks}
              onSubject={onSubject}
              onInside={onInside}
              onJump={onJump}
              onLive={onLive}
            />
          ) : null}
        </div>
      </section>
    </>
  )
}
