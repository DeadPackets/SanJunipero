import {
  BOND_VALENCE,
  decayWarmth,
  MINUTES_PER_DAY,
  sanitizeSpokenText,
  simTimeFromTick,
} from '@sj/shared'
import { NoObjectGeneratedError } from 'ai'
import type Database from 'better-sqlite3'
import type { LlmClient } from '@sj/llm'
import type {
  IdentityCore,
  AssembledPrompt,
  PromptBlocks,
  Recalled,
  Underway,
} from '../prompt/assemble.js'
import {
  appendMoment,
  assemblePrompt,
  compactDayLog,
  JOURNAL_LINES,
  OWN_WORDS_SHOWN,
} from '../prompt/assemble.js'
import {
  heardProse,
  makeablesLine,
  roadLine,
  perceptionToProse,
  placesKnownLine,
  absenceLine,
  type Company,
  type ProseWorld,
  standingWallsLine,
  stasisLine,
  stillnessAt,
  type Stillness,
  worldDay,
  type PerceptionPacket,
} from '../prompt/prose.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { PersonalityStore } from '../personality.js'
import { MemoryStore, type MemoryTags } from '../memory/store.js'
import { keywords, retrieveAmbient, retrieveRecall, type SceneCues } from '../memory/retrieve.js'
import { promptText } from '../memory/gist.js'
import {
  isBlankAnswer,
  parseTurnWithRepair,
  reconsiderTick,
  turnSpeaks,
  TurnSchemaActionRequired,
  type Turn,
} from '../turn.js'
import {
  decideWake,
  disarmBodyAlarm,
  rearmBodyAlarm,
  DEFAULT_MIND_CONFIG,
  type MindClock,
  type MindConfig,
  type PlanState,
} from '../wake.js'
import { runSleepReflection, type ReflectionLlm } from '../reflection.js'
import { rollDream, type DreamLlm } from '../dream.js'
import type { EngineBridge, Intent, SubmitResult } from './bridge.js'
import {
  buildAgentCtx,
  humanizeIntent,
  type Adjudicator,
  type Codifier,
  type SeamArbiter,
} from './arbiterSeam.js'

const COMPACTION_SYSTEM = 'Your mind wanders back over the day…'

