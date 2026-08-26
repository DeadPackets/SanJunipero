import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { NoObjectGeneratedError } from 'ai'
import type Database from 'better-sqlite3'
import type { LlmClient } from '../llm/client.js'
import type { IdentityCore, AssembledPrompt, PromptBlocks } from '../prompt/assemble.js'
import { assemblePrompt, compactDayLog } from '../prompt/assemble.js'
import { makeablesLine, perceptionToProse, standingWallsLine, type PerceptionPacket } from '../prompt/prose.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { PersonalityStore } from '../personality.js'
import { MemoryStore, type MemoryTags } from '../memory/store.js'
import { keywords, retrieveAmbient, type SceneCues } from '../memory/retrieve.js'
import { isBlankAnswer, parseTurnWithRepair, reconsiderTick, TurnSchema, type Turn } from '../turn.js'
import {
  decideWake,
  disarmBodyAlarm,
  rearmBodyAlarm,
  DEFAULT_MIND_CONFIG,
  type MindClock,
  type MindConfig,
  type PlanState,
  type WakeReason,
} from '../wake.js'
import { runSleepReflection, type ReflectionLlm } from '../reflection.js'
import { rollDream, type DreamLlm } from '../dream.js'
import type { EngineBridge, Intent, SubmitResult } from './bridge.js'
import { buildAgentCtx, humanizeIntent, type Adjudicator, type Codifier, type SeamArbiter } from './arbiterSeam.js'

const COMPACTION_SYSTEM = 'Your mind wanders back over the day…'

// The night running from dusk of day d to dawn of day d+1 is night d, so an
// agent asleep past midnight still reflects (once) over the day that ended.
const DAWN_MINUTES = 6 * 60
function nightOf(tick: number): number {
  return Math.max(0, Math.floor((tick - DAWN_MINUTES) / MINUTES_PER_DAY))
}

function jsonOrRaw(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const EMPTY_TAGS: MemoryTags = { people: [], place: null, objects: [], topics: [] }

// A refusal must leave a door open (addendum §9). The hint is rendered here, at
// prose time, and is never written back into the arbiter's stored ruling. Only
// a skill deficit earns it: a thing nobody can do teaches no one a false path.
export const CRAFT_HINT = ' — perhaps someone nearby knows the craft.'

export function refusalMemoryText(reason: string, impossibleClass?: string): string {
  const hint = impossibleClass === 'insufficient_skill' ? CRAFT_HINT : ''
  return `You realize you cannot: ${reason}${hint}`
}

// ★ THE LOOP-BREAKER. A refusal a mind cannot learn from is a refusal it repeats: the live
// proof has Amara re-adjudicating one idea three times in 34 ticks, at a full arbiter call
// each. The refusal text was widened where it is written (`FALLBACK_IMPOSSIBLE`), and this is
// the other half — the second ask inside the window is answered from the mind's own history
// instead of from the god.
//
// It names the repetition and nothing else. That is the only content the glass allows here: the
// mind's own past is not a hint, where "try it with a rack" would be.
export const REPEATED_REFUSAL = 'You turn it over again and it comes back the way it did before.'

// Sim minutes. Long enough to cover the eight-to-twelve turns a looping mind burned in the live
// proof, short enough that a town which has changed around the mind gets asked again.
export const REFUSAL_MEMORY_TICKS = 240

// How many refused intents a mind carries. Bounded because it is per-mind state held for the
// life of the process, not because 16 is special.
const REFUSAL_MEMORY_SIZE = 16

// Only enough to make "the same idea, said again" match. The arbiter's own `normalizeIntent`
// would be the one true copy, but `@sj/arbiter` depends on `@sj/agents`, so importing it back
// is a package cycle.
function sameIntent(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/, '')
}

function nearestStructureKind(packet: PerceptionPacket): string | null {
  const { x, y } = packet.self
  let best: string | null = null
  let bestDist = Infinity
  for (const s of packet.visible.structures) {
    const d = Math.hypot(s.x - x, s.y - y)
    if (d < bestDist) {
      bestDist = d
      best = s.kind
    }
  }
  return best
}

