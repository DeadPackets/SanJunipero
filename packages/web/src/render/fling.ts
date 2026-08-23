// A THROW, BECAUSE 48 PX OF KEYBOARD WILL NOT CROSS A 1900 PX TOWN.
//
// Drag-to-pan already existed. What it had no answer for was DISTANCE: the town now grows
// without bound, and forty presses of an arrow key is not a camera control. A throw carries.
//
// ★ IT SHARES A POINTER WITH TWO OTHER GESTURES AND MUST FIGHT NEITHER.
//
// A TAP is a tile pick. The landed drag already told the two apart by `TAP_SLOP_PX` of total
// travel, and the fling asks the SAME question of the SAME tracker — so there is no second
// threshold that could disagree with the first, and a click can never become a throw.
//
// A WHEEL is a zoom that pins the world point under the cursor. A camera still gliding while
// that anchor is captured would tear the point out from under it, which is the class of defect
// `WHEEL_GESTURE_GAP_MS` and `WHEEL_MIN_DELTA` already exist because of. So a zoom does not
// compose with a glide; it ends it. Same for a keyboard pan, a fit, a recentre and a follow:
// anything that says where the camera should be outranks something still deciding.
//
// ★ WHERE THIS SITS AGAINST THE 150–300 MS MOTION BAND, SAID OUT LOUD RATHER THAN BY OMISSION.
//
// A glide runs longer than 300 ms and it is meant to. The band governs a TRANSITION — a panel
// arriving, a hover answering — where the duration is the product's opinion about how long a
// viewer should wait. A glide is not that. It is the continuation of a movement the viewer
// made with their own hand, and its length is their throw, not our taste. `ambient` is already
// exempt on exactly this ground: it is not a response to an input. This is the mirror case —
// it is nothing BUT the input, still arriving.
//
// So the numbers are chosen from feel and stated: 120 ms half-life, and a throw stops when it
// is moving slower than one pixel a frame, which is under the eye's notice. At 4 px/ms — a
// hard flick — that carries 682 px, so three throws cross the 1904 px town three rings out.
// FLING_MAX_MS is a safety cut, not the design: the natural stop beats it at any speed a hand
// produces, and it exists so no arithmetic can leave a camera drifting forever.

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
  const tail = [...prev.tail, { x, y, t }].filter((s, i, all) => t - s.t <= FLING_SAMPLE_MS || i === all.length - 1)
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
  return track !== null && track.moved
}

/** A throw in flight: the speed it was let go at, decayed, and how long it has been going. */
export type Fling = { vx: number; vy: number; ms: number }

/**
 * The velocity a gesture was let go at, or null when it was not thrown. Read from the last
 * `FLING_SAMPLE_MS` only: a flick that ended in a deliberate stop is a placement, and its
 * AVERAGE speed would say otherwise.
 */
export function flingFrom(track: DragTrack | null, nowMs: number): Fling | null {
  if (!isDrag(track)) return null
  const recent = track!.tail.filter((s) => nowMs - s.t <= FLING_SAMPLE_MS)
  if (recent.length < 2) return null
  const a = recent[0]!, b = recent[recent.length - 1]!
  const dt = b.t - a.t
  if (dt <= 0) return null
  const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt
  if (Math.hypot(vx, vy) < FLING_MIN_PX_PER_MS) return null
  return { vx, vy, ms: 0 }
}

const DECAY_PER_MS = Math.LN2 / FLING_HALF_LIFE_MS

/**
 * One frame of the glide. Exponential decay, INTEGRATED over the frame rather than sampled at
 * its edge, so 30 fps and 120 fps travel the same distance. `next` is null once the throw is
 * spent — the caller stops asking rather than watching a number approach zero forever.
 */
export function flingStep(f: Fling, dtMs: number): { next: Fling | null; dx: number; dy: number } {
  const dt = Math.max(0, Math.min(dtMs, FLING_MAX_MS - f.ms))
  const decay = Math.exp(-DECAY_PER_MS * dt)
  // ∫ v0·e^(−kt) dt across the frame — the exact distance, not v0·dt
  const span = (1 - decay) / DECAY_PER_MS
  const next = { vx: f.vx * decay, vy: f.vy * decay, ms: f.ms + dt }
  const spent = Math.hypot(next.vx, next.vy) < FLING_STOP_PX_PER_MS || next.ms >= FLING_MAX_MS
  return { next: spent ? null : next, dx: f.vx * span, dy: f.vy * span }
}

/**
 * The tail a stopping rule costs. Integrating the decay to infinity gives `v / k`; stopping at
 * `FLING_STOP_PX_PER_MS` leaves exactly this much untravelled, whatever the throw. It is under
 * nine pixels, it is the same for every gesture, and it is the tolerance any two ways of
 * measuring a glide agree to.
 */
export const FLING_STOP_TAIL_PX = FLING_STOP_PX_PER_MS / DECAY_PER_MS

/** How far a throw carries in total, in pixels — the number that says whether it feels right.
 *  The decay integral to the point the glide stops itself, which is `(v − v_stop) / k`. */
export function flingTravel(f: Fling): { dx: number; dy: number } {
  const speed = Math.hypot(f.vx, f.vy)
  if (speed <= FLING_STOP_PX_PER_MS) return { dx: 0, dy: 0 }
  const span = (speed - FLING_STOP_PX_PER_MS) / (DECAY_PER_MS * speed)
  return { dx: f.vx * span, dy: f.vy * span }
}
