// One number the whole town reads — the smoke's drift, the tree crowns, the rain and snow's
// `vx`. Two slow sines with no common period, so it never visibly repeats.

/** The wind at `t` seconds, in [-1, 1]: positive blows toward screen +x. */
export function wind(tSeconds: number): number {
  return (
    0.6 * Math.sin(2 * Math.PI * 0.07 * tSeconds) + 0.4 * Math.sin(2 * Math.PI * 0.017 * tSeconds)
  )
}

let clockMs = 0

/** The one clock the wind runs on. StageMount advances it once a frame, before any reader. */
export function advanceWind(dtMs: number): void {
  clockMs += dtMs
}

export function windNow(): number {
  return wind(clockMs / 1000)
}

/** In whole pixels: an offset of the crown rows, never a skew, so a NEAREST canopy is moved
 *  and not resampled. `phase` keeps two trees apart. */
export function crownOffsetPx(w: number, phase: number): number {
  return Math.round(w * 1.4 + Math.sin(phase))
}
