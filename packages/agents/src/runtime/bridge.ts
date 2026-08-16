import {
  composePerception,
  isFoodKind,
  isPassable,
  submitIntent,
  type EventStore,
  type TickHandler,
  type TickLoop,
} from '@sj/engine'
import type { PerceptionPacket as EnginePerceptionPacket } from '@sj/engine'
import type { SimConfig, SimEvent } from '@sj/shared'
import type { PerceptionPacket } from '../prompt/prose.js'
// The agents-local intent shape. The turn schema keeps `verb` a free string so a
// novel intent can round-trip to the engine; the FROZEN submitIntent call just
// forwards it and the verb registry answers in-world.
export type Intent = { verb: string; params: Record<string, unknown> }
export type SubmitResult = { ok: true } | { ok: false; reason: string }

type QueuedSubmit = {
  agentId: string
  intent: Intent
  onResult?: (result: SubmitResult) => void
  resolve: (result: SubmitResult) => void
}

// reconcile maps the engine's PerceptionPacket onto the agents-local mirror in
// prose.ts. The engine ships `self` without asleep/collapsed booleans and
// visible.items with flat x/y; prose.ts expects self.asleep/self.collapsed and
// tile-located items. Perception remains a pure projection either way.
function reconcile(
  raw: EnginePerceptionPacket,
  self: { asleep: boolean; collapsedSinceTick: number | null } | undefined,
): PerceptionPacket {
  return {
    time: raw.time,
    self: {
      body: raw.self.body,
      x: raw.self.x,
      y: raw.self.y,
      asleep: self?.asleep ?? false,
      collapsed: (self?.collapsedSinceTick ?? null) !== null,
      activity: raw.self.activity,
      inventory: raw.self.inventory,
    },
    weather: raw.weather,
    visible: {
      agents: raw.visible.agents,
      structures: raw.visible.structures,
      items: raw.visible.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        qty: i.qty,
        loc: { t: 'tile' as const, x: i.x, y: i.y },
      })),
      crops: raw.visible.crops,
    },
    heard: raw.heard,
    feltEvents: raw.feltEvents,
  }
}

export class EngineBridge {
  readonly #loop: TickLoop
  readonly #store: EventStore
  readonly #simConfig: SimConfig
  readonly #recentWindowTicks: number
  #queue: QueuedSubmit[] = []
  #tickCallbacks: Array<(tick: number) => void> = []
  #window: SimEvent[] = []
  #lastSeq = 0

  constructor(opts: {
    loop: TickLoop
    store: EventStore
    simConfig: SimConfig
    recentWindowTicks?: number
  }) {
    this.#loop = opts.loop
    this.#store = opts.store
    this.#simConfig = opts.simConfig
    this.#recentWindowTicks = opts.recentWindowTicks ?? 10
  }

  // Drain queued intents in arrival order, then run the world systems, then
  // notify per-tick subscribers. Never awaits anything: intents are pure.
  wrapTickHandler(world: TickHandler): TickHandler {
    return (ctx) => {
      const queue = this.#queue
      this.#queue = []
      for (const item of queue) {
        const result = submitIntent(
          this.#loop.state,
          this.#simConfig,
          item.agentId,
          item.intent.verb,
          item.intent.params,
        )
        if (result.ok) {
          for (const event of result.events) ctx.emit(event.type, event.payload)
          item.onResult?.({ ok: true })
          item.resolve({ ok: true })
        } else {
          item.onResult?.({ ok: false, reason: result.reason })
          item.resolve({ ok: false, reason: result.reason })
        }
      }
      world(ctx)
      for (const cb of this.#tickCallbacks) cb(ctx.tick)
    }
  }

  submit(agentId: string, intent: Intent, onResult?: (result: SubmitResult) => void): Promise<SubmitResult> {
    return new Promise<SubmitResult>((resolve) => {
      this.#queue.push({ agentId, intent, onResult, resolve })
    })
  }

  // Shutdown: a queued intent whose loop will never step again leaves its mind
  // awaiting a promise nobody will settle. Refuse them all, in world words.
  drain(reason = 'the moment passes'): number {
    const queue = this.#queue
    this.#queue = []
    for (const item of queue) {
      item.onResult?.({ ok: false, reason })
      item.resolve({ ok: false, reason })
    }
    return queue.length
  }

  perception(agentId: string): PerceptionPacket {
    return reconcile(
      composePerception(this.#loop.state, this.#simConfig, agentId, this.#recentEvents()),
      this.#loop.state.agents[agentId],
    )
  }

  // World answers for perception prose: open ground and food kinds, straight
  // from the engine's own path and verb semantics.
  isWalkable(x: number, y: number): boolean {
    return isPassable(this.#loop.state, x, y)
  }

  isEdible(kind: string): boolean {
    return isFoodKind(this.#simConfig, kind)
  }

  // Body facts perception does not carry, for the arbiter seam: who is asking
  // and what their hands already know. Read-only; skills are copied out.
  agentFacts(agentId: string): { name: string; skills: Record<string, number> } | null {
    const body = this.#loop.state.agents[agentId]
    return body === undefined ? null : { name: body.name, skills: { ...body.skills } }
  }

  onTick(cb: (tick: number) => void): void {
    this.#tickCallbacks.push(cb)
  }

  currentTick(): number {
    return this.#loop.tick
  }

  #recentEvents(): SimEvent[] {
    const cutoff = this.#loop.tick - this.#recentWindowTicks
    const fresh = this.#store.readFrom(this.#lastSeq)
    this.#lastSeq = this.#store.lastSeq()
    if (fresh.length > 0) this.#window.push(...fresh)
    this.#window = this.#window.filter((ev) => ev.tick > cutoff)
    return this.#window
  }
}
