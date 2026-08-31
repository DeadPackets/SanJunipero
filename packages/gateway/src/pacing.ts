import { MAX_SPEED, MIN_SPEED, type Clock } from './adminOps.js'

// ★ AN UNWATCHED TOWN STILL BILLS. Minds only spend when the loop steps, so a stream nobody has
// opened in hours pays full price for a performance with no audience. This turns the operator's
// own dial down when the last viewer leaves and back up the instant one arrives — the same
// `setSpeed` POST /admin/speed drives, so there are never two hands on one clock.

/** Five minutes of nobody. Long enough that a viewer reloading the page never trips it. */
export const DEFAULT_IDLE_AFTER_MS = 300_000
/** Quarter speed: a quarter of the turns per wall-clock hour, and a town still visibly alive.
 *  Not a pause — the event log must have no gap for the chronicler to read back. */
export const DEFAULT_IDLE_SPEED = 0.25

/** Speed only. Pacing never pauses a town, so `/admin/pause` is never its business. */
export type PacingOpts = {
  clock: Pick<Clock, 'speed' | 'setSpeed'>
  env?: NodeJS.ProcessEnv
}

export type Pacing = {
  /** Called with the live count as a viewer joins and as one leaves — never polled. */
  viewers(count: number): void
  stop(): void
}

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
  if (env.SJ_IDLE_PACING === '0') return { viewers: noop, stop: noop }

  const afterMs = numEnv(env, 'SJ_IDLE_AFTER_MS', DEFAULT_IDLE_AFTER_MS, 1)
  // Bounded by what the operator's own endpoint accepts: pacing must never put the clock
  // somewhere a person could not have put it by hand.
  const idleSpeed = numEnv(env, 'SJ_IDLE_SPEED', DEFAULT_IDLE_SPEED, MIN_SPEED, MAX_SPEED)

  let timer: ReturnType<typeof setTimeout> | null = null
  // ★ THE OWNER'S HAND WINS. Pacing owns exactly one full speed — the one the town started at.
  // A dial reading anything pacing did not itself write means an operator moved it, and pacing
  // leaves that transition alone.
  const full = opts.clock.speed
  let idled = false

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const goIdle = (): void => {
    timer = null
    const now = opts.clock.speed
    if (idled || now !== full || now === idleSpeed) return
    idled = true
    opts.clock.setSpeed(idleSpeed)
    console.error(`pacing: idle after ${Math.round(afterMs / 1000)}s, speed ${now} -> ${idleSpeed}`)
  }

  return {
    viewers(count: number): void {
      if (count <= 0) {
        // Unref'd: a town counting down to idle must never be what keeps the process alive.
        timer ??= setTimeout(goIdle, afterMs).unref()
        return
      }
      cancel()
      if (!idled || opts.clock.speed !== idleSpeed) return
      idled = false
      opts.clock.setSpeed(full)
      console.error(`pacing: viewer connected, speed -> ${full}`)
    },
    stop: cancel,
  }
}
