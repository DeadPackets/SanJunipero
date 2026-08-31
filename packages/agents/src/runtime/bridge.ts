import { type EventStore } from '@sj/engine/store'
import {
  ambientTempAt,
  composePerception,
  groundForBuilding,
  unfinishedWork,
  type StandingWalls,
  FORAGEABLE_YIELD,
  insulationOf,
  isExposed,
  isFoodKind,
  FUEL_KIND,
  isPassable,
  loneCandidateFor,
  makeables,
  recipeTileKind,
  submitIntent,
  waterWithinReach,
  WELL_KIND,
  type TickHandler,
  type TickLoop,
  type WorldState,
} from '@sj/engine'
import type { Makeables, PerceptionPacket as EnginePerceptionPacket } from '@sj/engine'
import { isWet, isWoody, type SimConfig, type SimEvent } from '@sj/shared'
import type { KnownPlace, PerceptionPacket, SourceKind } from '../prompt/prose.js'
import { DEFAULT_MIND_CONFIG } from '../wake.js'

// A window shorter than the gap between a mind's turns makes the town half-deaf. The boredom
// floor is the longest an awake mind can go without a turn; 10% covers the tick it lands on.
export const DEFAULT_RECENT_WINDOW_TICKS = Math.ceil(DEFAULT_MIND_CONFIG.boredomTicks * 1.1)
// The turn schema keeps `verb` a free string so a novel intent can round-trip to the engine;
// the verb registry is what answers it in-world.
export type Intent = { verb: string; params: Record<string, unknown> }
export type SubmitResult = { ok: true } | { ok: false; reason: string }

type QueuedSubmit = {
  agentId: string
  intent: Intent
  onResult: ((result: SubmitResult) => void) | undefined
  resolve: (result: SubmitResult) => void
}

// A mind is told about an owner only when the thing is not its own. Names, not ids — the
// packet carries no ids to compare, and two people in one town do not share a name.
function claims(
  i: { ownerName?: string; crafterMarkName?: string; spoiling?: true },
  selfName: string,
): { ownerName?: string; crafterMarkName?: string; spoiling?: true } {
  return {
    ...(i.ownerName === undefined || i.ownerName === selfName ? {} : { ownerName: i.ownerName }),
    ...(i.crafterMarkName === undefined || i.crafterMarkName === selfName
      ? {}
      : { crafterMarkName: i.crafterMarkName }),
    ...(i.spoiling === undefined ? {} : { spoiling: i.spoiling }),
  }
}

// Reads `isExposed`'s own order forward — a roof, then what is on your back, then a fire — so
// the sentence a mind gets and the number its body loses cannot disagree.
function coldOf(
  state: WorldState,
  config: SimConfig,
  agentId: string,
): { biting: true } | { keptOffBy: 'walls' | 'coat' | 'fire' } | undefined {
  if (!config.warmth.enabled) return undefined
  const a = state.agents[agentId]
  if (!a?.alive) return undefined
  const ambient = ambientTempAt(state, config)
  if (ambient >= config.warmth.comfortBand) return undefined
  if (isExposed(state, config, agentId)) return { biting: true }
  if (a.insideId !== undefined) return { keptOffBy: 'walls' }
  if (ambient + insulationOf(state, config, agentId) >= config.warmth.comfortBand)
    return { keptOffBy: 'coat' }
  return { keptOffBy: 'fire' }
}

function reconcile(
  raw: EnginePerceptionPacket,
  self: { name: string; asleep: boolean; collapsedSinceTick: number | null } | undefined,
  cold: ReturnType<typeof coldOf>,
): PerceptionPacket {
  const selfName = self?.name ?? ''
  return {
    time: raw.time,
    self: {
      body: raw.self.body,
      x: raw.self.x,
      y: raw.self.y,
      asleep: self?.asleep ?? false,
      collapsed: (self?.collapsedSinceTick ?? null) !== null,
      activity: raw.self.activity,
      ...(raw.self.activityToward === undefined ? {} : { activityToward: raw.self.activityToward }),
      ...(raw.self.inside === undefined ? {} : { inside: raw.self.inside }),
      inventory: raw.self.inventory.map((i) => ({
        id: i.id,
        kind: i.kind,
        qty: i.qty,
        ...(i.text === undefined ? {} : { text: i.text }),
        loc: i.loc,
        ...claims(i, selfName),
      })),
    },
    weather: raw.weather,
    ...(raw.ground === undefined ? {} : { ground: raw.ground }),
    ...(raw.fumbling === undefined ? {} : { fumbling: raw.fumbling }),
    ...(raw.wayUnclear === undefined ? {} : { wayUnclear: raw.wayUnclear }),
    ...(cold === undefined ? {} : { cold }),
    light: raw.light,
    visible: {
      agents: raw.visible.agents,
      structures: raw.visible.structures,
      items: raw.visible.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        qty: i.qty,
        loc: { t: 'tile' as const, x: i.x, y: i.y },
        ...claims(i, selfName),
      })),
      crops: raw.visible.crops,
      // The engine composes both; reconcile dropped them on the floor, so no mind had ever
      // seen an animal or a berry patch.
      fauna: raw.visible.fauna,
      forageables: raw.visible.forageables,
    },
    reach: raw.reach,
    heard: raw.heard,
    seen: raw.seen,
    feltEvents: raw.feltEvents,
  }
}

