export const PLAY_SPEEDS = [1, 2, 4, 8] as const
export type PlaySpeed = typeof PLAY_SPEEDS[number]

// At 1×, one sim minute every half second of real time — slow enough to read a street.
export const MOMENT_STEP_MS = 500

// accMs is the part-step left over from the last frame. It is what makes this a pure
// accumulator rather than a clock: a 60fps loop hands over ~16ms at a time, and without a
// remainder every frame would floor to zero and playback would never move at all. Nothing
// here reads performance.now(), so the same run of frames always lands in the same place.
export type PlayerState = {
  status: 'idle' | 'playing' | 'paused'
  tick: number
  speed: PlaySpeed
  accMs: number
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export function idlePlayer(startTick: number, speed: PlaySpeed = 1): PlayerState {
  return { status: 'idle', tick: startTick, speed, accMs: 0 }
}

export function tickPlayer(prev: PlayerState, deltaMs: number, startTick: number, endTick: number): PlayerState {
  if (prev.status !== 'playing') return prev
  const acc = prev.accMs + Math.max(0, deltaMs)
  const steps = Math.floor(acc / MOMENT_STEP_MS)
  const accMs = acc - steps * MOMENT_STEP_MS
  const tick = clamp(prev.tick + steps * prev.speed, startTick, endTick)
  // Reaching the last minute ends the playback rather than looping it: a recorded day is a
  // thing that happened once.
  if (tick >= endTick) return { status: 'idle', tick: endTick, speed: prev.speed, accMs: 0 }
  return { status: 'playing', tick, speed: prev.speed, accMs }
}

export function seekPlayer(prev: PlayerState, frac: number, startTick: number, endTick: number): PlayerState {
  const f = clamp(frac, 0, 1)
  return {
    status: prev.status,
    tick: startTick + Math.round(f * (endTick - startTick)),
    speed: prev.speed,
    accMs: 0, // a drag is a new place, not a continuation of the old part-step
  }
}

export function playPlayer(prev: PlayerState, startTick?: number, endTick?: number): PlayerState {
  // Pressing play at the end of a finished moment starts it again from the top.
  const restart = endTick !== undefined && startTick !== undefined && prev.tick >= endTick
  return { status: 'playing', tick: restart ? startTick : prev.tick, speed: prev.speed, accMs: 0 }
}

export function pausePlayer(prev: PlayerState): PlayerState {
  return { ...prev, status: 'paused' }
}

export function nextPlaySpeed(speed: PlaySpeed): PlaySpeed {
  return PLAY_SPEEDS[(PLAY_SPEEDS.indexOf(speed) + 1) % PLAY_SPEEDS.length]!
}
