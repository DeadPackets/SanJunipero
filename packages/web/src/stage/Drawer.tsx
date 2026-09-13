import { useRef, useState, type ReactNode } from 'react'
import { flingFrom, isDrag, trackDrag, type DragTrack } from '../render/fling.js'
import { gripDismiss } from '../paper/pageModel.js'

// Below 1000px the beat card, the shot board and the rail have nowhere to stand and the sheet
// took them off the screen. One drawer is their room, and above 1000px it is not there at all.

/** The handle's name. It is never drawn: the bar is 36x4 and says nothing. */
export const DRAWER_LABEL = 'Everything else'

/** ★ Which way a throw on the handle points, or null when it was neither. The sheet's own
 *  thresholds, so the drawer and the paper read a hand the same way in both directions. */
export function drawerThrow(downPx: number, vyPxMs: number): boolean | null {
  if (!gripDismiss(Math.abs(downPx), Math.abs(vyPxMs))) return null
  return downPx < 0
}

/** ★ THE PHONE DRAWER. Above 1000px it is `display: contents` and its children are grid items
 *  of the frame, mounted once and placed by their own areas. Below it, they are its sheet. */
export function Drawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const drag = useRef<{ from: number; track: DragTrack } | null>(null)
  const swiped = useRef(false)

  return (
    <>
      <div
        className="town-dim drawer-scrim"
        data-open={open ? 'yes' : 'no'}
        aria-hidden="true"
        onClick={() => {
          setOpen(false)
        }}
      />
      <div className="drawer-sheet" id="drawer" data-open={open ? 'yes' : 'no'}>
        <div className="drawer-body">{children}</div>
      </div>
      <button
        type="button"
        className="drawer-handle at-watch"
        aria-controls="drawer"
        aria-expanded={open}
        aria-label={DRAWER_LABEL}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { from: e.clientY, track: trackDrag(null, 0, e.clientY, e.timeStamp) }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d === null) return
          d.track = trackDrag(d.track, 0, e.clientY, e.timeStamp)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d === null) return
          const track = trackDrag(d.track, 0, e.clientY, e.timeStamp)
          swiped.current = isDrag(track)
          const way = drawerThrow(e.clientY - d.from, flingFrom(track, e.timeStamp)?.vy ?? 0)
          if (way !== null) setOpen(way)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        // A drag ends in a click as well, and the tap would put back what the throw just did.
        onClick={() => {
          if (swiped.current) swiped.current = false
          else setOpen((v) => !v)
        }}
      >
        <span className="drawer-bar" aria-hidden="true" />
      </button>
    </>
  )
}
