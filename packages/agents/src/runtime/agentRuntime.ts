import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { NoObjectGeneratedError } from 'ai'
import type Database from 'better-sqlite3'
import type { LlmClient } from '../llm/client.js'
import type { IdentityCore, AssembledPrompt, PromptBlocks } from '../prompt/assemble.js'
import { assemblePrompt, compactDayLog } from '../prompt/assemble.js'
import { perceptionToProse, type PerceptionPacket } from '../prompt/prose.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { PersonalityStore } from '../personality.js'
import { MemoryStore, type MemoryTags } from '../memory/store.js'
import { keywords, retrieveAmbient, type SceneCues } from '../memory/retrieve.js'
import { parseTurnWithRepair, reconsiderTick, TurnSchema, type Turn } from '../turn.js'
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

function freshClock(): MindClock {
  return {
    lastTurnTick: 0,
    reconsiderAtTick: null,
    conversationUntilTick: 0,
    dozeUntilTick: 0,
    alarmArmed: { hunger: true, energy: true, warmth: true },
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
    rearmBodyAlarm(this.#config, packet.self.body.needs, this.#clock)
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
      void this.#bridge.submit(this.#agentId, head, (res) => this.#onPlanHeadResult(res))
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
        void this.#writeActionMemory(`You realize you cannot: ${res.reason}`)
      })
      .then(() => undefined)
  }

  #onPlanHeadResult(res: SubmitResult): void {
    if (res.ok) return
    this.#plan.lastResult = 'blocked'
    this.#plan.queue = []
    this.#planHeadInFlight = false
    void this.#writeActionMemory(`You realize you cannot: ${res.reason}`)
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
    const tick = this.#bridge.currentTick()
    const packet = this.#bridge.perception(this.#agentId)
    const day = Math.floor(tick / MINUTES_PER_DAY)

    const prose = perceptionToProse(packet, (detail) => this.#llm.alert('prose', detail), {
      isWalkable: (x, y) => this.#bridge.isWalkable(x, y),
      isEdible: (kind) => this.#bridge.isEdible(kind),
    })
    this.#dayLog.push(prose)

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
      now: { prose },
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
      let raw: unknown
      let badText = ''
      try {
        raw = (await this.#llm.object({ schema: TurnSchema, system: assembled.system, messages: assembled.messages })).value
      } catch (err) {
        if (!NoObjectGeneratedError.isInstance(err)) throw err
        badText = err.text ?? ''
        raw = jsonOrRaw(badText)
      }
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
    if (turn.plan === undefined && (this.#plan.lastResult === 'done' || this.#plan.lastResult === 'blocked')) {
      this.#plan.lastResult = 'idle'
    }
    this.#stats.turns += 1
    disarmBodyAlarm(this.#config, packet.self.body.needs, this.#clock)
    this.#clock.prevVisibleIds = packet.visible.agents.map((a) => a.id)
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
    await mem.insertMemory({ tick, kind: 'thought', text: turn.thought, importance: turn.importance, tags: EMPTY_TAGS })

    // A turn that speaks or acts directly preempts whatever plan was running.
    if (turn.speech !== undefined || turn.action !== undefined) {
      if (this.#plan.lastResult === 'running') this.#plan.lastResult = 'idle'
      this.#plan.queue = []
      this.#planHeadInFlight = false
    }

    if (turn.speech) {
      await this.#bridge.submit(this.#agentId, { verb: 'speak', params: { text: turn.speech } })
    }

    if (turn.action) {
      const intent: Intent =
        'freeform' in turn.action
          ? { verb: 'experiment', params: { description: turn.action.freeform } }
          : { verb: turn.action.verb, params: turn.action.params }
      // Held until the body is free; a busy rejection retries instead of
      // discarding, until accepted or superseded by a newer turn's action.
      this.#pendingIntent = intent
      await this.#submitPendingIfIdle(this.#bridge.perception(this.#agentId).self.activity)
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
      this.#clock.lastTurnTick += this.#config.journalTicks
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
      await runSleepReflection({ mem: this.#mem!, personality: this.#personality, llm: this.#reflectionLlm, day })
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
