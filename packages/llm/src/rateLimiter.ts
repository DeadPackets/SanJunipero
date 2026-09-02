import { APICallError } from 'ai'

// OpenRouter reports a saturated back end as a 429, and on a 200-with-error-body only in words.
export function rateLimited(err: unknown): boolean {
  if (APICallError.isInstance(err) && err.statusCode === 429) return true
  const text = err instanceof Error ? err.message : String(err)
  return /\b429\b|rate[ _-]?limit|too many requests/i.test(text)
}

// A provider that asks for an hour would freeze the whole pin for an hour; the gate re-probes
// instead, and one refused probe costs nothing.
const RETRY_AFTER_CAP_MS = 60_000

/** The provider's own answer to "when may I ask again", in seconds or as an HTTP-date. */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  if (!APICallError.isInstance(err)) return undefined
  const raw = err.responseHeaders?.['retry-after']?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  const seconds = Number(raw)
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - now
  if (Number.isNaN(ms)) return undefined
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, ms))
}

/** No slot ever came free inside the caller's patience, so nothing was sent and nothing billed.
 *  Distinct from a 429 on purpose: re-asking only puts the caller back behind the same wall. */
export class RateLimitWaitError extends Error {
  constructor(
    readonly waitedMs: number,
    pin: string,
  ) {
    super(`no slot on ${pin} after ${waitedMs} ms of waiting`)
  }
}

// Wafer's per-key concurrency is not published, so 4 is where the gate starts probing from.
const DEFAULT_MAX_CONCURRENCY = 4
// The measured gap between a refused pair in the live ledger; used when the provider names none.
const DEFAULT_COOLDOWN_MS = 2_000
// Additive recovery: one clean run of this many answers buys back one slot.
const RAISE_AFTER_SUCCESSES = 5
// A minute of single file is 4 or 5 turns the fleet took in series; below that it is one burst
// the gate is already absorbing, and not news.
const PINNED_WINDOW_MS = 60_000

type Waiter = {
  resolve: () => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

/** One provider pin's admission gate: an in-flight cap the refusals themselves set, and a FIFO
 *  of callers waiting for it. AIMD — a 429 halves the cap and holds a cool-down, a run of clean
 *  answers adds one back — so the fleet finds the limit by waiting rather than by being refused. */
export class AdaptiveLimiter {
  readonly #pin: string
  readonly #ceiling: number
  #cap: number
  #inFlight = 0
  #queue: Waiter[] = []
  #coolUntil = 0
  #successRun = 0
  #pinnedSince: number | null = null
  #pinnedReported = false
  #wake: ReturnType<typeof setTimeout> | null = null

  constructor(pin: string, ceiling: number) {
    this.#pin = pin
    this.#ceiling = ceiling
    this.#cap = ceiling
  }

  state(): { cap: number; inFlight: number; queued: number } {
    return { cap: this.#cap, inFlight: this.#inFlight, queued: this.#queue.length }
  }

  /** Runs `exec` under the gate. A 429 raised while other calls of ours were in flight is one
   *  this gate can fix, so it buys the caller ONE more place in the queue behind the new
   *  cool-down; anything else goes up to the caller's own retry budget. */
  async run<T>(exec: () => Promise<T>, maxWaitMs: number): Promise<T> {
    const deadline = Date.now() + maxWaitMs
    let refusal: unknown = null
    let requeued = false
    for (;;) {
      try {
        await this.#acquire(deadline, maxWaitMs)
      } catch (err) {
        throw refusal ?? err
      }
      let ours = false
      try {
        const value = await exec()
        this.#onAnswer()
        return value
      } catch (err) {
        if (!rateLimited(err)) throw err
        ours = this.#inFlight > 1 || this.#queue.length > 0
        this.#onRefusal(retryAfterMs(err))
        refusal = err
      } finally {
        this.#release()
      }
      // A lone caller refused by a shared pool is not a concurrency fault, and a second free
      // re-ask is a retry loop: either way it goes up to the caller's own patience.
      if (!ours || requeued || Date.now() >= deadline) throw refusal
      requeued = true
    }
  }

  /** The one line worth an alert, handed over exactly once per pinned spell. */
  pinnedAlert(): string | null {
    if (this.#pinnedSince === null || this.#pinnedReported) return null
    const heldMs = Date.now() - this.#pinnedSince
    if (heldMs < PINNED_WINDOW_MS) return null
    this.#pinnedReported = true
    return (
      `${this.#pin}: one call at a time for ${Math.round(heldMs / 1_000)}s, ` +
      `${this.#queue.length} waiting — the pin is refusing everything above single file`
    )
  }

  // Everyone joins the queue, uncontended callers included: one admission rule written once,
  // and `#pump` hands the slot straight back on the same turn when there is one free.
  #acquire(deadline: number, maxWaitMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(
          () => {
            this.#queue = this.#queue.filter((w) => w !== waiter)
            this.#pump()
            reject(new RateLimitWaitError(maxWaitMs, this.#pin))
          },
          Math.max(0, deadline - Date.now()),
        ),
      }
      this.#queue.push(waiter)
      this.#pump()
    })
  }

  #release(): void {
    this.#inFlight -= 1
    this.#pump()
  }

  #pump(): void {
    if (this.#wake !== null) {
      clearTimeout(this.#wake)
      this.#wake = null
    }
    while (this.#queue.length > 0 && this.#inFlight < this.#cap) {
      const cooling = this.#coolUntil - Date.now()
      if (cooling > 0) {
        this.#wake = setTimeout(() => {
          this.#wake = null
          this.#pump()
        }, cooling)
        return
      }
      const waiter = this.#queue.shift()!
      clearTimeout(waiter.timer)
      this.#inFlight += 1
      waiter.resolve()
    }
  }

  #onAnswer(): void {
    this.#successRun += 1
    if (this.#successRun < RAISE_AFTER_SUCCESSES || this.#cap >= this.#ceiling) return
    this.#successRun = 0
    this.#setCap(this.#cap + 1)
  }

  #onRefusal(retryAfter: number | undefined): void {
    this.#successRun = 0
    this.#setCap(Math.max(1, Math.floor(this.#cap / 2)))
    this.#coolUntil = Math.max(this.#coolUntil, Date.now() + (retryAfter ?? DEFAULT_COOLDOWN_MS))
  }

  #setCap(cap: number): void {
    this.#cap = cap
    if (cap > 1) {
      this.#pinnedSince = null
      this.#pinnedReported = false
    } else this.#pinnedSince ??= Date.now()
  }
}

// One gate per provider pin, shared by every mind in the process: a per-client cap would be five
// caps and no coordination, which is the state this replaces.
const LIMITERS = new Map<string, AdaptiveLimiter>()

export function limiterFor(pin: string): AdaptiveLimiter {
  const found = LIMITERS.get(pin)
  if (found !== undefined) return found
  const asked = Number(process.env.LLM_MAX_CONCURRENCY)
  const made = new AdaptiveLimiter(
    pin,
    Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : DEFAULT_MAX_CONCURRENCY,
  )
  LIMITERS.set(pin, made)
  return made
}

/** For tests, which share one process and would otherwise inherit each other's cool-downs. */
export function resetLimiters(): void {
  LIMITERS.clear()
}