// The night running from dusk of day d to dawn of day d+1 is night d, so an
// agent asleep past midnight still reflects (once) over the day that ended.
// Ticks 0..359 are the pre-dawn of day 0, which belongs to night -1: a night nobody lived.
const DAWN_MINUTES = 6 * 60
export function nightOf(tick: number): number {
  return Math.floor((tick - DAWN_MINUTES) / MINUTES_PER_DAY)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function jsonOrRaw(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const EMPTY_TAGS: MemoryTags = { people: [], place: null, objects: [], topics: [] }

// Rendered at prose time and never written back into a stored ruling. Only a skill deficit
// earns it: a thing nobody can do teaches no one a false path.
export const CRAFT_HINT = ' — perhaps someone nearby knows the craft.'

// Engine-side words: a parameter schema spelled out in braces, or a registry name. Every
// other engine reason is the town's own sentence now and reaches the mind whole.
const MACHINE_REASON = /\{[^}]*\}|^(?:unknown verb:|no such agent)/

// Words for standing still. The body was already doing it, so the moment is a quiet beat: no
// refusal to remember, and nothing for a god to rule on.
const BODY_NOOPS = new Set([
  'stand',
  'sit',
  'wait',
  'rest',
  'look',
  'think',
  'none',
  'nothing',
  'pause',
  'stay',
])

function isBodyNoOp(reason: string, verb: string): boolean {
  return reason.startsWith('unknown verb:') && BODY_NOOPS.has(verb)
}

export const OPAQUE_REFUSAL = 'it does not take, and you cannot say why'

// Whether the reason can be said out loud at all. Asked once, so the memory and the next turn
// cannot drift apart the day the pattern changes.
const sayable = (reason: string): string => (MACHINE_REASON.test(reason) ? OPAQUE_REFUSAL : reason)

export function refusalMemoryText(reason: string, impossibleClass?: string): string {
  const said = sayable(reason)
  const hint = said === reason && impossibleClass === 'insufficient_skill' ? CRAFT_HINT : ''
  return `You realize you cannot: ${said}${hint}`
}

/** The same refusal, said to the next turn instead of only to the memory store. A reason that
 *  reached a memory row had to win retrieval to be seen, and mostly did not (rehearsal4 K20). */
export function lastTurnLine(what: string, reason: string): string {
  return `Last turn: ${what} did not take — ${sayable(reason)}.`
}

// A freeform intent has no verb to name, only the words the mind used.
export const TRIED_FREEFORM = 'what you tried'

// The second ask inside the window is answered from the mind's own history, not from the god.
// It names the repetition and nothing else: a mind's own past is not a hint.
export const REPEATED_REFUSAL = 'You turn it over again and it comes back the way it did before.'

// Sim minutes: long enough to cover a loop, short enough that a changed town gets asked again.
export const REFUSAL_MEMORY_TICKS = 240

// How many refused intents a mind carries. Bounded because it is per-mind state held for the
// life of the process, not because 16 is special.
const REFUSAL_MEMORY_SIZE = 16

// Only enough to make "the same idea, said again" match. `normalizeIntent` would be the one
// true copy, but importing @sj/arbiter back here is a package cycle.
function sameIntent(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '')
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
  const people = [
    ...new Set([...packet.visible.agents.map((a) => a.name), ...packet.heard.map((h) => h.name)]),
  ]
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
  // Optional so a checkpoint written before the recall verb existed still resumes.
  pendingRecall?: Recalled | null | undefined
  // The same, for the refusal owed to the next turn.
  lastOutcome?: string | null | undefined
  // The same again, for what a mind last said, where it has been standing and whom it has been
  // with — a resume that dropped these would have a mind repeat itself into the rut the
  // stasis line exists to break.
  spoken?: string[] | undefined
  still?: Stillness | null | undefined
  company?: (Company & { id: string })[] | undefined
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

const idlePlan = (): PlanState => ({ queue: [], lastResult: 'idle', size: 0 })

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
  #prevMomentSentences = new Set<string>()
  #clock: MindClock = freshClock()
  #plan: PlanState = idlePlan()
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
  #pendingRecall: Recalled | null = null
  #lastOutcome: string | null = null
  // The mind's own last words, oldest first. Perception skips self and the day log dedups a
  // still scene, so without this a mind cannot hear what it has been saying.
  #spoken: string[] = []
  // Where the feet have been standing, and since when. Null while asleep and after any act
  // the world took that was not a walk or a word.
  #still: Stillness | null = null
  // Who this mind has been with and how warm the tie stood when they last parted. The engine
  // keeps no bonds and the gateway folds a log no mind can read, so a mind's own tie is folded
  // here — out of the one act perception can witness, which is a word. Warmth is carried
  // forward to `lastSeenTick` and no further: a tie does not cool for want of company.
  #company = new Map<string, Company>()
  // Last tick's utterances. The recent window holds one for as long as it is recent, so only a
  // key that was not there a tick ago is a new word rather than the same word again.
  #heardKeys = new Set<string>()
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
    config?: Partial<MindConfig> | undefined
    reflectionLlm?: ReflectionLlm | undefined
    dreamLlm?: DreamLlm | undefined
    onThought?: ((t: { tick: number; agentId: string; text: string }) => void) | undefined
    adjudicator?: Adjudicator | undefined
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
    this.#prevMomentSentences = new Set()
    this.#clock = freshClock()
    this.#plan = idlePlan()
    this.#planHeadInFlight = false
    this.#pendingIntent = null
    this.#pendingInFlight = false
    this.#turnInFlight = false
    this.#wakeOwed = false
    this.#stats = { turns: 0, dozes: 0, reflections: 0 }
    this.#reflectedNight = null
    this.#pendingDreamMood = null
    this.#pendingRecall = null
    this.#lastOutcome = null
    this.#spoken = []
    this.#still = null
    this.#company = new Map()
    this.#heardKeys = new Set()
    this.#wasNight = simTimeFromTick(this.#bridge.currentTick()).isNight
    this.#started = true
    if (this.#offTick === null) {
      this.#offTick = (tick) => {
        this.#onTick(tick)
      }
      this.#bridge.onTick(this.#offTick)
    }
  }

  // Everything a mind carries between ticks that is not in the database. A resume restores it,
  // or every mind wakes with a fresh clock, a dropped plan and a turn count starting at zero.
  snapshot(): RuntimeSnapshot {
    return {
      clock: {
        ...this.#clock,
        alarmArmed: { ...this.#clock.alarmArmed },
        prevVisibleIds: [...this.#clock.prevVisibleIds],
      },
      plan: {
        queue: this.#plan.queue.map((i) => ({ ...i })),
        lastResult: this.#plan.lastResult,
        size: this.#plan.size,
      },
      stats: { ...this.#stats },
      dayLog: [...this.#dayLog],
      reflectedNight: this.#reflectedNight,
      wasNight: this.#wasNight,
      pendingDreamMood: this.#pendingDreamMood,
      pendingRecall: this.#pendingRecall,
      lastOutcome: this.#lastOutcome,
      spoken: [...this.#spoken],
      still: this.#still,
      company: [...this.#company].map(([id, c]) => ({ id, ...c })),
    }
  }

  // Applied AFTER `start`, which is what clears these in the first place.
  restore(s: RuntimeSnapshot): void {
    this.#clock = {
      ...s.clock,
      alarmArmed: { ...s.clock.alarmArmed },
      prevVisibleIds: [...s.clock.prevVisibleIds],
    }
    this.#plan = {
      queue: s.plan.queue.map((i) => ({ ...i })),
      lastResult: s.plan.lastResult,
      size: s.plan.size,
    }
    this.#stats = { ...s.stats }
    this.#dayLog = [...s.dayLog]
    this.#reflectedNight = s.reflectedNight
    this.#wasNight = s.wasNight
    this.#pendingDreamMood = s.pendingDreamMood
    this.#pendingRecall = s.pendingRecall ?? null
    this.#lastOutcome = s.lastOutcome ?? null
    this.#spoken = [...(s.spoken ?? [])]
    this.#still = s.still ?? null
    this.#company = new Map((s.company ?? []).map(({ id, ...c }) => [id, { ...c }]))
  }

  // Post-construction wiring: the supervisor builds the arbiter after
  // the minds. Called through `wireArbiter`.
  useArbiter(arbiter: SeamArbiter): void {
    this.#adjudicator = arbiter.adjudicate
    this.#codify = arbiter.codify
  }

  stop(): void {
    this.#started = false
    this.#turnInFlight = false
    this.#plan = idlePlan()
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
    // A night in bed is not an afternoon spent standing, and neither is a house going up: a
    // pair of hands still on a job is not a pair of hands with nothing to do.
    const working = packet.self.activity !== null && packet.self.activity !== 'walk'
    this.#still =
      packet.self.asleep || working
        ? null
        : stillnessAt(this.#still, packet.self.x, packet.self.y, tick)
    this.#noteCompany(packet, tick)
    rearmBodyAlarm(this.#config, packet.self.body, this.#clock)
    void this.#submitPendingIfIdle(packet.self.activity).catch(this.#sink('submit_crash'))
    this.#pumpPlan(packet.self.activity)
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
      void this.#startTurn()
    }
  }

  // A roused sleeper owes the world a wake: if its turn put no act into the world, the body
  // answers its own alarm and rises by the wake verb.
  #answerWakeOwed(packet: PerceptionPacket): void {
    if (!this.#wakeOwed) return
    if (!packet.self.asleep) {
      this.#wakeOwed = false
      return
    }
    if (
      this.#turnInFlight ||
      this.#pendingIntent !== null ||
      this.#pendingInFlight ||
      this.#planHeadInFlight
    )
      return
    this.#wakeOwed = false
    void this.#bridge.submit(this.#agentId, { verb: 'wake', params: {} })
  }

  // Submit the queue head only when the agent is idle. A rejected head is handled
  // synchronously during the drain, before `#pumpPlan` ever runs.
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
      void this.#bridge.submit(this.#agentId, head, (res) => {
        this.#onPlanHeadResult(res, head)
      })
    }
  }

  #noteCompany(packet: PerceptionPacket, tick: number): void {
    const met = (id: string, name: string): Company => {
      const was = this.#company.get(id)
      if (was !== undefined) {
        was.warmth = decayWarmth(was.warmth, was.lastSeenTick, tick)
        was.lastSeenTick = tick
        return was
      }
      const fresh = { name, lastSeenTick: tick, warmth: 0 }
      this.#company.set(id, fresh)
      return fresh
    }
    for (const a of packet.visible.agents) if (a.id !== this.#agentId) met(a.id, a.name)
    const keys = new Set<string>()
    for (const h of packet.heard) {
      const key = `${h.speakerId}\u0000${h.text}`
      keys.add(key)
      const them = met(h.speakerId, h.name)
      // The window holds one utterance for as long as it is recent, so only a key that was not
      // there a tick ago is a new word rather than the same word again.
      if (!this.#heardKeys.has(key)) them.warmth += BOND_VALENCE.friend
    }
    this.#heardKeys = keys
  }

  // What the WORLD took, not what the model wrote: the words are sanitized the way the verb
  // sanitizes them, and anything but a walk or a word is something happening, which ends a rut
  // even where it was over too fast for a tick to catch the hands at it. A word for standing
  // still never arrives here at all — the registry turns it away.
  #noteAccepted(intent: Intent, res: SubmitResult): void {
    if (!res.ok) return
    if (intent.verb === 'speak') {
      const text: unknown = intent.params.text
      if (typeof text === 'string') {
        this.#spoken.push(sanitizeSpokenText(text))
        if (this.#spoken.length > OWN_WORDS_SHOWN) this.#spoken.shift()
      }
      if (this.#still !== null) this.#still = { ...this.#still, spoke: true }
      return
    }
    if (intent.verb !== 'walk') this.#still = null
  }

  #clearPlanQueue(): void {
    this.#plan.queue = []
    this.#plan.size = 0
    this.#planHeadInFlight = false
  }

  /** The plan this mind is partway through, in its own words for the act. A body mid-act with
   *  no plan is not here: the moment prose already says so, and holds an act rather than drops it. */
  #underway(): Underway | null {
    const head = this.#plan.queue[0]
    if (this.#plan.lastResult !== 'running' || head === undefined) return null
    // A checkpoint written before the count existed resumes with what is left of the queue.
    const of = this.#plan.size ?? this.#plan.queue.length
    return {
      what: humanizeIntent(head.verb, head.params),
      step: of - this.#plan.queue.length + 1,
      of,
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
        this.#noteAccepted(intent, res)
        if (this.#pendingIntent !== intent) return
        if (res.ok) {
          this.#pendingIntent = null
          return
        }
        if (res.reason.startsWith('already busy')) return
        this.#pendingIntent = null
        if (isBodyNoOp(res.reason, intent.verb)) return
        if (this.#reroutesUnknownVerb(res.reason)) {
          void this.#adjudicateFreeform(humanizeIntent(intent.verb, intent.params)).catch(
            this.#sink('adjudicate_crash'),
          )
          return
        }
        this.#recordRefusal(intent.verb, res.reason)
      })
      .then(() => undefined)
  }

  // An invented verb is a proposal, not a mistake: it re-enters the turn as freeform words.
  // Once per turn, or an unwired arbiter would loop on itself.
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
    // The same idea inside the window, answered from this mind's own history at no call. The
    // memory it leaves differs from the first refusal, or the mind learns nothing.
    if (this.#alreadyRefused(description)) {
      await this.#writeActionMemory(REPEATED_REFUSAL)
      return
    }
    let verdict
    try {
      verdict = await this.#adjudicator!(
        description,
        buildAgentCtx(this.#bridge, this.#agentId, this.#lastThought),
      )
    } catch (err) {
      this.#llm.alert('adjudicate_failed', messageOf(err))
      return fallback()
    }
    if (verdict.kind === 'map')
      return this.#holdIntent({ verb: verdict.verb, params: verdict.params })
    if (verdict.kind === 'impossible') {
      this.#rememberRefusal(description)
      this.#lastOutcome = lastTurnLine(TRIED_FREEFORM, verdict.reason)
      await this.#writeActionMemory(refusalMemoryText(verdict.reason, verdict.class))
      return
    }
    // Adjudicate once, physics forever. With no codifier wired the attempt still reaches the
    // world rather than vanishing.
    if (this.#codify === null) return fallback()
    let verb: string
    try {
      verb = this.#codify(verdict.recipe, { agentId: this.#agentId, intent: description }).verb
    } catch (err) {
      this.#llm.alert('codify_failed', messageOf(err))
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
    this.#noteAccepted(head, res)
    if (res.ok) return
    // A word for standing still is a step spent, not a plan refused: the body was already doing
    // it, so the queue carries on from the next step instead of dying at this one.
    if (isBodyNoOp(res.reason, head.verb)) {
      this.#plan.queue.shift()
      this.#planHeadInFlight = false
      if (this.#plan.queue.length === 0) this.#plan.lastResult = 'done'
      return
    }
    this.#clearPlanQueue()
    this.#plan.lastResult = 'blocked'
    if (this.#reroutesUnknownVerb(res.reason)) {
      void this.#adjudicateFreeform(humanizeIntent(head.verb, head.params)).catch(
        this.#sink('adjudicate_crash'),
      )
      return
    }
    this.#recordRefusal(head.verb, res.reason)
  }

  // Every refusal goes both ways at once: into the mind's own history, and into the very next
  // turn. A row alone is written with no tags and mostly never wins retrieval back.
  #recordRefusal(what: string, reason: string, impossibleClass?: string): void {
    this.#lastOutcome = lastTurnLine(what, reason)
    void this.#writeActionMemory(refusalMemoryText(reason, impossibleClass)).catch(
      this.#sink('memory_write_failed'),
    )
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
      this.#prevMomentSentences = new Set()
    }
    if (isNight && packet.self.asleep) {
      const night = nightOf(tick)
      if (night >= 0 && this.#reflectedNight !== night) void this.#runNight(night)
    }
    this.#wasNight = isNight
  }

  async #startTurn(): Promise<void> {
    if (this.#turnInFlight) return
    this.#turnInFlight = true
    const tick = this.#bridge.currentTick()
    try {
      await this.#runTurnBody()
    } catch (err) {
      this.#llm.alert('turn_crash', messageOf(err))
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

    // `Required` on purpose: a road the prose reads and the runtime forgets to wire is a
    // sentence no mind ever sees, and it fails as silence rather than as an error.
    const world: Required<ProseWorld> = {
      isWalkable: (x: number, y: number) => this.#bridge.isWalkable(x, y),
      isEdible: (kind: string) => this.#bridge.isEdible(kind),
      waterAtHand: () => this.#bridge.waterAtHand(this.#agentId),
      nearestWater: (x: number, y: number) => this.#bridge.nearestWater(x, y),
      waterRefused: () => (this.#lastOutcome ?? '').includes('water'),
      nearestFood: (x: number, y: number) => this.#bridge.nearestFood(x, y),
      nearestSource: (kind: string, x: number, y: number) => this.#bridge.nearestSource(kind, x, y),
      nearestPerson: (x: number, y: number) => this.#bridge.nearestPerson(this.#agentId, x, y),
      nightWillBeCold: () => this.#bridge.nightWillBeCold(this.#agentId),
      distantWater: (x: number, y: number) => this.#bridge.distantWater(x, y),
    }
    const prose = perceptionToProse(
      packet,
      (detail) => {
        this.#llm.alert('prose', detail)
      },
      world,
    )
    // The prompt keeps another mouth's bytes out of the narrator's block; this mind's own
    // memory still holds the whole moment.
    const heard = heardProse(packet)
    const moment = heard.length > 0 ? `${prose} ${heard}` : prose
    this.#prevMomentSentences = appendMoment(this.#dayLog, this.#prevMomentSentences, moment)
    // Said in the same breath as what the eyes can reach, and NOT into the day log: what these
    // hands can make is a standing fact about the world, not something that happened today.
    const canMake = this.#bridge.makeables()
    const nowProse = [
      prose,
      makeablesLine(canMake, this.#bridge.groundForBuilding()),
      roadLine(canMake, packet, world),
      placesKnownLine(this.#bridge.knownPlaces(this.#agentId), packet),
      standingWallsLine(this.#bridge.unfinishedWork(this.#agentId)),
      stasisLine(this.#still, tick),
      absenceLine([...this.#company.values()], tick),
    ]
      .filter((p) => p.length > 0)
      .join(' ')

    // Retrieve BEFORE inserting this perception: a just-written row would win
    // recency and tag match, filling the scene with echoes of the present.
    const cues = cuesFromPacket(packet)
    const ambient = await retrieveAmbient(this.#mem!, cues, tick, this.#config.ambientK)

    await this.#mem!.insertMemory({
      tick,
      kind: 'perception',
      text: moment,
      importance: 3,
      tags: {
        people: packet.visible.agents.map((a) => a.name),
        place: cues.place,
        objects: [],
        topics: cues.topics,
      },
    })

    const blocks: PromptBlocks = {
      rulesOfBeing: RULES_OF_BEING,
      identity: this.#identity,
      personality: {
        doc: this.#personality.current().doc,
        autobiography: this.#mem!.autobiography(),
      },
      journal: this.#mem!.recentJournal(JOURNAL_LINES).map((e) => ({
        day: worldDay(e.tick),
        text: e.text,
      })),
      scene: { ledgers: this.#buildLedgers(cues.people), memories: ambient },
      dayLog: this.#dayLog,
      recalled: this.#pendingRecall,
      lastOutcome: this.#lastOutcome,
      now: { prose: nowProse, heard, said: this.#spoken },
      underway: this.#underway(),
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
        // Twice nothing leaves the turn UNSPENT: no invented thought, no turn counted. The
        // doze is the back-pressure, so a silent back end is not hammered.
        this.#llm.alert('blank_answer', 'two blank answers; the turn is left unspent')
        this.#doze(tick)
        return
      }
      const { raw, badText } = answer
      turn = await parseTurnWithRepair(
        raw,
        // A shape the schema refused comes back as the provider's own bytes; an act with
        // nothing in it parsed cleanly, so the answer itself is what goes back.
        (issues) =>
          this.#repair(assembled, badText.length > 0 ? badText : JSON.stringify(raw), issues),
        (kind, detail) => {
          this.#llm.alert(kind, detail)
        },
        (verb) => this.#bridge.actHasOneReading(this.#agentId, verb),
      )
    } catch (err) {
      this.#doze(tick, err)
      return
    }

    this.#clock.lastTurnTick = tick
    // What the answer produced, booked before the world sees it: a wait arrives here as act:null
    // and leaves no refusal, no event and no alert of its own (K26) — the shape run G read as
    // silence when a plan was already carrying the body.
    const acted = (turn.action ?? null) !== null
    const spoke = turnSpeaks(turn)
    this.#llm.noteTurnOutcome({
      acted,
      spoke,
      planContinued:
        !acted && !spoke && (this.#plan.lastResult === 'running' || (turn.plan?.length ?? 0) > 0),
    })
    // Read once: a cast back that has been answered is not answered again next turn, and a
    // refusal the mind has now been told about is not told twice.
    this.#pendingRecall = null
    this.#lastOutcome = null
    await this.#applyTurn(turn, tick, day)
    if (
      (turn.plan ?? undefined) === undefined &&
      (this.#plan.lastResult === 'done' || this.#plan.lastResult === 'blocked')
    ) {
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
        schema: TurnSchemaActionRequired,
        system: assembled.system,
        messages: assembled.messages,
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
        schema: TurnSchemaActionRequired,
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
    // Cast back BEFORE this turn's own thought is stored, or the asking answers itself.
    const recalled = turn.recall
      ? {
          query: turn.recall,
          memories: (await retrieveRecall(mem, turn.recall, tick)).map(promptText),
        }
      : null
    await mem.insertMemory({
      tick,
      kind: 'thought',
      text: turn.thought,
      importance: turn.importance,
      tags: EMPTY_TAGS,
    })
    this.#onThought?.({ tick, agentId: this.#agentId, text: turn.thought })

    // The beat is spent casting back: whatever else the answer carried is let go, plan aside.
    if (recalled !== null) {
      this.#pendingRecall = recalled
      const alsoCarried = [turn.speech, turn.action, turn.plan, turn.journal, turn.reconsider_at]
      if (alsoCarried.some((v) => (v ?? null) !== null)) {
        this.#llm.alert('recall_took_the_beat', 'the rest of the answer was let go')
      }
      return
    }

    // A turn that speaks or acts directly preempts whatever plan was running.
    if ((turn.speech ?? null) !== null || (turn.action ?? null) !== null) {
      if (this.#plan.lastResult === 'running') this.#plan.lastResult = 'idle'
      this.#clearPlanQueue()
    }

    if (turn.speech) {
      const said: Intent = { verb: 'speak', params: { text: turn.speech } }
      this.#noteAccepted(said, await this.#bridge.submit(this.#agentId, said))
    }

    if (turn.action) {
      // `experiment {description}` is the same door as freeform said the other
      // way round — CAPABILITIES offers both, so both reach the arbiter.
      const attempt =
        'freeform' in turn.action
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
      this.#plan.size = turn.plan.length
      this.#plan.lastResult = turn.plan.length > 0 ? 'running' : 'done'
      this.#planHeadInFlight = false
      this.#pumpPlan(this.#bridge.perception(this.#agentId).self.activity)
    }

    if (turn.journal) {
      mem.insertJournal(tick, day, turn.journal)
      await mem.insertMemory({
        tick,
        kind: 'journal',
        text: turn.journal,
        importance: turn.importance,
        tags: EMPTY_TAGS,
      })
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
        alert: (kind, detail) => {
          this.#llm.alert(kind, detail)
        },
      })
    } catch (err) {
      this.#llm.alert('reflection_failed', messageOf(err))
    }
    try {
      if (this.#dreamLlm !== null) {
        const dream = await rollDream({
          mem: this.#mem!,
          agentId: this.#agentId,
          day,
          llm: this.#dreamLlm,
          chance: this.#config.dreamChance,
        })
        if (dream.dreamed) this.#pendingDreamMood = dream.mood
      }
    } catch (err) {
      this.#llm.alert('dream_failed', messageOf(err))
    } finally {
      this.#reflectionInFlight = false
    }
  }

  #buildLedgers(people: string[]): { name: string; doc: string }[] {
    const out: { name: string; doc: string }[] = []
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

  // Node's default terminates the process on a rejection nobody holds, and this file starts
  // promises it does not await.
  #sink(kind: string): (err: unknown) => void {
    return (err) => {
      this.#llm.alert(kind, messageOf(err))
    }
  }

  #doze(tick: number, cause?: unknown): void {
    this.#stats.dozes += 1
    const why = cause === undefined ? 'providers unavailable' : messageOf(cause)
    this.#llm.alert('doze_off', `${why}; the mind dozes off mid-thought`)
    this.#clock.lastTurnTick = tick + this.#config.dozeTicks
    this.#clock.dozeUntilTick = tick + this.#config.dozeTicks
  }
}
