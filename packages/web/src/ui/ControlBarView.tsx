import { useRef, useState } from 'react'
import {
  CONTROL_GLYPH_PX,
  CONTROL_GROUPS,
  actionFor,
  controlGlyph,
  type ControlAction,
  type ControlItem,
} from './controlBar.js'

// The bar is a grid ROW of the stage, not an absolute overlay, so P19 holds by construction:
// nothing it contains can ever sit on top of the town.

/** Decorative: the button's own label carries the meaning, so the glyph stays out of the
 *  accessibility tree instead of being read twice. */
function Glyph({ id }: { id: string }) {
  return (
    <svg
      className="ctl-glyph"
      viewBox={`0 0 ${CONTROL_GLYPH_PX} ${CONTROL_GLYPH_PX}`}
      width={CONTROL_GLYPH_PX * 2}
      height={CONTROL_GLYPH_PX * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {controlGlyph(id).map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

/** A toolbar with a ROVING TABINDEX: one tab stop for the whole bar, Left and Right walk it. */
export function ControlBar({
  items,
  onAction,
}: {
  items: ControlItem[]
  onAction: (a: ControlAction) => void
}) {
  const [at, setAt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const focusable = items.filter((i) => i.disabled !== true)
  const cursor = Math.min(at, Math.max(0, focusable.length - 1))

  /** Read the cursor from FOCUS, not React state: four arrow presses inside one frame all see
   *  the same stale state and compute the same next index, so the bar moves once and stops. */
  const goTo = (index: number): void => {
    if (focusable.length === 0) return
    const next = (index + focusable.length) % focusable.length
    setAt(next)
    ref.current?.querySelector<HTMLButtonElement>(`[data-ctl="${focusable[next]!.id}"]`)?.focus()
  }

  const here = (): number => {
    const id = (ref.current?.ownerDocument.activeElement as HTMLElement | null)?.dataset.ctl
    const i = id === undefined ? -1 : focusable.findIndex((f) => f.id === id)
    return i >= 0 ? i : cursor
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      goTo(here() + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goTo(here() - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      goTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      goTo(focusable.length - 1)
    }
  }

  return (
    <div
      ref={ref}
      className="control-bar"
      role="toolbar"
      aria-label="Town controls"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {CONTROL_GROUPS.map((group) => {
        const inGroup = items.filter((i) => i.group === group)
        if (inGroup.length === 0) return null
        return (
          <div className="ctl-group" key={group} data-group={group}>
            {inGroup.map((item) => {
              const tabIndex = item.disabled === true || focusable[cursor]?.id !== item.id ? -1 : 0
              return (
                <button
                  key={item.id}
                  type="button"
                  data-ctl={item.id}
                  className={item.state === 'on' ? 'ctl-btn on' : 'ctl-btn'}
                  tabIndex={tabIndex}
                  disabled={item.disabled === true}
                  title={item.disabled === true ? item.disabledReason : item.label}
                  aria-label={item.label}
                  {...(item.state === undefined ? {} : { 'aria-pressed': item.state === 'on' })}
                  {...(item.disabled === true && item.disabledReason !== undefined
                    ? { 'aria-description': item.disabledReason }
                    : {})}
                  onClick={() => {
                    onAction(actionFor(item))
                  }}
                  onFocus={() => {
                    const i = focusable.findIndex((f) => f.id === item.id)
                    if (i >= 0) setAt(i)
                  }}
                >
                  <Glyph id={item.glyph} />
                  <span className="ctl-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