function cuesFromPacket(packet: PerceptionPacket): SceneCues {
  const people = [...new Set([...packet.visible.agents.map((a) => a.name), ...packet.heard.map((h) => h.name)])]
  const heardText = packet.heard.map((h) => h.text).join(' ')
  return { people, place: nearestStructureKind(packet), topics: keywords(heardText) }
}

export type RuntimeStats = { turns: number; dozes: number; reflections: number; costUsd: number }

// What a mind is carrying at a tick boundary, in a shape that survives a JSON round trip. Cost
// is absent on purpose: it is in the database and would be double-counted here.
export type RuntimeSnapshot = {
  clock: MindClock
  plan: PlanState
  stats: { turns: number; dozes: number; reflections: number }
  dayLog: string[]
  reflectedNight: number | null
  wasNight: boolean
  pendingDreamMood: string | null
}

function freshClock(): MindClock {
  return {
    lastTurnTick: null,
    reconsiderAtTick: null,
    conversationUntilTick: 0,
    dozeUntilTick: 0,
    alarmArmed: {},
    morningWokeDay: null,
    wakeRetryAtTick: 0,
    prevVisibleIds: [],
  }
}

export class AgentRuntime {
  readonly #db: Database.Database
  readonly #llm: LlmClient
  readonly #embedder: { embed(t: string): Promise<Float32Array> }
  readonly #identity: IdentityCore
  readonly #personality: PersonalityStore
  readonly #bridge: EngineBridge
  readonly #config: MindConfig
  readonly #reflectionLlm: ReflectionLlm | null
  readonly #dreamLlm: DreamLlm | null
  readonly #onThought: ((t: { tick: number; agentId: string; text: string }) => void) | null
  #adjudicator: Adjudicator | null
  #codify: Codifier | null = null

  #agentId = ''
  #mem: MemoryStore | null = null
  #dayLog: string[] = []
  #clock: MindClock = freshClock()
  #plan: PlanState = { queue: [], lastResult: 'idle' }
  #planHeadInFlight = false
  #pendingIntent: Intent | null = null
  #pendingInFlight = false
  #turnInFlight = false
  #wakeOwed = false
  #reframedThisTurn = false
  // What this mind has already been refused, and when. Read before the god is asked again.
  #refusedIntents = new Map<string, number>()
  // The thought behind the act now in flight. The god is shown it; the precedent key is not.
  #lastThought = ''
  #stats = { turns: 0, dozes: 0, reflections: 0 }
  #reflectedNight: number | null = null
  #reflectionInFlight = false
  #pendingDreamMood: string | null = null
  #wasNight = false
  #started = false
  #offTick: ((tick: number) => void) | null = null

  constructor(deps: {
    db: Database.Database
    llm: LlmClient
    embedder: { embed(t: string): Promise<Float32Array> }
    identity: IdentityCore
    personality: PersonalityStore
    bridge: EngineBridge
    config?: Partial<MindConfig>
    reflectionLlm?: ReflectionLlm
    dreamLlm?: DreamLlm
    onThought?: (t: { tick: number; agentId: string; text: string }) => void
    adjudicator?: Adjudicator
  }) {
    this.#db = deps.db
    this.#llm = deps.llm
    this.#embedder = deps.embedder
    this.#identity = deps.identity
    this.#personality = deps.personality
    this.#bridge = deps.bridge
    this.#config = { ...DEFAULT_MIND_CONFIG, ...deps.config }
    this.#reflectionLlm = deps.reflectionLlm ?? null
    this.#dreamLlm = deps.dreamLlm ?? null
    this.#onThought = deps.onThought ?? null
    this.#adjudicator = deps.adjudicator ?? null
  }

