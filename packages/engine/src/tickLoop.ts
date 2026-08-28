import { DEFAULT_CONFIG, TICK_REAL_MS, type SimConfig } from '@sj/shared'
import type { EventStore } from './eventStore.js'
import type { WorldState } from './state.js'
import { fold } from './fold.js'
import type { RngStreams } from './rng.js'

export type TickHandler = (ctx: {
  tick: number
  emit: (type: string, payload: unknown) => void
}) => void

export class TickLoop {
  #store: EventStore
  #state: WorldState
  #rng: RngStreams
  #tick: number
  #realMs: number
  #speed: number
  #snapEvery: number
  #onTick: TickHandler
  #timer: NodeJS.Timeout | null = null
  #paused = false
  #nextAt = 0
  #config: SimConfig
  #onError: ((err: unknown) => void) | undefined

  constructor(opts: {
    store: EventStore
    state: WorldState
    rng: RngStreams
    config?: SimConfig
    startTick?: number
    realMsPerTick?: number
    speed?: number
    snapshotEveryTicks?: number
    onTick: TickHandler
    onError?: (err: unknown) => void
  }) {
    this.#store = opts.store
    this.#state = opts.state
    this.#rng = opts.rng
    this.#config = opts.config ?? DEFAULT_CONFIG
    this.#tick = opts.startTick ?? opts.state.tick
    this.#realMs = opts.realMsPerTick ?? TICK_REAL_MS
    this.#speed = opts.speed ?? 1
    this.#snapEvery = opts.snapshotEveryTicks ?? 60
    this.#onTick = opts.onTick
    this.#onError = opts.onError
  }

  get state(): WorldState {
    return this.#state
  }
  get tick(): number {
    return this.#tick
  }
  get paused(): boolean {
    return this.#paused
  }
  get speed(): number {
    return this.#speed
  }

  /** The world clock stops. Nothing else does: the store, the socket and the viewer keep going,
   *  and a paused world is the same world one tick later. */
  pause(): void {
    this.#paused = true
  }
  resume(): void {
    this.#paused = false
  }
  /** Ticks per unit of real time, as a multiplier on `realMsPerTick`. A cadence the loop does
   *  not own reads `speed` itself; the loop's own timer is re-armed here. */
  setSpeed(speed: number): void {
    this.#speed = speed
    if (this.#timer !== null) {
      this.stop()
      this.start()
    }
  }

  step(): void {
    if (this.#paused) return
    const prevTick = this.#tick
    const prevState = this.#state
    const prevRng = this.#rng.snapshot()
    this.#tick += 1
    try {
      this.#doStep()
    } catch (err) {
      this.#tick = prevTick
      this.#state = prevState
      // In place: the tick handler holds this same object, so reassigning would split the two.
      this.#rng.load(prevRng)
      throw err
    }
  }

  #doStep(): void {
    this.#store.transaction(() => {
      const apply = (type: string, payload: unknown) => {
        const ev = this.#store.append(this.#tick, type, payload)
        this.#state = fold(this.#state, ev, this.#config)
      }
      apply('tick_advanced', {})
      this.#onTick({ tick: this.#tick, emit: apply })
      if (this.#tick % this.#snapEvery === 0) {
        this.#store.saveSnapshot(
          this.#tick,
          this.#store.lastSeq(),
          this.#state,
          this.#rng.snapshot(),
        )
      }
      this.#store.saveRngState(this.#tick, this.#rng.snapshot())
    })
  }

  start(): void {
    if (this.#timer) return
    this.#nextAt = Date.now() + this.#realMs / this.#speed
    const run = () => {
      try {
        this.step()
      } catch (err) {
        this.#timer = null
        if (this.#onError) {
          this.#onError(err)
          return
        }
        throw err
      }
      this.#nextAt += this.#realMs / this.#speed
      this.#timer = setTimeout(run, Math.max(0, this.#nextAt - Date.now()))
    }
    this.#timer = setTimeout(run, this.#realMs / this.#speed)
  }
  stop(): void {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
  }
}
