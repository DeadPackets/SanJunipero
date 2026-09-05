import { type EventStore } from '@sj/engine/store'
import {
  AgentArrived,
  ambientTempAt,
  composePerception,
  effectiveConfig,
  headcount,
  mintId,
  roadRimOf,
  spoilageFor,
  groundForBuilding,
  hears,
  townSquareOf,
  unfinishedWork,
  type StandingWalls,
  FORAGEABLE_YIELD,
  insulationOf,
  isExposed,
  isFoodKind,
  FUEL_KIND,
  isPassable,
  LAWS_SHOWN,
  loneCandidateFor,
  distantWater,
  makeables,
  naturalPlaces,
  placeName,
  recipeTileKind,
  SQUARE_RADIUS,
  standingLaws,
  tabledLaws,
  type TabledLaw,
  submitIntent,
  waterWithinReach,
  WELL_KIND,
  type TickHandler,
  type TickLoop,
  type WorldState,
} from '@sj/engine'
import type { Law, Makeables, PerceptionPacket as EnginePerceptionPacket } from '@sj/engine'
import {
  isWet,
  isWoody,
  MINUTES_PER_DAY,
  PRESENCE_EVENT_TYPES,
  RELATIONSHIP_EVENT_TYPES,
  type SimConfig,
  type SimEvent,
  weekdayFromTick,
} from '@sj/shared'
import type { KnownPlace, PerceptionPacket, SourceKind } from '../prompt/prose.js'
import { DEFAULT_MIND_CONFIG } from '../wake.js'

// How far off a body still picks water out of the middle distance.
const WATER_VISTA_RADIUS = 40

// A window shorter than the gap between a mind's turns makes the town half-deaf. The boredom
// floor is the longest an awake mind can go without a turn; 10% covers the tick it lands on.
export const DEFAULT_RECENT_WINDOW_TICKS = Math.ceil(DEFAULT_MIND_CONFIG.boredomTicks * 1.1)
// The turn schema keeps `verb` a free string so a novel intent can round-trip to the engine;
// the verb registry is what answers it in-world.
export type Intent = { verb: string; params: Record<string, unknown> }
export type SubmitResult = { ok: true } | { ok: false; reason: string }