  start(agentId: string): void {
    if (this.#started) this.stop()
    this.#agentId = agentId
    this.#mem = new MemoryStore(this.#db, agentId, this.#embedder)
    this.#dayLog = []
    this.#clock = freshClock()
    this.#plan = { queue: [], lastResult: 'idle' }
    this.#planHeadInFlight = false
    this.#pendingIntent = null
    this.#pendingInFlight = false
    this.#turnInFlight = false
    this.#wakeOwed = false
    this.#stats = { turns: 0, dozes: 0, reflections: 0 }
    this.#reflectedNight = null
    this.#pendingDreamMood = null
    this.#wasNight = simTimeFromTick(this.#bridge.currentTick()).isNight
    this.#started = true
    if (this.#offTick === null) {
      this.#offTick = (tick) => this.#onTick(tick)
      this.#bridge.onTick(this.#offTick)
    }
  }

  // Everything a mind carries between ticks that is not in the database. A run that is
  // interrupted and picked up again restores this, or every mind wakes with a fresh clock: it
  // would think the moment the run resumed rather than when it meant to, drop the plan it was
  // halfway through, and report a turn count that starts at the resume.
  snapshot(): RuntimeSnapshot {
    return {
      clock: { ...this.#clock, alarmArmed: { ...this.#clock.alarmArmed }, prevVisibleIds: [...this.#clock.prevVisibleIds] },
      plan: { queue: this.#plan.queue.map((i) => ({ ...i })), lastResult: this.#plan.lastResult },
      stats: { ...this.#stats },
      dayLog: [...this.#dayLog],
      reflectedNight: this.#reflectedNight,
      wasNight: this.#wasNight,
      pendingDreamMood: this.#pendingDreamMood,
    }
  }

  // Applied AFTER `start`, which is what clears these in the first place.
  restore(s: RuntimeSnapshot): void {
    this.#clock = { ...s.clock, alarmArmed: { ...s.clock.alarmArmed }, prevVisibleIds: [...s.clock.prevVisibleIds] }
    this.#plan = { queue: s.plan.queue.map((i) => ({ ...i })), lastResult: s.plan.lastResult }
    this.#stats = { ...s.stats }
    this.#dayLog = [...s.dayLog]
    this.#reflectedNight = s.reflectedNight
    this.#wasNight = s.wasNight
    this.#pendingDreamMood = s.pendingDreamMood
  }

  // Post-construction wiring: G9b and C8's supervisor build the arbiter after
  // the minds. Called through `wireArbiter`.
  useArbiter(arbiter: SeamArbiter): void {
    this.#adjudicator = arbiter.adjudicate
    this.#codify = arbiter.codify
  }

  stop(): void {
    this.#started = false
    this.#turnInFlight = false
    this.#plan = { queue: [], lastResult: 'idle' }
    this.#pendingIntent = null
    this.#pendingInFlight = false
  }

  stats(): RuntimeStats {
    return { ...this.#stats, costUsd: this.#llm.totalCostUsd() }
  }

  // Observability for tests: the current day's perception log (prompt block 5).
  dayLogSnapshot(): readonly string[] {
    return [...this.#dayLog]
  }

  // A harness that ends its window mid-night can wait for this to clear
  // instead of cutting the pipeline between its steps.
  reflectionInFlight(): boolean {
    return this.#reflectionInFlight
  }

  #onTick(tick: number): void {
    if (!this.#started) return
    const packet = this.#bridge.perception(this.#agentId)
    rearmBodyAlarm(this.#config, packet.self.body, this.#clock)
    this.#submitPendingIfIdle(packet.self.activity)
    this.#advancePlan(packet)
    this.#answerWakeOwed(packet)
    if (packet.heard.length > 0) {
      this.#clock.conversationUntilTick = tick + this.#config.conversationWindowTicks
    }
    this.#handleNight(tick, packet)
    // Morning is consumed by an actual rise, not by the reason firing: a body
    // seen awake in daylight has had its morning.
    if (!packet.self.asleep && !packet.time.isNight) {
      this.#clock.morningWokeDay = Math.floor(tick / MINUTES_PER_DAY)
    }
    if (this.#turnInFlight) return
    const reason = decideWake(this.#config, packet, this.#clock, tick, this.#plan)
    if (reason === 'reconsider') this.#clock.reconsiderAtTick = null
    if (reason !== null) {
      if (packet.self.asleep) {
        this.#wakeOwed = true
        this.#clock.wakeRetryAtTick = tick + this.#config.wakeRetryTicks
      }
      void this.#startTurn(reason)
    }
  }

  // A roused sleeper owes the world a wake. If the turn it was given put no
  // act into the world — or the world refused every act it tried — the body
  // answers its own alarm and rises by the wake verb.
  #answerWakeOwed(packet: PerceptionPacket): void {
    if (!this.#wakeOwed) return
    if (!packet.self.asleep) {
      this.#wakeOwed = false
      return
    }
    if (this.#turnInFlight || this.#pendingIntent !== null || this.#pendingInFlight || this.#planHeadInFlight) return
    this.#wakeOwed = false
    void this.#bridge.submit(this.#agentId, { verb: 'wake', params: {} })
  }

  #advancePlan(packet: PerceptionPacket): void {
    this.#pumpPlan(packet.self.activity)
  }

  // Submit the queue head exactly when the agent is idle, and advance the queue
  // when an in-flight head's action completes. A rejected head is handled
  // synchronously during the drain (onResult), before #advancePlan ever runs.
  #pumpPlan(activity: string | null): void {
    if (this.#plan.lastResult !== 'running') return
    // A held direct action outranks the plan: the queue waits its turn.
    if (this.#pendingIntent !== null || this.#pendingInFlight) return
    if (this.#planHeadInFlight) {
      if (activity !== null) return
      this.#plan.queue.shift()
      this.#planHeadInFlight = false
      if (this.#plan.queue.length === 0) {
        this.#plan.lastResult = 'done'
        return
      }
    }
    if (activity === null) {
      this.#planHeadInFlight = true
      const head = this.#plan.queue[0]!
      void this.#bridge.submit(this.#agentId, head, (res) => this.#onPlanHeadResult(res, head))
    }
  }

  #submitPendingIfIdle(activity: string | null): Promise<void> {
    if (this.#pendingIntent === null || this.#pendingInFlight) return Promise.resolve()
    if (activity !== null) return Promise.resolve()
    const intent = this.#pendingIntent
    this.#pendingInFlight = true
    return this.#bridge
      .submit(this.#agentId, intent, (res) => {
        this.#pendingInFlight = false
        if (this.#pendingIntent !== intent) return
        if (res.ok) {
          this.#pendingIntent = null
          return
        }
        if (res.reason.startsWith('already busy')) return
        this.#pendingIntent = null
        if (this.#reroutesUnknownVerb(res.reason)) {
          void this.#adjudicateFreeform(humanizeIntent(intent.verb, intent.params))
          return
        }
        void this.#writeActionMemory(refusalMemoryText(res.reason))
      })
      .then(() => undefined)
  }

  // An invented verb is not a mistake, it is a proposal: it re-enters the turn
  // as freeform words for the arbiter. Once per turn — a second failure is the
  // world's final answer, or an unwired arbiter would loop on itself.
  #reroutesUnknownVerb(reason: string): boolean {
    if (!reason.startsWith('unknown verb:')) return false
    if (this.#adjudicator === null || this.#reframedThisTurn) return false
    this.#reframedThisTurn = true
    return true
  }

  // Held until the body is free; a busy rejection retries instead of
  // discarding, until accepted or superseded by a newer turn's action.
  #holdIntent(intent: Intent): Promise<void> {
    this.#pendingIntent = intent
    return this.#submitPendingIfIdle(this.#bridge.perception(this.#agentId).self.activity)
  }

  // A try at something new goes to the arbiter, not to the verb registry. The
  // world stays the fallback: an unreachable arbiter must never eat the turn.
  async #adjudicateFreeform(description: string): Promise<void> {
    const fallback = (): Promise<void> =>
      this.#holdIntent({ verb: 'experiment', params: { description } })
    // The same idea, said again, inside the window: answered from this mind's own history. It
    // costs no call, and the memory is DIFFERENT from the first refusal, which is the whole
    // point — a mind handed the identical sentence a third time has learned nothing.
    if (this.#alreadyRefused(description)) {
      await this.#writeActionMemory(REPEATED_REFUSAL)
      return
    }
    let verdict
    try {
      verdict = await this.#adjudicator!(description, buildAgentCtx(this.#bridge, this.#agentId, this.#lastThought))
    } catch (err) {
      this.#llm.alert('adjudicate_failed', err instanceof Error ? err.message : String(err))
      return fallback()
    }
    if (verdict.kind === 'map') return this.#holdIntent({ verb: verdict.verb, params: verdict.params })
    if (verdict.kind === 'impossible') {
      this.#rememberRefusal(description)
      await this.#writeActionMemory(refusalMemoryText(verdict.reason, verdict.class))
      return
    }
    // Adjudicate once, physics forever: the recipe becomes a verb the engine
    // owns, and this mind is the first to use it. With no codifier wired the
    // attempt still reaches the world rather than vanishing.
    if (this.#codify === null) return fallback()
    let verb: string
    try {
      verb = this.#codify(verdict.recipe, { agentId: this.#agentId, intent: description }).verb
    } catch (err) {
      this.#llm.alert('codify_failed', err instanceof Error ? err.message : String(err))
      return fallback()
    }
    return this.#holdIntent({ verb, params: {} })
  }

  #alreadyRefused(description: string): boolean {
    const at = this.#refusedIntents.get(sameIntent(description))
    return at !== undefined && this.#bridge.currentTick() - at < REFUSAL_MEMORY_TICKS
  }

  #rememberRefusal(description: string): void {
    const key = sameIntent(description)
    this.#refusedIntents.delete(key)
    this.#refusedIntents.set(key, this.#bridge.currentTick())
    // Insertion-ordered, so the first key is the oldest.
    while (this.#refusedIntents.size > REFUSAL_MEMORY_SIZE) {
      this.#refusedIntents.delete(this.#refusedIntents.keys().next().value!)
    }
  }

  #onPlanHeadResult(res: SubmitResult, head: Intent): void {
    if (res.ok) return
    this.#plan.lastResult = 'blocked'
    this.#plan.queue = []
    this.#planHeadInFlight = false
    if (this.#reroutesUnknownVerb(res.reason)) {
      void this.#adjudicateFreeform(humanizeIntent(head.verb, head.params))
      return
    }
    void this.#writeActionMemory(refusalMemoryText(res.reason))
  }

  #handleNight(tick: number, packet: PerceptionPacket): void {
    const isNight = packet.time.isNight
    if (this.#wasNight && !isNight) {
      if (this.#pendingDreamMood !== null) {
        const cur = this.#personality.current().doc.current
        this.#personality.updateCurrent({ ...cur, mood: this.#pendingDreamMood })
        this.#pendingDreamMood = null
      }
      this.#dayLog = []
    }
    if (isNight && packet.self.asleep) {
      const night = nightOf(tick)
      if (this.#reflectedNight !== night) void this.#runNight(night)
    }
    this.#wasNight = isNight
  }

  async #startTurn(_reason: WakeReason): Promise<void> {
    if (this.#turnInFlight) return
    this.#turnInFlight = true
    const tick = this.#bridge.currentTick()
    try {
      await this.#runTurnBody()
    } catch (err) {
      this.#llm.alert('turn_crash', err instanceof Error ? err.message : String(err))
      this.#clock.lastTurnTick = tick + this.#config.dozeTicks
      this.#clock.dozeUntilTick = tick + this.#config.dozeTicks
    } finally {
      this.#turnInFlight = false
    }
  }

  async #runTurnBody(): Promise<void> {
    this.#reframedThisTurn = false
    const tick = this.#bridge.currentTick()
    const packet = this.#bridge.perception(this.#agentId)
    const day = Math.floor(tick / MINUTES_PER_DAY)

    const prose = perceptionToProse(packet, (detail) => this.#llm.alert('prose', detail), {
      isWalkable: (x, y) => this.#bridge.isWalkable(x, y),
      isEdible: (kind) => this.#bridge.isEdible(kind),
      waterAtHand: () => this.#bridge.waterAtHand(this.#agentId),
      nearestWater: (x, y) => this.#bridge.nearestWater(x, y),
      nearestFood: (x, y) => this.#bridge.nearestFood(x, y),
    })
    this.#dayLog.push(prose)
    // Said in the same breath as what the eyes can reach, and NOT into the day log: what these
    // hands can make is a standing fact about the world, not something that happened today.
    const nowProse = [
      prose,
      makeablesLine(this.#bridge.makeables(), this.#bridge.groundForBuilding()),
      standingWallsLine(this.#bridge.unfinishedWork(this.#agentId)),
    ].filter((p) => p.length > 0).join(' ')

    // Retrieve BEFORE inserting this perception: a just-written row would win
    // recency and tag match, filling the scene with echoes of the present.
    const cues = cuesFromPacket(packet)
    const ambient = await retrieveAmbient(this.#mem!, cues, tick, this.#config.ambientK)

    await this.#mem!.insertMemory({
      tick,
      kind: 'perception',
      text: prose,
      importance: 3,
      tags: {
        people: packet.visible.agents.map((a) => a.name),
        place: nearestStructureKind(packet),
        objects: [],
        topics: keywords(packet.heard.map((h) => h.text).join(' ')),
      },
    })

    const blocks: PromptBlocks = {
      rulesOfBeing: RULES_OF_BEING,
      identity: this.#identity,
      personality: { doc: this.#personality.current().doc, autobiography: this.#mem!.autobiography() },
      scene: { ledgers: this.#buildLedgers(cues.people), memories: ambient },
      dayLog: this.#dayLog,
      now: { prose: nowProse },
    }
    let assembled = assemblePrompt(blocks)

    let turn: Turn
    try {
      if (assembled.needsCompaction) {
        const summary = await this.#llm.text({
          system: COMPACTION_SYSTEM,
          messages: [{ role: 'user', content: this.#dayLog.join('\n') }],
        })
        this.#dayLog = compactDayLog(this.#dayLog, summary.text)
        assembled = assemblePrompt({ ...blocks, dayLog: this.#dayLog })
      }
      let answer = await this.#ask(assembled)
      // A blank answer is not a wrong answer. There is nothing to correct, so the honest
      // retry is the same request again — byte-identical, and so still a cached prefix.
      if (isBlankAnswer(answer.raw)) answer = await this.#ask(assembled)
      if (isBlankAnswer(answer.raw)) {
        // Twice nothing. The turn is left UNSPENT: no thought the mind never had, no turn
        // counted, and whatever the body was already doing carries on being done. The doze
        // is the back-pressure, so a silent back end is not hammered.
        this.#llm.alert('blank_answer', 'two blank answers; the turn is left unspent')
        this.#doze(tick)
        return
      }
      const { raw, badText } = answer
      turn = await parseTurnWithRepair(
        raw,
        (issues) => this.#repair(assembled, badText, issues),
        (detail) => this.#llm.alert('turn_fallback', detail),
      )
    } catch {
      this.#doze(tick)
      return
    }

    this.#clock.lastTurnTick = tick
    await this.#applyTurn(turn, tick, day)
    if ((turn.plan ?? undefined) === undefined && (this.#plan.lastResult === 'done' || this.#plan.lastResult === 'blocked')) {
      this.#plan.lastResult = 'idle'
    }
    this.#stats.turns += 1
    disarmBodyAlarm(this.#config, packet.self.body, this.#clock)
    this.#clock.prevVisibleIds = packet.visible.agents.map((a) => a.id)
  }

  // One ask, and what came back of it: the parsed answer, plus the raw text when the answer
  // did not fit the shape, which is what a repair needs to quote back.
  async #ask(assembled: AssembledPrompt): Promise<{ raw: unknown; badText: string }> {
    try {
      const { value } = await this.#llm.object({
        schema: TurnSchema, system: assembled.system, messages: assembled.messages,
      })
      return { raw: value, badText: '' }
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err
      const badText = err.text ?? ''
      return { raw: jsonOrRaw(badText), badText }
    }
  }

  // The bad output goes back as the assistant's own words, the correction as
  // a user message — never a correction spoken in the assistant's voice.
  async #repair(assembled: AssembledPrompt, badText: string, issues: string): Promise<unknown> {
    try {
      const { value } = await this.#llm.object({
        schema: TurnSchema,
        system: assembled.system,
        messages: [
          ...assembled.messages,
          { role: 'assistant', content: badText.length > 0 ? badText : '…' },
          { role: 'user', content: `Your answer was rejected. Fix it:\n${issues}` },
        ],
      })
      return value
    } catch (err) {
      // A second invalid generation falls through to the quiet fallback turn.
      if (NoObjectGeneratedError.isInstance(err)) return err.text ?? null
      throw err
    }
  }

  async #applyTurn(turn: Turn, tick: number, day: number): Promise<void> {
    const mem = this.#mem!
    // Held for the god: the sentence that reached for whatever this turn is about to try.
    this.#lastThought = turn.thought
    await mem.insertMemory({ tick, kind: 'thought', text: turn.thought, importance: turn.importance, tags: EMPTY_TAGS })
    this.#onThought?.({ tick, agentId: this.#agentId, text: turn.thought })

    // A turn that speaks or acts directly preempts whatever plan was running.
    if ((turn.speech ?? null) !== null || (turn.action ?? null) !== null) {
      if (this.#plan.lastResult === 'running') this.#plan.lastResult = 'idle'
      this.#plan.queue = []
      this.#planHeadInFlight = false
    }

    if (turn.speech) {
      await this.#bridge.submit(this.#agentId, { verb: 'speak', params: { text: turn.speech } })
    }

    if (turn.action) {
      // `experiment {description}` is the same door as freeform said the other
      // way round — CAPABILITIES offers both, so both reach the arbiter.
      const attempt = 'freeform' in turn.action
        ? turn.action.freeform
        : turn.action.verb === 'experiment' && typeof turn.action.params.description === 'string'
          ? turn.action.params.description
          : null
      if (attempt !== null && attempt.length > 0 && this.#adjudicator !== null) {
        await this.#adjudicateFreeform(attempt)
      } else {
        const intent: Intent =
          'freeform' in turn.action
            ? { verb: 'experiment', params: { description: turn.action.freeform } }
            : { verb: turn.action.verb, params: turn.action.params }
        await this.#holdIntent(intent)
      }
    }

    if (turn.plan) {
      this.#plan.queue = [...turn.plan]
      this.#plan.lastResult = turn.plan.length > 0 ? 'running' : 'done'
      this.#planHeadInFlight = false
      this.#pumpPlan(this.#bridge.perception(this.#agentId).self.activity)
    }

    if (turn.journal) {
      mem.insertJournal(tick, day, turn.journal)
      await mem.insertMemory({ tick, kind: 'journal', text: turn.journal, importance: turn.importance, tags: EMPTY_TAGS })
      this.#clock.lastTurnTick = (this.#clock.lastTurnTick ?? tick) + this.#config.journalTicks
    }

    if (turn.reconsider_at) {
      this.#clock.reconsiderAtTick = reconsiderTick(tick, turn.reconsider_at)
    }
  }

  async #runNight(day: number): Promise<void> {
    if (this.#reflectedNight === day) return
    this.#reflectedNight = day
    if (this.#reflectionLlm === null) return
    this.#stats.reflections += 1
    this.#reflectionInFlight = true
    try {
      await runSleepReflection({
        mem: this.#mem!,
        personality: this.#personality,
        llm: this.#reflectionLlm,
        day,
        alert: (kind, detail) => this.#llm.alert(kind, detail),
      })
      if (this.#dreamLlm !== null) {
        const dream = await rollDream({ mem: this.#mem!, agentId: this.#agentId, day, llm: this.#dreamLlm, chance: this.#config.dreamChance })
        if (dream.dreamed) this.#pendingDreamMood = dream.mood
      }
    } catch (err) {
      this.#llm.alert('reflection_failed', err instanceof Error ? err.message : String(err))
    } finally {
      this.#reflectionInFlight = false
    }
  }

  #buildLedgers(people: string[]): Array<{ name: string; doc: string }> {
    const out: Array<{ name: string; doc: string }> = []
    for (const person of people) {
      const ledger = this.#mem!.getLedger(person)
      if (ledger) out.push({ name: person, doc: ledger.doc })
    }
    return out
  }

  #writeActionMemory(text: string): Promise<number> {
    return this.#mem!.insertMemory({
      tick: this.#bridge.currentTick(),
      kind: 'action',
      text,
      importance: 3,
      tags: EMPTY_TAGS,
    })
  }

  #doze(tick: number): void {
    this.#stats.dozes += 1
    this.#llm.alert('doze_off', 'providers unavailable; the mind dozes off mid-thought')
    this.#clock.lastTurnTick = tick + this.#config.dozeTicks
    this.#clock.dozeUntilTick = tick + this.#config.dozeTicks
  }
}
