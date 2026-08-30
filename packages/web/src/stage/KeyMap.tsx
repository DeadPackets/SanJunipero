import { Fragment, useEffect, useRef } from 'react'
import { stageKeyAllowed } from './useStageKeys.js'

/** The key that opens it — where a person looks for exactly this, which is why the frame meter
 *  had to move off it (`ui/FpsOverlay.tsx`). */
export const KEY_MAP_KEY = '?'

/** Every key the town answers to, in the order a hand finds them. Read off the bindings, not off
 *  a document: `useStageKeys` owns S/F/D/Esc, `render/cameraNav.ts` owns the camera. */
export const KEY_MAP: readonly { keys: readonly string[]; says: string }[] = [
  { keys: ['S'], says: 'the signpost' },
  { keys: ['Tab'], says: 'step through the chrome' },
  { keys: ['Enter'], says: 'open what is focused' },
  { keys: ['Esc'], says: 'put down what is up' },
  { keys: ['←', '↑', '→', '↓'], says: 'walk the camera' },
  { keys: ['+', '−'], says: 'closer, further' },
  { keys: ['Home'], says: 'back to the middle' },
  { keys: ['F'], says: 'fullscreen' },
  { keys: ['D'], says: 'the director' },
  { keys: ['?'], says: 'this sheet' },
  { keys: ['⇧', 'P'], says: 'the frame meter' },
]

export function KeyMap({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  // `?` alone. Esc is NOT bound here: `ui/interaction.ts` owns the one ladder, and a second
  // listener for it would take two rungs at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== KEY_MAP_KEY || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (!stageKeyAllowed(t?.tagName ?? '', t?.isContentEditable ?? false)) return
      e.preventDefault()
      onOpenChange(!open)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  // A click on the town is the fourth way down, the same as the paper's.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!(sheet.current?.contains(e.target as Node) ?? false)) onOpenChange(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement
      sheet.current?.focus()
      return
    }
    const back = opener.current
    opener.current = null
    if (back instanceof HTMLElement) back.focus()
  }, [open])

  if (!open) return null
  return (
    <div className="key-map">
      <div
        className="key-map-sheet"
        ref={sheet}
        role="dialog"
        aria-label="What the town answers to"
        tabIndex={-1}
      >
        <div className="key-map-head">
          <h2 className="key-map-title">What the town answers to</h2>
          <button
            type="button"
            className="paper-close"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            close
          </button>
        </div>
        <dl className="key-map-list">
          {KEY_MAP.map((row) => (
            <Fragment key={row.says}>
              <dt className="key-map-keys">
                {row.keys.map((k) => (
                  <kbd className="key-map-key" key={k}>
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="key-map-says">{row.says}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  )
}
