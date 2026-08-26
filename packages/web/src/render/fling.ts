// A throw, because 48 px of keyboard will not cross a 1900 px town.

/** Total travel, in either axis, below which a gesture was a click and not a drag. The landed
 *  `scene.ts` number, moved here so the pick and the throw cannot come to different answers. */
export const TAP_SLOP_PX = 2

/** The tail of a gesture a release velocity is read from. Longer, and a flick that ended in a
 *  stop still throws; shorter, and one stuttering frame decides the whole camera. */
export const FLING_SAMPLE_MS = 80

/** Below this a release placed the camera rather than threw it. */
export const FLING_MIN_PX_PER_MS = 0.15

/** Speed halves this often. */
export const FLING_HALF_LIFE_MS = 120

/** A throw is over once it is moving less than a pixel a frame at 60 fps. */
export const FLING_STOP_PX_PER_MS = 0.05

/** The safety cut. Not the design — the natural stop is reached first at any speed a hand
 *  produces — but no arithmetic here may leave a camera drifting forever. */
export const FLING_MAX_MS = 700

export type DragSample = { x: number; y: number; t: number }

/** What one drag has done so far: whether it has left the slop, and the tail it may be thrown
 *  from. Only the tail is kept, so a gesture of any length costs the same. */
export type DragTrack = { moved: boolean; tail: readonly DragSample[]; elapsedMs: number }

export function trackDrag(prev: DragTrack | null, x: number, y: number, t: number): DragTrack {
  if (prev === null) return { moved: false, tail: [{ x, y, t }], elapsedMs: 0 }
  const first = prev.tail[0]!
  const tail = [...prev.tail, { x, y, t }].filter(
    (s, i, all) => t - s.t <= FLING_SAMPLE_MS || i === all.length - 1,
  )
  const last = prev.tail[prev.tail.length - 1]!
  return {
    // once a gesture is a drag it stays one, even if the finger comes back to where it started
    moved: prev.moved || Math.abs(x - last.x) + Math.abs(y - last.y) > TAP_SLOP_PX,
    tail,
    elapsedMs: t - first.t,
  }
}

/** A drag, not a pick. The one question `pointertap` and the fling both ask. */
export function isDrag(track: DragTrack | null): boolean {
  return track?.moved === true
}

/** A throw in flight: the speed it was let go at, decayed, and how long it has been going. */
export type Fling = { vx: number; vy: number; ms: number }

/** The velocity a gesture was let go at, or null when it was not thrown. Read from the last `FLING_SAMPLE_MS` only: a flick that ended in a deliberate stop is a placement. */
export function flingFrom(track: DragTrack | null, nowMs: number): Fling | null {
  if (!isDrag(track)) return null
  const recent = track!.tail.filter((s) => nowMs - s.t <= FLING_SAMPLE_MS)
  if (recent.length < 2) return null
  const a = recent[0]!,
    b = recent[recent.length - 1]!
  const dt = b.t - a.t
  if (dt <= 0) return null
  const vx = (b.x - a.x) / dt,
    vy = (b.y - a.y) / dt
  if (Math.hypot(vx, vy) < FLING_MIN_PX_PER_MS) return null
  return { vx, vy, ms: 0 }
}

const DECAY_PER_MS = Math.LN2 / FLING_HALF_LIFE_MS

/** One frame of the glide. The decay is INTEGRATED over the frame rather than sampled at its edge, so 30 fps and 120 fps travel the same distance; `next` is null once the throw is spent. */
export function flingStep(f: Fling, dtMs: number): { next: Fling | null; dx: number; dy: number } {
  const dt = Math.max(0, Math.min(dtMs, FLING_MAX_MS - f.ms))
  const decay = Math.exp(-DECAY_PER_MS * dt)
  // ∫ v0·e^(−kt) dt across the frame — the exact distance, not v0·dt
  const span = (1 - decay) / DECAY_PER_MS
  const next = { vx: f.vx * decay, vy: f.vy * decay, ms: f.ms + dt }
  const spent = Math.hypot(next.vx, next.vy) < FLING_STOP_PX_PER_MS || next.ms >= FLING_MAX_MS
  return { next: spent ? null : next, dx: f.vx * span, dy: f.vy * span }
}

/** What the stopping rule leaves untravelled: the decay integrated to infinity is `v / k`, so stopping at `FLING_STOP_PX_PER_MS` costs exactly this much, whatever the throw. */
export const FLING_STOP_TAIL_PX = FLING_STOP_PX_PER_MS / DECAY_PER_MS

/** How far a throw carries in total, in pixels — the number that says whether it feels right.
 *  The decay integral to the point the glide stops itself, which is `(v − v_stop) / k`. */
export function flingTravel(f: Fling): { dx: number; dy: number } {
  const speed = Math.hypot(f.vx, f.vy)
  if (speed <= FLING_STOP_PX_PER_MS) return { dx: 0, dy: 0 }
  const span = (speed - FLING_STOP_PX_PER_MS) / (DECAY_PER_MS * speed)
  return { dx: f.vx * span, dy: f.vy * span }
}
