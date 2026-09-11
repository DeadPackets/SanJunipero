/** THE LAW: 4.0 ms for the whole post chain at 1440p. A frame that runs a whole budget past
 *  60 Hz is a frame the chain cannot afford, whatever else is in it. */
export const POST_BUDGET_MS = 4

/** The chain reads the frame the viewer is actually getting: a WebGL context hands back no
 *  per-pass time without a timer query, and the frame is the number the eye is judging. */
export const FRAME_TARGET_MS = 1000 / 60

/** ★ THE DROP ORDER. Over budget, the chain sheds left to right. The grade and the shadows are
 *  not in this list at any point and there is no rung that reaches them. */
export const DROP_ORDER = ['attention', 'bloomRadius', 'bloom', 'sun'] as const
export type PassName = (typeof DROP_ORDER)[number]

/** ★ Clear weigh-ins before a shed pass comes back. A display capped at its own refresh reports
 *  the same 16.7 ms whether it has headroom or none, so only TIME can say the frame is healthy. */
export const RECOVER_WEIGH_INS = 10

/** Where the chain stands: how far down the ladder, and how long the frame has been clear. */
export type Rungs = { rung: number; calm: number }

/** The passes shed at this rung, in the order they went. */
export function dropped(rung: number): PassName[] {
  return DROP_ORDER.slice(0, Math.min(Math.max(rung, 0), DROP_ORDER.length))
}

/** Every rung's own switch. Keyed by `PassName`, so a rung cannot join the ladder without a
 *  switch that sheds it. */
export type PassSwitches = Record<PassName, (on: boolean) => void>

/** Turn every pass on or off for this rung. The one place the ladder reaches the picture. */
export function applyRungs(rung: number, on: PassSwitches): void {
  const off = new Set<PassName>(dropped(rung))
  for (const name of DROP_ORDER) on[name](!off.has(name))
}

/** One weigh-in. A late frame sheds a pass immediately and resets the clock, and the chain
 *  takes one back only after the frame has been clear for a whole recovery. */
export function weigh(at: Rungs, frameMs: number): Rungs {
  const rung = Math.min(Math.max(at.rung, 0), DROP_ORDER.length)
  if (frameMs > FRAME_TARGET_MS + POST_BUDGET_MS)
    return { rung: Math.min(rung + 1, DROP_ORDER.length), calm: 0 }
  const calm = at.calm + 1
  if (rung === 0 || calm < RECOVER_WEIGH_INS) return { rung, calm }
  return { rung: rung - 1, calm: 0 }
}
