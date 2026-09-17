import type { WorldStore } from '../state/worldStore.js'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { GameIcon, BOOK_ICON } from './game/shared.js'
import { ARMS, PAGE_TITLE, type Arm, type PageKey } from './pageModel.js'

export function Signpost({
  open,
  onOpen,
  ref,
  stories,
  store,
}: {
  open: PageKey | null
  onOpen: (arm: Arm) => void
  stories: ReactNode
  store: WorldStore
  ref?: React.Ref<HTMLElement>
}) {
  const threads = useSyncExternalStore(store.subscribe, store.threads, store.threads)
  const storyCount = threads?.threads.length ?? 0
  const storiesLabel = storyCount ? `Stories · ${storyCount} active` : 'Stories'
  const [pocket, setPocket] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const pocketToggle = useRef<HTMLButtonElement>(null)
  useImperativeHandle(ref, () => root.current!, [])

  useEffect(() => {
    if (!expanded && !pocket) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setExpanded(false)
        setPocket(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setExpanded(false)
      setPocket(false)
      const trigger = pocket ? pocketToggle : toggle
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [expanded, pocket])

  return (
    <nav
      id="signpost"
      className="signpost"
      aria-label="Town journal"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setExpanded(false)
          setPocket(false)
        }
      }}
    >
      {pocket && (
        <div className="journal-pocket" id="journal-pocket">
          {stories}
          <button
            type="button"
            className="pocket-close"
            onClick={() => {
              setPocket(false)
              pocketToggle.current?.focus({ preventScroll: true })
            }}
          >
            Close stories
          </button>
        </div>
      )}
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
        <div className="journal-bottom">
          <button
            ref={toggle}
            type="button"
            className="journal-toggle"
            aria-expanded={expanded}
            aria-controls="journal-sections"
            onClick={() => {
              setExpanded((value) => !value)
              setPocket(false)
            }}
          >
            <GameIcon kind="note" />
            Town journal
            <span className="journal-chevron" aria-hidden="true">
              ⌃
            </span>
          </button>
          <button
            type="button"
            className="pocket-toggle"
            ref={pocketToggle}
            aria-label={storiesLabel}
            title={storiesLabel}
            aria-expanded={pocket}
            aria-controls="journal-pocket"
            onClick={() => {
              setPocket((v) => !v)
              setExpanded(false)
            }}
          >
            <GameIcon kind="chronicle" />
            {storyCount > 0 && (
              <span className="pocket-count" aria-hidden="true">
                {storyCount > 99 ? '99+' : storyCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  )
}
