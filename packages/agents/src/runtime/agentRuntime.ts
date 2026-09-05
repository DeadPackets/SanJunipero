import {
  BOND_VALENCE,
  dayPhaseFromTick,
  decayWarmth,
  MINUTES_PER_DAY,
  namedParams,
  nightStartTick,
  REFLECTION_SETTLE_MS,
  type RosterEntry,
  sanitizeSpokenText,
  simTimeFromTick,
  stateHash,
  TICK_REAL_MS,
  verbPhraseGerund,
  verbPhrasePast,
  WANTS_DISCOVERING,
} from '@sj/shared'
import { NoObjectGeneratedError } from 'ai'
import type Database from 'better-sqlite3'
import type { CallBill, LlmClient } from '@sj/llm'
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
  heardKey,
  heardProse,
  makeablesLine,
  roadLine,
  doorstepLine,
  perceptionToProse,
  placesKnownLine,
  valleyExtentLine,
  absenceLine,
  type Company,
  gatheringLine,
  type ProseWorld,
  standingWallsLine,
  stasisLine,
  stillnessAt,
  wantLine,
  type Stillness,
  worldDay,
  type PerceptionPacket,
} from '../prompt/prose.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { PersonalityStore } from '../personality.js'
import { MemoryStore, type MemoryTags } from '../memory/store.js'
import { TIE_PHRASE, type TieStore } from '../memory/ties.js'
import { occasionsInPacket, WantStore, type WantBias, type WantOccasion } from '../memory/wants.js'
import { keywords, retrieveAmbient, retrieveRecall, type SceneCues } from '../memory/retrieve.js'
import { promptText } from '../memory/gist.js'
import {
  BODY_NOOPS,
  isBlankAnswer,
  parseTurnWithRepair,
  StrictTurnSchema,
  reconsiderTick,
  turnSpeaks,
  TURN_FIELDS,
  type Turn,
} from '../turn.js'
import {
  wakeReasons,
  disarmBodyAlarm,
  rearmBodyAlarm,
  DEFAULT_MIND_CONFIG,
  type MindClock,
  type MindConfig,
  type PlanState,
  type WakeReason,
} from '../wake.js'
import type { SceneCoordinator } from '../scene/coordinator.js'
import type { Scene } from '../scene/scene.js'
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

// Every mind asleep at dusk asked for its reflection in the same second, and one back end refused
// most of them. The whole spread stays inside REFLECTION_SETTLE_MS, so a town closing during it
// still waits out the last mind's ask rather than losing that night.
const REFLECTION_STAGGER_TICKS = Math.ceil(REFLECTION_SETTLE_MS / TICK_REAL_MS)

/** Which tick of the night this mind may begin reflecting on. Deterministic, so a mind that
 *  restarts mid-night keeps its place in the spread instead of drawing a new one. */
export function reflectionOffsetTicks(agentId: string): number {
  return Number.parseInt(stateHash(agentId).slice(0, 8), 16) % REFLECTION_STAGGER_TICKS
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

/** The mind's tie book and the closed roll a night may name. Absent, a mind reflects the way it
 *  did before there were ties. */
export type RuntimeTies = { store: TieStore; cast: () => readonly { id: string; name: string }[] }

const LET_GO_IMPORTANCE = 4

/** Two ties a person, on the turn that pays full price. What a pair holds past two is a scene's
 *  to read, and the scene already shows all of it. */
const TIES_SHOWN_PER_PERSON = 2

// Rendered at prose time and never written back into a stored ruling. Only a skill deficit
// earns it: a thing nobody can do teaches no one a false path.
export const CRAFT_HINT = ' — perhaps someone nearby knows the craft.'

// Engine-side words: a parameter schema spelled out in braces, or a registry name. Every
// other engine reason is the town's own sentence now and reaches the mind whole.
const MACHINE_REASON = /\{[^}]*\}|^(?:unknown verb:|no such agent)/

