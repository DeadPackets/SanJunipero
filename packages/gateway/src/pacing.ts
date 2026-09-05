import { MAX_SPEED, MIN_SPEED, type Clock } from './adminOps.js'

// ★ AN UNWATCHED TOWN STILL BILLS: minds only spend when the loop steps. This turns the
// operator's own dial down when the last viewer leaves and back up the instant one arrives —
// the same `setSpeed` POST /admin/speed drives, so there are never two hands on one clock.

/** Five minutes of nobody. Long enough that a viewer reloading the page never trips it. */
export const DEFAULT_IDLE_AFTER_MS = 300_000
/** A tenth: the floor the operator's own dial accepts, and a town still visibly alive. Three
 *  sim-days pass in an unwatched real day, a quarter of the bill the old 0.25 ran up (owner,
 *  2026-09-05). Not a pause — the event log must have no gap for the chronicler to read back. */
export const DEFAULT_IDLE_SPEED = 0.1

/** Speed only. Pacing never pauses a town, so `/admin/pause` is never its business. */
export type PacingOpts = {
  clock: Pick<Clock, 'speed' | 'setSpeed'>
  env?: NodeJS.ProcessEnv
}

export type Pacing = {
  /** Called with the live count as a viewer joins and as one leaves — never polled. */
  viewers(count: number): void
  /** Called once a tick with whether every living body in town is asleep. A sleeping town
   *  runs faster, watched or not, until the first one rises (owner, 2026-09-05): nobody turns
   *  while asleep, so the hours cost nothing and only take time. */
  night(allAsleep: boolean): void
  stop(): void
}

/** Four times whatever the town would otherwise run at, capped at the operator's own ceiling. */
export const DEFAULT_NIGHT_FACTOR = 4

const noop = (): void => undefined

const numEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number => {
  const raw = env[name]
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (Number.isFinite(n) && n >= min && n <= max) return n
  console.error(`pacing: ${name}=${raw} ignored; using ${fallback}`)
  return fallback
}

export function createPacing(opts: PacingOpts): Pacing {
  const env = opts.env ?? process.env
  // Rehearsals and probes measure the town at one speed; a clock that moves under them is a
  // measurement of nothing. Off means off — no timer, no transition, no log line.
  if (env.SJ_IDLE_PACING === '0') return { viewers: noop, night: noop, stop: noop }
  const afterMs = numEnv(env, 'SJ_IDLE_AFTER_MS', DEFAULT_IDLE_AFTER_MS, 1)
  // Bounded by what the operator's own endpoint accepts: pacing must never put the clock
  // somewhere a person could not have put it by hand.
  const idleSpeed = numEnv(env, 'SJ_IDLE_SPEED', DEFAULT_IDLE_SPEED, MIN_SPEED, MAX_SPEED)
  const nightFactor = numEnv(env, 'SJ_NIGHT_FACTOR', DEFAULT_NIGHT_FACTOR, 1, MAX_SPEED)
  let timer: ReturnType<typeof setTimeout> | null = null
  // ★ THE OWNER'S HAND WINS: pacing owns one full speed — the one the town started at — and
  // a dial reading anything pacing did not write means an operator moved it; leave it alone.
  const full = opts.clock.speed
  let idled = false
  let night = false
  // What pacing itself last wrote. The dial reading anything else is a hand pacing must not
  // fight; it re-takes the dial only once the reading is its own again.
  let wrote = full
  const target = (): number =>
    Math.min(MAX_SPEED, (idled ? idleSpeed : full) * (night ? nightFactor : 1))
  const apply = (why: string): void => {
    const now = opts.clock.speed
    if (now !== wrote) return
    const next = target()
    if (next === now) return
    wrote = next
    opts.clock.setSpeed(next)
    console.error(`pacing: ${why}, speed ${now} -> ${next}`)
  }
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const goIdle = (): void => {
    timer = null
    if (idled) return
    idled = true
    apply(`idle after ${Math.round(afterMs / 1000)}s`)
  }
  return {
    viewers(count: number): void {
      if (count <= 0) {
        // Unref'd: a town counting down to idle must never be what keeps the process alive.
        timer ??= setTimeout(goIdle, afterMs).unref()
        return
      }
      cancel()
      if (!idled) return
      idled = false
      apply('viewer connected')
    },
    night(allAsleep: boolean): void {
      if (allAsleep === night) return
      night = allAsleep
      apply(allAsleep ? 'the town sleeps' : 'somebody is up')
    },
    stop: cancel,
  }
}