export class EngineBridge {
  readonly #loop: TickLoop
  readonly #store: EventStore
  readonly #simConfig: SimConfig
  readonly #recentWindowTicks: number
  #queue: QueuedSubmit[] = []
  #announcements: { type: string; payload: Record<string, unknown> }[] = []
  #tickCallbacks: ((tick: number) => void)[] = []
  #window: SimEvent[] = []
  #lastSeq = 0

  constructor(opts: {
    loop: TickLoop
    store: EventStore
    simConfig: SimConfig
    /** Narrower than the default only; a shorter window drops what a mind never looked at. */
    recentWindowTicks?: number
  }) {
    this.#loop = opts.loop
    this.#store = opts.store
    this.#simConfig = opts.simConfig
    this.#recentWindowTicks = opts.recentWindowTicks ?? DEFAULT_RECENT_WINDOW_TICKS
  }

  // Drain announcements, then queued intents in arrival order, then run the world systems,
  // then notify per-tick subscribers. Never awaits anything: intents are pure.
  wrapTickHandler(world: TickHandler): TickHandler {
    return (ctx) => {
      // Announcements first: the runtime codifies then submits in one synchronous stretch, so
      // the other order writes "used the verb" before "the verb existed".
      const announced = this.#announcements
      this.#announcements = []
      for (const a of announced) ctx.emit(a.type, a.payload)

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

  // A fact that is already true and has no verb to ride in on. Not a promise: nothing waits on
  // an announcement, and a caller that has already changed the rulebook cannot be told "no".
  announce(type: string, payload: Record<string, unknown>): void {
    this.#announcements.push({ type, payload })
  }

  submit(
    agentId: string,
    intent: Intent,
    onResult?: (result: SubmitResult) => void,
  ): Promise<SubmitResult> {
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
      coldOf(this.#loop.state, this.#simConfig, agentId),
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

  // Whether an act that named no object has exactly one thing it could mean. Asked before the
  // decode retry, so a mind that named the verb is not made to answer for it twice (K20).
  actHasOneReading(agentId: string, verb: string): boolean {
    return loneCandidateFor(this.#loop.state, this.#simConfig, agentId, verb, {}) !== null
  }

  // The words `build` and `craft` accept. Handed over whole, because the tables behind them do
  // not change inside a run and a mind that is never given a word never uses it (C11 R-H).
  makeables(): Makeables {
    return makeables(this.#simConfig)
  }

  // Where the town has room for the next roof. Read off the engine's own claim, so the place
  // the prose names is the place `build` accepts and no other — a mind is never told two.
  groundForBuilding(): { x: number; y: number } | null {
    return groundForBuilding(this.#loop.state)
  }

  // Every place this body has ever laid eyes on or been told of, whether or not it can see one
  // now. The prose drops the ones in sight; the walls are already in front of it.
  knownPlaces(agentId: string): KnownPlace[] {
    const state = this.#loop.state
    return (state.agents[agentId]?.knownPlaces ?? []).flatMap((id) => {
      const s = state.structures[id]
      if (s === undefined) return []
      return [{ id: s.id, kind: s.kind, x: s.x, y: s.y, ...(s.name === undefined ? {} : { name: s.name }) }]
    })
  }

  // The other place work can go: free ground moves to a fresh plot the moment somebody plants
  // walls, so it alone sends every later body away from the first body's house.
  unfinishedWork(agentId: string): StandingWalls | null {
    const a = this.#loop.state.agents[agentId]
    return a === undefined ? null : unfinishedWork(this.#loop.state, this.#simConfig, a)
  }

  // Terrain is the one thing perception never projects. Both answers come from the engine's own
  // reach test, so what the prose promises is what `drink` and `fill` accept.
  waterAtHand(agentId: string): boolean {
    return waterWithinReach(this.#loop.state, agentId) !== null
  }

  // The nearest drink, counting a finished well: the town's own well is usually nearer than
  // the river, and pointing five thirsty founders eighteen tiles west is how a town dies.
  nearestWater(x: number, y: number, radius = 24): { x: number; y: number } | null {
    const state = this.#loop.state
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    const offer = (px: number, py: number): void => {
      const d = Math.abs(px - x) + Math.abs(py - y)
      if (
        d < bestD ||
        (d === bestD && best !== null && (py < best.y || (py === best.y && px < best.x)))
      ) {
        bestD = d
        best = { x: px, y: py }
      }
    }
    for (let py = y - radius; py <= y + radius; py++) {
      for (let px = x - radius; px <= x + radius; px++) {
        const tile = state.terrain[py]?.[px]
        if (tile !== undefined && isWet(tile)) offer(px, py)
      }
    }
    for (const id of Object.keys(state.structures).sort()) {
      const s = state.structures[id]!
      if (s.kind === WELL_KIND && s.stage === 'complete') offer(s.x, s.y)
    }
    return best
  }

  // Where stuff in this world can be, enumerated once: a stack on the ground, a stack on a
  // shelf, then a node still standing. Ties fall to items before nodes before ground, by id.
  #nearestYield(
    x: number,
    y: number,
    radius: number,
    wanted: (kind: string) => boolean,
  ): { x: number; y: number; kind: string; from: SourceKind } | null {
    const state = this.#loop.state
    let best: { x: number; y: number; kind: string; from: SourceKind } | null = null
    let bestD = Infinity
    const offer = (px: number, py: number, kind: string, from: SourceKind): void => {
      const d = Math.abs(px - x) + Math.abs(py - y)
      if (d > radius || d >= bestD) return
      bestD = d
      best = { x: px, y: py, kind, from }
    }
    for (const id of Object.keys(state.items).sort()) {
      const item = state.items[id]!
      if (!wanted(item.kind)) continue
      if (item.loc.t === 'tile') offer(item.loc.x, item.loc.y, item.kind, 'stack')
      else if (item.loc.t === 'structure') {
        const st = state.structures[item.loc.id]
        if (st !== undefined) offer(st.x, st.y, item.kind, 'stack')
      }
    }
    for (const id of Object.keys(state.forageables ?? {}).sort()) {
      const node = state.forageables![id]!
      if (node.stock <= 0) continue
      const kind = FORAGEABLE_YIELD[node.kind]
      if (!wanted(kind)) continue
      offer(node.x, node.y, kind, node.kind)
    }
    // Wood is the one material that is neither item nor node until somebody fells it. The box
    // shrinks to the best distance so far, so a settled town scans a few paces, not the horizon.
    if (wanted(FUEL_KIND)) {
      const box = Math.min(radius, bestD)
      for (let py = y - box; py <= y + box; py++) {
        const row = state.terrain[py]
        if (row === undefined) continue
        for (let px = x - box; px <= x + box; px++) {
          const tile = row[px]
          if (tile !== undefined && isWoody(tile)) offer(px, py, FUEL_KIND, 'tree')
        }
      }
    }
    return best
  }

  // The nearest thing worth walking to for a meal. Kind and place only: the mark is still
  // earned by going and looking, as `nearestWater` names a bank and never a well's id.
  nearestFood(x: number, y: number, radius = 24): { x: number; y: number; kind: string } | null {
    const hit = this.#nearestYield(x, y, radius, (k) => isFoodKind(this.#simConfig, k))
    return hit === null ? null : { x: hit.x, y: hit.y, kind: hit.kind }
  }

  // The road loneliness never had. Names and places only, as `nearestFood` names a kind and
  // never a mark; ties fall to the lowest id so two bodies equally far stay deterministic.
  nearestPerson(
    agentId: string,
    x: number,
    y: number,
    radius = 24,
  ): { x: number; y: number; name: string } | null {
    const state = this.#loop.state
    let best: { x: number; y: number; name: string } | null = null
    let bestD = Infinity
    for (const id of Object.keys(state.agents).sort()) {
      if (id === agentId) continue
      const a = state.agents[id]!
      if (!a.alive) continue
      const d = Math.abs(a.x - x) + Math.abs(a.y - y)
      if (d > radius || d >= bestD) continue
      bestD = d
      best = { x: a.x, y: a.y, name: a.name }
    }
    return best
  }

  // Where the missing material stands, in the same terms `take`, `forage` and `chop` accept.
  // A deficit with no place to go is a want with no road, which is worse than no want at all.
  nearestSource(
    kind: string,
    x: number,
    y: number,
    radius = 24,
  ): { x: number; y: number; from: SourceKind } | null {
    const hit = this.#nearestYield(x, y, radius, (k) => k === kind)
    return hit === null ? null : { x: hit.x, y: hit.y, from: hit.from }
  }

  // `isExposed`'s own test, asked of an hour the world has not reached yet — same band, same
  // coat, same comfort line — so a mind in a garment is never sent for wood it does not need.
  nightWillBeCold(agentId: string): boolean {
    const cfg = this.#simConfig
    if (!cfg.warmth.enabled) return false
    const state = this.#loop.state
    return (
      ambientTempAt(state, cfg, 'night') + insulationOf(state, cfg, agentId) <
      cfg.warmth.comfortBand
    )
  }

  // The ground within sight in the words a recipe may ask for, silent about tiles the recipe
  // vocabulary has no word for. The arbiter has to be able to see the river it rules on.
  groundKinds(agentId: string): string[] {
    const state = this.#loop.state
    const a = state.agents[agentId]
    if (a === undefined) return []
    const radius = this.#simConfig.movement.sightRadius
    const kinds = new Set<string>()
    for (let y = a.y - radius; y <= a.y + radius; y++) {
      for (let x = a.x - radius; x <= a.x + radius; x++) {
        const tile = state.terrain[y]?.[x]
        if (tile === undefined) continue
        const kind = recipeTileKind(tile)
        if (kind !== null) kinds.add(kind)
      }
    }
    return [...kinds].sort()
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
