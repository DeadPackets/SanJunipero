import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { GameIcon, BOOK_ICON } from './game/shared.js'
import { ARMS, PAGE_TITLE, type Arm, type PageKey } from './pageModel.js'

export function Signpost({
  open,
  onOpen,
  ref,
}: {
  open: PageKey | null
  onOpen: (arm: Arm) => void
  ref?: React.Ref<HTMLElement>
}) {
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useImperativeHandle(ref, () => root.current!, [])

  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setExpanded(false)
      toggle.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [expanded])

  return (
    <nav
      id="signpost"
      className="signpost"
      aria-label="Town journal"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false)
      }}
    >
      <div className="journal-frame" data-expanded={expanded}>
        <div
          className="journal-sections"
          id="journal-sections"
          inert={!expanded}
          aria-hidden={!expanded}
        >
          <div className="journal-clip">
            <div className="journal-options">
              {ARMS.map((arm, index) => (
                <button
                  key={arm}
                  type="button"
                  className="journal-option"
                  data-arm={arm}
                  style={{ '--order': index } as React.CSSProperties}
                  aria-expanded={open === arm}
                  aria-controls="paper"
                  onClick={() => {
                    // Paper returns focus to this persistent button after its sheet closes.
                    toggle.current?.focus({ preventScroll: true })
                    setExpanded(false)
                    onOpen(arm)
                  }}
                >
                  <GameIcon kind={BOOK_ICON[arm]} />
                  {PAGE_TITLE[arm]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          ref={toggle}
          type="button"
          className="journal-toggle"
          aria-expanded={expanded}
          aria-controls="journal-sections"
          onClick={() => setExpanded((value) => !value)}
        >
          <GameIcon kind="note" />
          Town journal
          <span className="journal-chevron" aria-hidden="true">
            ⌃
          </span>
        </button>
      </div>
    </nav>
  )
}
