import { DEFAULT_CONFIG, TICK_REAL_MS, type SimConfig } from '@sj/shared'
import type { EventStore } from './eventStore.js'
import type { WorldState } from './state.js'
import { fold } from './fold.js'
import type { RngStreams } from './rng.js'

export type TickHandler = (ctx: { tick: number; emit: (type: string, payload: unknown) => void }) => void

export class TickLoop {
  #store: EventStore; #state: WorldState; #rng: RngStreams
  #tick: number; #realMs: number; #speed: number; #snapEvery: number
  #onTick: TickHandler; #timer: NodeJS.Timeout | null = null; #nextAt = 0
  #config: SimConfig

  constructor(opts: { store: EventStore; state: WorldState; rng: RngStreams; config?: SimConfig; startTick?: number; realMsPerTick?: number; speed?: number; snapshotEveryTicks?: number; onTick: TickHandler }) {
    this.#store = opts.store; this.#state = opts.state; this.#rng = opts.rng
    this.#config = opts.config ?? DEFAULT_CONFIG
    this.#tick = opts.startTick ?? opts.state.tick
    this.#realMs = opts.realMsPerTick ?? TICK_REAL_MS
    this.#speed = opts.speed ?? 1
    this.#snapEvery = opts.snapshotEveryTicks ?? 60
    this.#onTick = opts.onTick
  }

  get state(): WorldState { return this.#state }
  get tick(): number { return this.#tick }

  step(): void {
    const prevTick = this.#tick
    const prevState = this.#state
    this.#tick += 1
    try {
      this.#doStep()
    } catch (err) {
      this.#tick = prevTick
      this.#state = prevState
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
        this.#store.saveSnapshot(this.#tick, this.#store.lastSeq(), this.#state, this.#rng.snapshot())
      }
      this.#store.saveRngState(this.#tick, this.#rng.snapshot())
    })
  }

  start(): void {
    if (this.#timer) return
    this.#nextAt = Date.now() + this.#realMs / this.#speed
    const run = () => {
      this.step()
      this.#nextAt += this.#realMs / this.#speed
      this.#timer = setTimeout(run, Math.max(0, this.#nextAt - Date.now()))
    }
    this.#timer = setTimeout(run, this.#realMs / this.#speed)
  }
  stop(): void { if (this.#timer) { clearTimeout(this.#timer); this.#timer = null } }
}