export const ROLLED_BACK = 'nothing came of the moment'

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
      ...(raw.self.doorstep === undefined ? {} : { doorstep: raw.self.doorstep }),
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
    ...(raw.atRim === undefined ? {} : { atRim: raw.atRim }),
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
    stores: raw.stores,
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
  #windowTick: number | null = null
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
    // Resume at the window's edge: a restart must not read the whole log to throw it away.
    this.#lastSeq = opts.store.lastSeqThroughTick(opts.loop.tick - this.#recentWindowTicks)
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
      // A promise cannot be un-resolved, and the tick rolls back on a throw — so nothing is
      // settled until the transaction that made it true has committed.
      const settled: [QueuedSubmit, SubmitResult][] = []
      try {
        for (const item of queue) {
          const result = submitIntent(
            this.#loop.state,
            this.#simConfig,
            item.agentId,
            item.intent.verb,
            item.intent.params,
          )
          if (result.ok) for (const event of result.events) ctx.emit(event.type, event.payload)
          settled.push([item, result.ok ? { ok: true } : { ok: false, reason: result.reason }])
        }
        world(ctx)
      } catch (err) {
        this.#announcements.unshift(...announced)
        for (const item of queue) this.#tell(item, { ok: false, reason: ROLLED_BACK })
        throw err
      }
      for (const [item, result] of settled) this.#tell(item, result)
      for (const cb of this.#tickCallbacks) cb(ctx.tick)
    }
  }

  #tell(item: QueuedSubmit, result: SubmitResult): void {
    item.onResult?.(result)
    item.resolve(result)
  }

  // A fact that is already true and has no verb to ride in on. Not a promise: nothing waits on
  // an announcement, and a caller that has already changed the rulebook cannot be told "no".
  announce(type: string, payload: Record<string, unknown>): void {
    this.#announcements.push({ type, payload })
  }

  /** Who would hear this body speak from where it stands, itself excluded. The scene's own
   *  membership test, so the ear that opens a scene and the ear that leaves one read one rule. */
  earshot(agentId: string): string[] {
    const state = this.#loop.state
    const speaker = state.agents[agentId]
    if (speaker?.alive !== true) return []
    const spoken = {
      x: speaker.x,
      y: speaker.y,
      ...(speaker.insideId === undefined ? {} : { insideId: speaker.insideId }),
    }
    return Object.keys(state.agents)
      .sort()
      .filter((id) => id !== agentId && state.agents[id]!.alive)
      .filter((id) => hears(state, this.#simConfig, spoken, id))
  }

  /** The closest of these bodies to this one, by the block distance the rest of the world
   *  measures with. Ties by id, so two people equally near never decide it differently twice. */
  nearestOf(agentId: string, candidates: readonly string[]): string | null {
    const state = this.#loop.state
    const self = state.agents[agentId]
    if (self === undefined) return null
    let best: string | null = null
    let bestD = Infinity
    for (const id of [...candidates].sort()) {
      const other = state.agents[id]
      if (other === undefined) continue
      const d = Math.abs(other.x - self.x) + Math.abs(other.y - self.y)
      if (d >= bestD) continue
      bestD = d
      best = id
    }
    return best
  }

  /** Everyone who has sung, danced or mourned on the plaza inside the recent window. A crowd
   *  the town can see is what turns two people talking into a gathering. */
  expressersAtSquare(radius = SQUARE_RADIUS): string[] {
    const square = townSquareOf(this.#loop.state)
    if (square === null) return []
    const seen = new Set<string>()
    for (const ev of this.#recentEvents()) {
      if (ev.type !== 'agent_expressed') continue
      const p = ev.payload as { agentId?: unknown; verb?: unknown; x?: unknown; y?: unknown }
      if (typeof p.agentId !== 'string' || typeof p.verb !== 'string') continue
      if (!p.verb.startsWith('express:')) continue
      if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
      if (Math.abs(p.x - square.x) > radius || Math.abs(p.y - square.y) > radius) continue
      seen.add(p.agentId)
    }
    return [...seen].sort()
  }

  /** Every rule the town still holds itself to, in the order it agreed them. */
  socialLaws(): Law[] {
    return standingLaws(this.#loop.state)
  }

  /** What a mind is told the town agreed: the sentences alone, the newest handful of them, in
   *  the order they were agreed. Never a number and never an id — a rule is quoted by its words
   *  or it is not in the prompt at all. */
  lawTexts(): string[] {
    return this.socialLaws()
      .slice(-LAWS_SHOWN)
      .map((l) => l.text)
  }

  /** Rules a council was for, each waiting for a vote on a later day, oldest first. */
  tabledLaws(): TabledLaw[] {
    return tabledLaws(this.#loop.state)
  }

  /** The same, as a mind reads them: who put it, on what day, and the words. */
  tabledLines(): string[] {
    return this.tabledLaws().map((law) => {
      const by = this.#loop.state.agents[law.proposedBy]?.name ?? 'somebody'
      return `${by} put this to the town on ${weekdayFromTick(law.tabledTick)}, and the room was for it: "${law.text}" It becomes the rule if the next gathering votes for it.`
    })
  }

  /** The roofs the whole town uses: everything standing that nobody owns. What a rule may point
   *  at, and the only buildings the court is allowed to name in one. */
  publicPlaces(): { id: string; kind: string; name?: string }[] {
    const state = this.#loop.state
    return Object.keys(state.structures)
      .sort()
      .flatMap((id) => {
        const s = state.structures[id]!
        if (s.owner !== undefined || s.stage !== 'complete') return []
        const name = placeName(s)
        return [{ id: s.id, kind: s.kind, ...(name === undefined ? {} : { name }) }]
      })
  }

  /** Whoever aimed an `express:*` at this body inside the recent window. Perception reports
   *  that a thing was done, never that it was done to you, and only the second feeds a want. */
  expressedAt(agentId: string): string[] {
    const at = new Set<string>()
    for (const ev of this.#recentEvents()) {
      if (ev.type !== 'agent_expressed') continue
      const p = ev.payload as { agentId?: unknown; verb?: unknown; targetId?: unknown }
      if (typeof p.agentId !== 'string' || typeof p.verb !== 'string') continue
      if (!p.verb.startsWith('express:') || p.agentId === agentId) continue
      if (p.targetId !== agentId) continue
      at.add(p.agentId)
    }
    return [...at].sort()
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
    for (const item of queue) this.#tell(item, { ok: false, reason })
    return queue.length
  }

  perception(agentId: string): PerceptionPacket {
    return reconcile(
      composePerception(this.#loop.state, this.#simConfig, agentId, this.#recentEvents()),
      this.#loop.state.agents[agentId],
      coldOf(this.#loop.state, this.#simConfig, agentId),
    )
  }

  // `agent_died` leaves the body in world state for good, so absence is not the question.
  isAlive(agentId: string): boolean {
    return this.#loop.state.agents[agentId]?.alive === true
  }

  // `asleep` is only ever set by the sleep verb, so a body in bed put itself there. A scene
  // reads this and never the hour: going to bed is a fact about people.
  isAwake(agentId: string): boolean {
    return this.#loop.state.agents[agentId]?.asleep === false
  }

  /** What this body has left in it, 0–100. The one body fact a scene line carries: a mind still
   *  talking at midnight is told how tired it is, and answers that for itself. */
  energyOf(agentId: string): number {
    return this.#loop.state.agents[agentId]?.needs.energy ?? 100
  }

  // World answers for perception prose: open ground and food kinds, straight
  // from the engine's own path and verb semantics.
  isWalkable(x: number, y: number): boolean {
    return isPassable(this.#loop.state, x, y)
  }

  isEdible(kind: string): boolean {
    return isFoodKind(this.#simConfig, kind)
  }

  // How big the valley is. No packet can say: terrain is the one thing perception never
  // projects, and a mind with no number for the rim walks at it until the world refuses.
  extent(): { w: number; h: number } {
    const t = this.#loop.state.terrain
    return { w: t[0]!.length, h: t.length }
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
  // now, and the landmarks nobody has to be shown: a person knows the valley they live in, and
  // the walk verb takes their marks on the same terms. The prose drops the roofs in sight.
  knownPlaces(agentId: string): KnownPlace[] {
    const state = this.#loop.state
    const a = state.agents[agentId]
    if (a === undefined) return []
    return [
      ...naturalPlaces(state, a.x, a.y).map((p) => ({ ...p, natural: true })),
      ...(a.knownPlaces ?? []).flatMap((id) => {
        const s = state.structures[id]
        if (s === undefined) return []
        const name = placeName(s)
        return [{ id: s.id, kind: s.kind, x: s.x, y: s.y, ...(name === undefined ? {} : { name }) }]
      }),
    ]
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

  /** Water this body can see and not reach, in the direction it actually lies. */
  distantWater(x: number, y: number): { x: number; y: number } | null {
    const sight = this.#simConfig.movement.sightRadius
    return distantWater(this.#loop.state, x, y, sight, WATER_VISTA_RADIUS)
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

  /** The seq the log stands at, for a caller that means to read forward from here and not over
   *  a day it was not there for. */
  lastSeq(): number {
    return this.#store.lastSeq()
  }

  /** Whoever this body belongs to, or nobody. The world's only word on it: a partnership is
   *  two consents in the log, and this is what they folded to. */
  partnerOf(agentId: string): string | null {
    return this.#loop.state.agents[agentId]?.partnerId ?? null
  }

  /** The roof this body stands under, in the town's own word for it. Null under open sky. */
  roofOf(agentId: string): string | null {
    const inside = this.#loop.state.agents[agentId]?.insideId
    const roof = inside === undefined ? undefined : this.#loop.state.structures[inside]
    return roof === undefined ? null : (placeName(roof) ?? roof.kind)
  }

  /** The five relationship events since `afterSeq`, oldest first, the birth that comes of one,
   *  and the two that change who is in the valley at all. Read off the same window perception
   *  is composed from. */
  relationshipEventsSince(afterSeq: number): SimEvent[] {
    return this.#recentEvents().filter(
      (ev) =>
        ev.seq > afterSeq &&
        (RELATIONSHIP_EVENT_TYPES.includes(ev.type as (typeof RELATIONSHIP_EVENT_TYPES)[number]) ||
          PRESENCE_EVENT_TYPES.includes(ev.type as (typeof PRESENCE_EVENT_TYPES)[number]) ||
          ev.type === 'agent_born'),
    )
  }

  /** How many people the valley is holding, unborn included. The one number the ceiling is
   *  measured against, wherever it is measured. */
  headcount(): number {
    return headcount(this.#loop.state)
  }

  /** The ceiling as the world's own laws have it now, which is what an operator's change moved. */
  maxMinds(): number {
    return effectiveConfig(this.#simConfig, this.#loop.state.laws).population.maxMinds
  }

  /** Where the valley road meets the edge of the map. Null for a world with no town. */
  roadRim(): { x: number; y: number } | null {
    return roadRimOf(this.#loop.state, this.#simConfig)
  }

  /** Whether this world holds a body of this id at all — living, dead or gone down the road. */
  hasBody(agentId: string): boolean {
    return this.#loop.state.agents[agentId] !== undefined
  }

  /** The next id this world will mint, for an emitter that has to name a thing before the
   *  fold has seen the one before it. */
  mintId(prefix: string, offset = 0): string {
    return mintId(this.#loop.state, prefix, offset)
  }

  /** The counter itself, for a cadence that must be read off the world and never rolled. */
  nextEntityId(): number {
    return this.#loop.state.counters.nextEntityId
  }

  /** How long a thing of this kind keeps, stamped the way the world stamps its own. */
  spoilage(kind: string): { spoilage?: { spawnDay: number; days: number } } {
    return spoilageFor(this.#loop.state, kind, this.#simConfig)
  }

  /** Everyone who came up the road and has not yet stood in a talk. Read off the whole log,
   *  so a restart rebuilds exactly the set the run before it was carrying. */
  strangersSoFar(): string[] {
    const met = new Set<string>()
    for (const ev of this.#store.readTypeFrom(0, 'scene_opened')) {
      const p = ev.payload as { participants?: unknown }
      if (!Array.isArray(p.participants)) continue
      for (const id of p.participants) if (typeof id === 'string') met.add(id)
    }
    return this.#store
      .readTypeFrom(0, 'agent_arrived')
      .flatMap((ev) => {
        const p = AgentArrived.safeParse(ev.payload)
        return p.success ? [p.data.id] : []
      })
      .filter((id) => !met.has(id))
  }

  /** A partner of this body who went down the valley road since `sinceTick`: the departure the
   *  log holds, matched to the dissolution that same act emitted. Names and days, never ids. */
  partnersGoneSince(agentId: string, sinceTick: number): { name: string; day: number }[] {
    const from = this.#store.lastSeqThroughTick(sinceTick)
    const mine = new Set<string>()
    for (const ev of this.#store.readTypeFrom(from, 'partnership_dissolved')) {
      const p = ev.payload as { aId?: unknown; bId?: unknown; byId?: unknown }
      if (typeof p.byId !== 'string') continue
      if (p.aId === agentId || p.bId === agentId) mine.add(p.byId)
    }
    const out: { name: string; day: number }[] = []
    for (const ev of this.#store.readTypeFrom(from, 'agent_departed')) {
      const p = ev.payload as { agentId?: unknown }
      if (typeof p.agentId !== 'string' || !mine.has(p.agentId)) continue
      const body = this.#loop.state.agents[p.agentId]
      if (body === undefined) continue
      out.push({ name: body.name, day: Math.floor(ev.tick / MINUTES_PER_DAY) })
    }
    return out
  }

  /** How many times this body was seen doing what the town had agreed against, since a tick.
   *  Unwitnessed does not count: being seen is the whole of what a forbid costs. */
  breachesOf(agentId: string, sinceTick: number): number {
    let n = 0
    for (const ev of this.#store.readTypeFrom(
      this.#store.lastSeqThroughTick(sinceTick),
      'law_broken',
    )) {
      const p = ev.payload as { agentId?: unknown; witnesses?: unknown }
      if (p.agentId !== agentId) continue
      if (Array.isArray(p.witnesses) && p.witnesses.length > 0) n += 1
    }
    return n
  }

  /** Acts of this body the world has finished since `afterSeq`, oldest first. Read off the same
   *  window perception is composed from, so nothing reaches a mind before it could have felt it. */
  completedSince(agentId: string, afterSeq: number): { seq: number; verb: string }[] {
    const done: { seq: number; verb: string }[] = []
    for (const ev of this.#window) {
      if (ev.seq <= afterSeq || ev.type !== 'action_completed') continue
      const p = ev.payload as { agentId?: unknown; verb?: unknown }
      if (p.agentId !== agentId || typeof p.verb !== 'string') continue
      done.push({ seq: ev.seq, verb: p.verb })
    }
    return done
  }

  // The log is appended to inside the tick, and every reader of the window runs after it: a
  // dozen minds looking twice apiece at one tick all see what the first look already read.
  #recentEvents(): SimEvent[] {
    if (this.#windowTick === this.#loop.tick) return this.#window
    const cutoff = this.#loop.tick - this.#recentWindowTicks
    const fresh = this.#store.readFrom(this.#lastSeq)
    this.#lastSeq = this.#store.lastSeq()
    if (fresh.length > 0) this.#window.push(...fresh)
    this.#window = this.#window.filter((ev) => ev.tick > cutoff)
    this.#windowTick = this.#loop.tick
    return this.#window
  }
}