// A word for standing still, or one of the turn's own field names read off the list it was
// asked in: `plan` is a thing a mind writes, never a thing a body does.
function isBodyNoOp(reason: string, verb: string): boolean {
  return reason.startsWith('unknown verb:') && (BODY_NOOPS.has(verb) || TURN_FIELDS.has(verb))
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

/** The other half of the same sentence: what the hands did do. All 402 action memories the
 *  phase 1 gate wrote were refusals, so no mind held a trace of anything that worked. */
function actionMemoryText(verb: string): string {
  return `You have ${verbPhrasePast(verb)}.`
}

// What a finished act is worth on the mind's own one to ten. A refusal is 3, so most doing
// outranks most failing to; a wall raised is not a bucket filled, and neither is a walk.
const ACT_IMPORTANCE: Record<string, number> = {
  walk: 1,
  drop: 1,
  stow: 1,
  fill: 1,
  exit: 1,
  enter: 1,
  wake: 1,
  take: 2,
  drink: 2,
  stoke: 2,
  sleep: 2,
  read: 2,
  wear: 2,
  craft: 6,
  give: 6,
  tend: 6,
  inscribe: 6,
  build: 7,
  teach: 7,
}
const ORDINARY_ACT = 3
const REFUSAL_IMPORTANCE = 3

export function actImportance(verb: string): number {
  // A minted making is a making: `recipe:plank` is what `craft` was before the town had a word.
  return ACT_IMPORTANCE[verb] ?? (verb.startsWith('recipe:') ? ACT_IMPORTANCE.craft! : ORDINARY_ACT)
}

/** The same refusal, said to the next turn instead of only to the memory store. A reason that
 *  reached a memory row had to win retrieval to be seen, and mostly did not (rehearsal4 K20). */
export function lastTurnLine(what: string, reason: string): string {
  return `Last turn: ${what} did not take — ${sayable(reason)}.`
}

/** The other thing a turn can open with: not an act refused, but an act the body set down
 *  half-finished. A mind that woke standing empty-handed would otherwise never learn why. */
export function brokeOffLine(verb: string, why: string): string {
  return `Last turn: you broke off ${verbPhraseGerund(verb)} — ${sayable(why)}.`
}

/** The verb that takes a body's hands off what they are doing. */
const STOP = 'stop'

// What a body says to itself when it stops before it meant to. It never asked; the hands came
// off the work because the body was failing under it.
export const BODY_WOULD_NOT_GO_ON = 'your body would not carry it any further'

// The reasons `drink`, `fill` and `fish` are turned away by all name the water. Read off the
// rendered line, which is the one place a refusal survives into the next turn. An empty vessel
// names no water and is the same want: the road out of it runs to the bank either way.
export const wantedWater = (lastOutcome: string | null): boolean => {
  const said = lastOutcome ?? ''
  return said.includes('water') || /\bis empty\b/.test(said)
}

// A freeform intent has no verb to name, only the words the mind used.
export const TRIED_FREEFORM = 'what you tried'

// What a mind is told when the court could not be reached or the ruling could not be made law:
// no verb of the world's and no machinery word, only a try that did not begin.
export const CANNOT_BEGIN = 'you turn it over and cannot begin it now'

// A refusal with a context-dependent class is never short-circuited by precedent, so the same
// ask every turn would be a full ruling every turn. Inside this window the mind's own refusal
// answers, silently: no call, no new memory.
export const REFUSAL_MEMORY_TICKS = 240
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

// The spoken reason behind a discovery is the mind's own words for the attempt, reported as
// "he said he would <saying>": first person stripped, flattened as speech is, and short.
const SAYING_MAX_CHARS = 120
function spokenReason(intent: string): string {
  const said = sanitizeSpokenText(intent)
    .replace(/^i (?:try|want|attempt|mean|am going) to /i, '')
    .replace(/^i (?:will |shall )?/i, '')
    .replace(/[.!]+$/, '')
  return said.length <= SAYING_MAX_CHARS ? said : said.slice(0, SAYING_MAX_CHARS).trimEnd()
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
/** One remembered key and what it stood for, in a shape that survives a JSON round trip. */
type Remembered = [string, { tick: number; reason: string }]

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
  /** The scene this mind is standing in, if any. Every participant carries the whole thing, and
   *  a restore keys it by id, so one scene comes back once however many minds saved it. */
  scene?: Scene | null | undefined
  /** What the court has already refused, and the sentences the mind already carries. Absent,
   *  a resume buys a ruling it had already paid for and writes a memory it already holds. */
  refused?: Remembered[] | undefined
  held?: Remembered[] | undefined
  /** The utterances counted toward warmth last tick, and the ones already told. Absent, every
   *  word still inside the recent window is credited and read as news a second time. */
  heardKeys?: string[] | undefined
  heardTold?: string[] | undefined
  /** When the heap on this mind's own doorstep was last named. */
  doorstepSaidTick?: number | null | undefined
}

function freshClock(): MindClock {
  return {
    lastTurnTick: null,
    reconsiderAtTick: null,
    dozeUntilTick: 0,
    alarmArmed: {},
    morningWokeDay: null,
    gatheringDay: null,
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
  readonly #scenes: SceneCoordinator | null
  readonly #ties: RuntimeTies | null
  readonly #wantBias: WantBias
  readonly #partners: ReadonlySet<string>
  #adjudicator: Adjudicator | null
  #codify: Codifier | null = null
  #roster: (() => RosterEntry[]) | null = null
  #customs: (() => readonly string[]) | null = null
  #frontier: (() => readonly string[]) | null = null

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
  // What this mind has already been refused, when, and why. Read before the god is asked again.
  #refusedIntents = new Map<string, { tick: number; reason: string }>()
  // The sentences the mind already carries, so one thing that happened is written down once.
  // Its own budget: an act writes one of these every turn, and a precedent is rare and dear.
  #heldTexts = new Map<string, { tick: number; reason: string }>()
  // How far down the world's log this mind has read its own finished acts.
  #lastActSeq = 0
  // The thought behind the act now in flight. The god is shown it; the precedent key is not.
  #lastThought = ''
  #stats = { turns: 0, dozes: 0, reflections: 0 }
  #reflectedNight: number | null = null
  // The night this mind has actually finished writing down. `#reflectedNight` is latched before
  // the seven calls begin, so only this one may reach a checkpoint.
  #nightWritten: number | null = null
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
  // When the heap on this mind's own doorstep was last named. Null until it ever is.
  #doorstepSaidTick: number | null = null
  // Who this mind has been with and how warm the tie stood when they last parted. The engine
  // keeps no bonds and the gateway folds a log no mind can read, so a mind's own tie is folded
  // here — out of the one act perception can witness, which is a word. Warmth is carried
  // forward to `lastSeenTick` and no further: a tie does not cool for want of company.
  #company = new Map<string, Company>()
  // Last tick's utterances. The recent window holds one for as long as it is recent, so only a
  // key that was not there a tick ago is a new word rather than the same word again.
  #heardKeys = new Set<string>()
  // Every utterance this mind has already been told about, on the same reasoning: what the last
  // turn read is not news on this one.
  #heardTold = new Set<string>()
  #wasNight = false
  #started = false
  #offTick: ((tick: number) => void) | null = null
  #wants: WantStore | null = null
  // How many places this mind knew, and how many of them carry its own name, when it last
  // looked. Null until the first look, or a resume would read its whole map as new ground.
  #knownPlaceCount: number | null = null
  #namedForMeCount: number | null = null

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
    /** The world's one scene coordinator. Absent, a mind talks the way it always did. */
    scenes?: SceneCoordinator | undefined
    ties?: RuntimeTies | undefined
    /** How much faster than everybody else this mind feels a want, off its voice card. */
    wantBias?: WantBias | undefined
    /** Whoever this mind is partnered to. A talk one of them is in feeds affection. */
    partners?: readonly string[] | undefined
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
    this.#scenes = deps.scenes ?? null
    this.#ties = deps.ties ?? null
    this.#wantBias = deps.wantBias ?? {}
    this.#partners = new Set(deps.partners ?? [])
  }

  start(agentId: string): void {
    if (this.#started) this.stop()
    this.#agentId = agentId
    this.#mem = new MemoryStore(this.#db, agentId, this.#embedder)
    this.#wants = new WantStore(this.#db, agentId, this.#wantBias)
    this.#wants.begin(this.#bridge.currentTick())
    this.#knownPlaceCount = null
    this.#namedForMeCount = null
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
    this.#nightWritten = null
    this.#pendingDreamMood = null
    this.#pendingRecall = null
    this.#lastOutcome = null
    this.#spoken = []
    this.#still = null
    this.#company = new Map()
    this.#heardKeys = new Set()
    this.#heardTold = new Set()
    this.#refusedIntents = new Map()
    this.#heldTexts = new Map()
    this.#doorstepSaidTick = null
    this.#wasNight = simTimeFromTick(this.#bridge.currentTick()).isNight
    // From here forward only: a mind that resumes must not remember a day it was not there for.
    this.#lastActSeq = this.#bridge.lastSeq()
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
      reflectedNight: this.#nightWritten,
      wasNight: this.#wasNight,
      pendingDreamMood: this.#pendingDreamMood,
      pendingRecall: this.#pendingRecall,
      lastOutcome: this.#lastOutcome,
      spoken: [...this.#spoken],
      still: this.#still,
      company: [...this.#company].map(([id, c]) => ({ id, ...c })),
      scene: this.#scenes?.sceneFor(this.#agentId) ?? null,
      refused: [...this.#refusedIntents].map(([k, v]) => [k, { ...v }]),
      held: [...this.#heldTexts].map(([k, v]) => [k, { ...v }]),
      heardKeys: [...this.#heardKeys],
      heardTold: [...this.#heardTold],
      doorstepSaidTick: this.#doorstepSaidTick,
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
    this.#nightWritten = s.reflectedNight
    this.#wasNight = s.wasNight
    this.#pendingDreamMood = s.pendingDreamMood
    this.#pendingRecall = s.pendingRecall ?? null
    this.#lastOutcome = s.lastOutcome ?? null
    this.#spoken = [...(s.spoken ?? [])]
    this.#still = s.still ?? null
    this.#company = new Map((s.company ?? []).map(({ id, ...c }) => [id, { ...c }]))
    this.#refusedIntents = new Map((s.refused ?? []).map(([k, v]) => [k, { ...v }]))
    this.#heldTexts = new Map((s.held ?? []).map(([k, v]) => [k, { ...v }]))
    this.#heardKeys = new Set(s.heardKeys ?? [])
    this.#heardTold = new Set(s.heardTold ?? [])
    this.#doorstepSaidTick = s.doorstepSaidTick ?? null
    this.#scenes?.adopt(s.scene)
  }

  // Post-construction wiring: the supervisor builds the arbiter after
  // the minds. Called through `wireArbiter`.
  useArbiter(arbiter: SeamArbiter): void {
    this.#adjudicator = arbiter.adjudicate
    this.#codify = arbiter.codify
    this.#roster = arbiter.roster ?? null
    this.#customs = arbiter.customs ?? null
    this.#frontier = arbiter.frontier ?? null
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

  /** How warm this mind stands toward another. The only tie the runtime keeps itself, and what
   *  breaks a tie for the floor when two people have said the same amount. */
  warmthToward(otherId: string): number {
    return this.#company.get(otherId)?.warmth ?? 0
  }

  #onTick(tick: number): void {
    if (!this.#started) return
    // `intent.ts` refuses the dead every verb, so a corpse that still woke spent its turn on a
    // refusal, read that back as a blocked plan, and woke again: 768 billed turns in world one.
    if (!this.#bridge.isAlive(this.#agentId)) {
      this.stop()
      return
    }
    const packet = this.#bridge.perception(this.#agentId)
    // A night in bed is not an afternoon spent standing, and neither is a house going up: a
    // pair of hands still on a job is not a pair of hands with nothing to do.
    const working = packet.self.activity !== null && packet.self.activity !== 'walk'
    this.#still =
      packet.self.asleep || working
        ? null
        : stillnessAt(this.#still, packet.self.x, packet.self.y, tick)
    this.#noteCompany(packet, tick)
    this.#noteFinishedActs()
    this.#feedWants(packet, tick)
    rearmBodyAlarm(this.#config, packet.self.body, this.#clock)
    void this.#submitPendingIfIdle(packet.self.activity).catch(this.#sink('submit_crash'))
    this.#pumpPlan(packet.self.activity)
    this.#answerWakeOwed(packet)
    this.#scenes?.onTick(tick)
    this.#handleNight(tick, packet)
    // Morning is consumed by an actual rise, not by the reason firing: a body
    // seen awake in daylight has had its morning.
    if (!packet.self.asleep && !packet.time.isNight) {
      this.#clock.morningWokeDay = Math.floor(tick / MINUTES_PER_DAY)
    }
    if (this.#turnInFlight) return
    const scene = this.#scenes?.sceneFor(this.#agentId) ?? null
    const floor = { inScene: scene !== null, holdsFloor: scene?.floor === this.#agentId }
    // Read only at dusk: it is a query per mind per tick, and the gathering rung is the one
    // thing that reads it.
    const belonging =
      dayPhaseFromTick(tick) === 'dusk' ? (this.#wants?.levelOf('belonging', tick) ?? 0) : 0
    const wake = wakeReasons(this.#config, packet, this.#clock, tick, this.#plan, floor, belonging)
    const reason = wake[0] ?? null
    if (reason === 'reconsider') this.#clock.reconsiderAtTick = null
    if (reason === 'floor') {
      void this.#takeFloor(tick)
      return
    }
    // The body's own reflex, and it costs the mind nothing. The legs are left out of it: a walk
    // is how a hungry body reaches food, so breaking one off takes the road away too.
    if (reason === 'body_alarm' && working) this.#breakOff(packet.self.activity!)
    // A mouth mid-sentence is hands at work: the same alarm takes this mind out of the talk. The
    // others keep it, and it ends only where too few of them are left to answer each other.
    if (reason === 'body_alarm' && floor.holdsFloor) this.#scenes?.leave(this.#agentId, tick)
    if (reason !== null) {
      // Latched on the turn, not on the reason: a dusk the mind was never billed for is a dusk
      // it has not had.
      if (wake.includes('gathering')) this.#clock.gatheringDay = Math.floor(tick / MINUTES_PER_DAY)
      if (packet.self.asleep) {
        this.#wakeOwed = true
        this.#clock.wakeRetryAtTick = tick + this.#config.wakeRetryTicks
      }
      void this.#startTurn(wake)
    }
  }

  // The hands come off the work now; the turn that follows is the alarm's, and opens by saying
  // what happened, so the mind is never left to guess why it is standing with nothing in hand.
  #breakOff(verb: string): void {
    this.#lastOutcome = brokeOffLine(verb, BODY_WOULD_NOT_GO_ON)
    void this.#bridge.submit(this.#agentId, { verb: STOP, params: {} })
  }

  // A scene line, under the same in-flight guard an ordinary turn runs under, so a mind never
  // holds two moments at once. What it costs is one call, and only the floor-holder makes it.
  async #takeFloor(tick: number): Promise<void> {
    if (this.#turnInFlight || this.#scenes === null) return
    this.#turnInFlight = true
    try {
      await this.#scenes.takeFloor(this.#agentId, tick)
      this.#clock.lastTurnTick = tick
      this.#stats.turns += 1
    } catch (err) {
      this.#llm.alert('scene_crash', messageOf(err))
      this.#doze(tick, err)
    } finally {
      this.#turnInFlight = false
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
    if (activity === null || this.#plan.queue[0]?.verb === STOP) {
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
      const key = heardKey(h)
      keys.add(key)
      const them = met(h.speakerId, h.name)
      // The window holds one utterance for as long as it is recent, so only a key that was not
      // there a tick ago is a new word rather than the same word again.
      if (!this.#heardKeys.has(key)) them.warmth += BOND_VALENCE.friend
    }
    this.#heardKeys = keys
  }

  /** Everything this tick answered a want with. Feeding is idempotent — it sets the want back
   *  to nothing — so a talk that runs an hour keeps belonging at nothing for that hour. */
  #feedWants(packet: PerceptionPacket, tick: number): void {
    const fed = new Set<WantOccasion>(occasionsInPacket(packet, this.#identity.name))
    const scene = this.#scenes?.sceneFor(this.#agentId) ?? null
    if (scene !== null) {
      fed.add('scene')
      if (scene.participants.some((id) => id !== this.#agentId && this.#partners.has(id)))
        fed.add('partner_scene')
    }
    if (this.#bridge.expressedAt(this.#agentId).length > 0) fed.add('expressed_at')
    const places = this.#bridge.knownPlaces(this.#agentId)
    const named = places.filter((p) => p.name?.includes(this.#identity.name) === true).length
    if (this.#knownPlaceCount !== null && places.length > this.#knownPlaceCount)
      fed.add('new_place')
    if (this.#namedForMeCount !== null && named > this.#namedForMeCount) fed.add('named_building')
    this.#knownPlaceCount = places.length
    this.#namedForMeCount = named
    if (fed.size > 0) this.#book(() => this.#wants?.feed(fed, tick))
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
        // A word anyone heard, said by a mind in no scene, is a scene starting.
        this.#scenes?.noteSpoken(this.#agentId, text, this.#bridge.currentTick())
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
    // `stop` is the one act aimed AT the hands rather than done with them: holding it until they
    // come free is holding it until the very thing it means to end is over.
    if (activity !== null && this.#pendingIntent.verb !== STOP) return Promise.resolve()
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
        if (this.#reroutesToTheCourt(res.reason)) {
          void this.#adjudicateFreeform(humanizeIntent(intent.verb, intent.params), false).catch(
            this.#sink('adjudicate_crash'),
          )
          return
        }
        this.#recordRefusal(intent.verb, res.reason)
      })
      .then(() => undefined)
  }

  // A proposal, not a mistake, re-enters the turn as freeform words: a verb the registry has no
  // word for, or a name the town has no concept of — an unbuildable kind, an unknown recipe,
  // crop or skill. A refusal about a mark that merely missed is neither, and is recorded.
  // Once per turn, or an unwired arbiter would loop on itself.
  #reroutesToTheCourt(reason: string): boolean {
    const proposes = reason.startsWith('unknown verb:') || reason.includes(WANTS_DISCOVERING)
    if (!proposes) return false
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

  // A try at something new goes to the arbiter, not to the verb registry. An unreachable
  // arbiter must never eat the turn, and never reach the mind in its own words either: the
  // try simply did not begin. `said` is whether the words are the mind's own (freeform, or an
  // experiment's description) rather than a verb flattened on its way back from the world.
  async #adjudicateFreeform(description: string, said: boolean): Promise<void> {
    const fallback = (): void => {
      this.#lastOutcome = lastTurnLine(TRIED_FREEFORM, CANNOT_BEGIN)
    }
    const refused = this.#refusedIntents.get(sameIntent(description))
    if (refused !== undefined && this.#bridge.currentTick() - refused.tick < REFUSAL_MEMORY_TICKS) {
      this.#lastOutcome = lastTurnLine(TRIED_FREEFORM, refused.reason)
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
      fallback()
      return
    }
    if (verdict.kind === 'map')
      return this.#holdIntent({ verb: verdict.verb, params: namedParams(verdict.params) })
    if (verdict.kind === 'impossible') {
      this.#rememberRefusal(description, verdict.reason)
      this.#lastOutcome = lastTurnLine(TRIED_FREEFORM, verdict.reason)
      await this.#writeActionMemory(refusalMemoryText(verdict.reason, verdict.class))
      return
    }
    // Adjudicate once, physics forever.
    if (this.#codify === null) {
      fallback()
      return
    }
    let verb: string
    try {
      verb = this.#codify(verdict, {
        agentId: this.#agentId,
        intent: description,
        ...(said ? { saying: spokenReason(description) } : {}),
      }).verb
    } catch (err) {
      this.#llm.alert('codify_failed', messageOf(err))
      fallback()
      return
    }
    // One moment answers two wants: the town credits this mind with the word, and keeps it.
    this.#book(() =>
      this.#wants?.feed(['discovery_credit', 'verb_codified'], this.#bridge.currentTick()),
    )
    return this.#holdIntent({ verb, params: {} })
  }

  #rememberRefusal(description: string, reason: string): void {
    this.#remember(this.#refusedIntents, sameIntent(description), reason)
  }

  #remember(
    into: Map<string, { tick: number; reason: string }>,
    key: string,
    reason: string,
  ): void {
    into.delete(key)
    into.set(key, { tick: this.#bridge.currentTick(), reason })
    // Insertion-ordered, so the first key is the oldest.
    while (into.size > REFUSAL_MEMORY_SIZE) into.delete(into.keys().next().value!)
  }

  /** Whether this mind already carries this sentence from inside the refusal window. kamal
   *  stored 87 action memories with 9 texts between them, and every copy competed in retrieval. */
  #alreadyHeld(text: string): boolean {
    const key = sameIntent(text)
    const held = this.#heldTexts.get(key)
    if (held !== undefined && this.#bridge.currentTick() - held.tick < REFUSAL_MEMORY_TICKS)
      return true
    this.#remember(this.#heldTexts, key, text)
    return false
  }

  // Every act the world finished for this body since the last look. The refusals were always
  // written; this is the other half, so a mind holds a trace of what worked.
  #noteFinishedActs(): void {
    for (const done of this.#bridge.completedSince(this.#agentId, this.#lastActSeq)) {
      this.#lastActSeq = done.seq
      // Being taught from is the plainest way a mind is relied on, and the teacher is the only
      // one of the two who can see it happen.
      if (done.verb === 'teach')
        this.#book(() => this.#wants?.feed(['taught'], this.#bridge.currentTick()))
      void this.#writeActionMemory(actionMemoryText(done.verb), actImportance(done.verb)).catch(
        this.#sink('memory_write_failed'),
      )
    }
  }

  #onPlanHeadResult(res: SubmitResult, head: Intent): void {
    this.#noteAccepted(head, res)
    // A head answered after the turn replaced the plan speaks for a queue that is gone: reading
    // it would wipe the plan the mind just paid for.
    if (this.#plan.queue[0] !== head) return
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
    if (this.#reroutesToTheCourt(res.reason)) {
      void this.#adjudicateFreeform(humanizeIntent(head.verb, head.params), false).catch(
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
      // A mind that never lay down still lived the day. The night is over either way, and a day
      // nobody wrote down is a day the mind never gets back.
      const owed = nightOf(tick - 1)
      if (owed >= 0 && this.#reflectedNight !== owed) void this.#runNight(owed)
      if (this.#pendingDreamMood !== null) {
        const cur = this.#personality.current().doc.current
        this.#personality.updateCurrent({ ...cur, mood: this.#pendingDreamMood })
        this.#pendingDreamMood = null
      }
      this.#dayLog = []
      this.#prevMomentSentences = new Set()
    }
    if (
      isNight &&
      packet.self.asleep &&
      tick - nightStartTick(tick) >= reflectionOffsetTicks(this.#agentId)
    ) {
      const night = nightOf(tick)
      if (night >= 0 && this.#reflectedNight !== night) void this.#runNight(night)
    }
    this.#wasNight = isNight
  }

  async #startTurn(wake: readonly WakeReason[]): Promise<void> {
    if (this.#turnInFlight) return
    this.#turnInFlight = true
    const tick = this.#bridge.currentTick()
    try {
      await this.#runTurnBody(wake)
    } catch (err) {
      this.#llm.alert('turn_crash', messageOf(err))
      this.#clock.lastTurnTick = tick + this.#config.dozeTicks
      this.#clock.dozeUntilTick = tick + this.#config.dozeTicks
    } finally {
      this.#turnInFlight = false
    }
  }

  async #runTurnBody(wake: readonly WakeReason[]): Promise<void> {
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
      waterRefused: () => wantedWater(this.#lastOutcome),
      nearestFood: (x: number, y: number) => this.#bridge.nearestFood(x, y),
      nearestSource: (kind: string, x: number, y: number) => this.#bridge.nearestSource(kind, x, y),
      nearestPerson: (x: number, y: number) => this.#bridge.nearestPerson(this.#agentId, x, y),
      nightWillBeCold: () => this.#bridge.nightWillBeCold(this.#agentId),
      distantWater: (x: number, y: number) => this.#bridge.distantWater(x, y),
      extent: () => this.#bridge.extent(),
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
    const heard = heardProse(packet, this.#heardTold)
    // Rebuilt from the window, so a key that has aged out of it is gone from here too.
    this.#heardTold = new Set(packet.heard.map(heardKey))
    const moment = heard.length > 0 ? `${prose} ${heard}` : prose
    this.#prevMomentSentences = appendMoment(this.#dayLog, this.#prevMomentSentences, moment)
    // Said in the same breath as what the eyes can reach, and NOT into the day log: what these
    // hands can make is a standing fact about the world, not something that happened today.
    const canMake = this.#bridge.makeables()
    const doorstep = doorstepLine(packet, this.#doorstepSaidTick)
    if (doorstep.length > 0) this.#doorstepSaidTick = tick
    const nowProse = [
      prose,
      makeablesLine(canMake, this.#bridge.groundForBuilding()),
      roadLine(canMake, packet, world),
      valleyExtentLine(world),
      placesKnownLine(this.#bridge.knownPlaces(this.#agentId), packet),
      standingWallsLine(this.#bridge.unfinishedWork(this.#agentId)),
      doorstep,
      stasisLine(this.#still, tick),
      absenceLine([...this.#company.values()], tick),
      gatheringLine(packet, tick),
      wantLine(wake.includes('morning') ? (this.#wants?.top(tick) ?? null) : null),
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
      ...(this.#roster === null ? {} : { roster: this.#roster() }),
      ...(this.#customs === null ? {} : { customs: this.#customs() }),
      ...(this.#frontier === null ? {} : { frontier: this.#frontier() }),
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
    // Steps still queued from the plan this call may be about to replace: what a paid call
    // throws away is only visible against what was already running.
    const priorStepsLeft = this.#plan.queue.length

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
      const bill: CallBill = {
        wakeReason: wake[0] ?? null,
        wakeReasons: wake,
        blockTokens: { ...assembled.blockTokens, _priorStepsLeft: priorStepsLeft },
      }
      let answer = await this.#ask(assembled, bill)
      // A blank answer is not a wrong answer. There is nothing to correct, so the honest
      // retry is the same request again — byte-identical, and so still a cached prefix.
      if (isBlankAnswer(answer.raw)) answer = await this.#ask(assembled, bill)
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
          this.#repair(assembled, badText.length > 0 ? badText : JSON.stringify(raw), issues, bill),
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
    // The ledger must never cost the world a turn it has already paid for: a busy database here
    // would throw the mind's answer away between the model and the act.
    this.#book(() => {
      this.#llm.noteCallBill({ _planSize: turn.plan?.length ?? 0 })
      this.#llm.noteTurnOutcome({
        acted,
        spoke,
        planContinued:
          !acted && !spoke && (this.#plan.lastResult === 'running' || (turn.plan?.length ?? 0) > 0),
      })
    })
    // Read once: a cast back that has been answered is not answered again next turn, and a
    // refusal the mind has now been told about is not told twice.
    this.#pendingRecall = null
    this.#lastOutcome = null
    // The body died while the provider was thinking. The call is paid for and booked; a corpse
    // still acts on nothing, thinks out loud to nobody and writes in no book.
    if (!this.#started) return
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
  async #ask(
    assembled: AssembledPrompt,
    bill: CallBill,
  ): Promise<{ raw: unknown; badText: string }> {
    try {
      const { value } = await this.#llm.object({
        schema: StrictTurnSchema,
        system: assembled.system,
        messages: assembled.messages,
        bill,
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
  async #repair(
    assembled: AssembledPrompt,
    badText: string,
    issues: string,
    bill: CallBill,
  ): Promise<unknown> {
    try {
      const { value } = await this.#llm.object({
        schema: StrictTurnSchema,
        system: assembled.system,
        messages: [
          ...assembled.messages,
          { role: 'assistant', content: badText.length > 0 ? badText : '…' },
          { role: 'user', content: `Your answer was rejected. Fix it:\n${issues}` },
        ],
        bill,
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
        await this.#adjudicateFreeform(attempt, true)
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

  /** A tie nothing has fed for seven sim-days closes, and the mind remembers letting it go. It
   *  costs no call, so a night with no reflection in it still lets go. */
  async #letGoOfStaleTies(): Promise<void> {
    const ties = this.#ties
    if (ties === null) return
    const tick = this.#bridge.currentTick()
    try {
      for (const t of ties.store.letGo(tick)) {
        const who = this.#bridge.agentFacts(t.personId)?.name ?? t.personId
        // Witnessed, folded to nothing: the bond graph reads it off the log, and a promise
        // nobody ever settled is the only producer `promise_broken` has.
        this.#bridge.announce('tie_let_go', {
          agentId: this.#agentId,
          personId: t.personId,
          kind: t.kind,
        })
        await this.#mem!.insertMemory({
          tick,
          kind: 'reflection',
          text: `You have let go of what stood between you and ${who}: ${t.text}`,
          importance: LET_GO_IMPORTANCE,
          tags: { ...EMPTY_TAGS, people: [who] },
        })
      }
    } catch (err) {
      this.#llm.alert('tie_let_go_failed', messageOf(err))
    }
  }

  async #runNight(day: number): Promise<void> {
    if (this.#reflectedNight === day) return
    this.#reflectedNight = day
    await this.#letGoOfStaleTies()
    if (this.#reflectionLlm === null) {
      this.#nightWritten = day
      return
    }
    this.#stats.reflections += 1
    this.#reflectionInFlight = true
    const ties = this.#ties
    try {
      await runSleepReflection({
        mem: this.#mem!,
        personality: this.#personality,
        llm: this.#reflectionLlm,
        day,
        ...(ties === null
          ? {}
          : { ties: { store: ties.store, cast: ties.cast(), tick: this.#bridge.currentTick() } }),
        alert: (kind, detail) => {
          this.#llm.alert(kind, detail)
        },
      })
    } catch (err) {
      this.#llm.alert('reflection_failed', messageOf(err))
    }
    this.#nightWritten = day
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

  /** What this mind holds about the people it can see, keyed by the name the ledger is keyed by.
   *  It rides the "people here" line because that line changes when somebody arrives, not every
   *  turn: a tie sits inside the prefix the cache keeps, above the memories that do change. */
  #tiesByName(): Map<string, string> {
    const ties = this.#ties
    if (ties === null) return new Map()
    const nameOf = new Map(ties.cast().map((p) => [p.id, p.name]))
    const held = new Map<string, string[]>()
    for (const t of ties.store.open()) {
      const name = nameOf.get(t.personId)
      if (name === undefined) continue
      const rows = held.get(name) ?? []
      if (rows.length < TIES_SHOWN_PER_PERSON) rows.push(`${TIE_PHRASE[t.kind]} — ${t.text}`)
      held.set(name, rows)
    }
    return new Map([...held].map(([name, rows]) => [name, `Between you: ${rows.join('; ')}.`]))
  }

  #buildLedgers(people: string[]): { name: string; doc: string }[] {
    const ties = this.#tiesByName()
    const out: { name: string; doc: string }[] = []
    for (const person of people) {
      const doc = [this.#mem!.getLedger(person)?.doc ?? '', ties.get(person) ?? '']
        .filter((p) => p.length > 0)
        .join(' ')
      if (doc.length > 0) out.push({ name: person, doc })
    }
    return out
  }

  // A sentence the mind is already carrying is not written again: nine texts in eighty-seven
  // rows is eight-odd copies competing in retrieval for one thing that happened.
  /** Bookkeeping around a turn the town has already been billed for. A method the client never
   *  grew is a type error now, so what is left here is a database too busy to write. */
  #book(write: () => void): void {
    try {
      write()
    } catch (err) {
      this.#llm.alert('ledger_write_failed', messageOf(err))
    }
  }

  #writeActionMemory(text: string, importance = REFUSAL_IMPORTANCE): Promise<number | null> {
    if (this.#alreadyHeld(text)) return Promise.resolve(null)
    return this.#mem!.insertMemory({
      tick: this.#bridge.currentTick(),
      kind: 'action',
      text,
      importance,
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
