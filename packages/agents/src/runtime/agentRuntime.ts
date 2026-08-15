import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
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
import { decideWake, DEFAULT_MIND_CONFIG, type MindClock, type MindConfig, type PlanState, type WakeReason } from '../wake.js'
import { runSleepReflection, type ReflectionLlm } from '../reflection.js'
import { rollDream, type DreamLlm } from '../dream.js'
import type { EngineBridge } from './bridge.js'

const COMPACTION_SYSTEM = 'Your mind wanders back over the day…'

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
  #clock: MindClock = { lastTurnTick: 0, reconsiderAtTick: null, conversationUntilTick: 0, prevNeeds: null, prevVisibleIds: [] }
  #plan: PlanState = { queue: [], lastResult: 'idle' }
  #planHeadInFlight = false
  #turnInFlight = false
  #stats = { turns: 0, dozes: 0, reflections: 0 }
  #reflectedDay: number | null = null
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
    this.#clock = { lastTurnTick: 0, reconsiderAtTick: null, conversationUntilTick: 0, prevNeeds: null, prevVisibleIds: [] }
    this.#plan = { queue: [], lastResult: 'idle' }
    this.#planHeadInFlight = false
    this.#turnInFlight = false
    this.#stats = { turns: 0, dozes: 0, reflections: 0 }
    this.#reflectedDay = null
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
  }

  stats(): RuntimeStats {
    return { ...this.#stats, costUsd: this.#llm.totalCostUsd() }
  }

  // Observability for tests: the current day's perception log (prompt block 5).
  dayLogSnapshot(): readonly string[] {
    return [...this.#dayLog]
  }

  #onTick(tick: number): void {
    if (!this.#started) return
    const packet = this.#bridge.perception(this.#agentId)
    this.#advancePlan(packet)
    if (packet.heard.length > 0) {
      this.#clock.conversationUntilTick = tick + this.#config.conversationWindowTicks
    }
    this.#handleNight(tick, packet)
    if (this.#turnInFlight) return
    const reason = decideWake(this.#config, packet, this.#clock, tick, this.#plan)
    if (reason === 'reconsider') this.#clock.reconsiderAtTick = null
    if (reason !== null) void this.#startTurn(reason)
  }

  #advancePlan(packet: PerceptionPacket): void {
    if (!this.#planHeadInFlight || this.#plan.lastResult !== 'running') return
    if (packet.self.activity !== null) return
    this.#plan.queue.shift()
    this.#planHeadInFlight = false
    if (this.#plan.queue.length === 0) {
      this.#plan.lastResult = 'done'
    } else {
      this.#submitPlanHead()
    }
  }

  #submitPlanHead(): void {
    if (this.#plan.lastResult !== 'running' || this.#plan.queue.length === 0) {
      if (this.#plan.lastResult === 'running') this.#plan.lastResult = 'done'
      return
    }
    this.#planHeadInFlight = true
    const head = this.#plan.queue[0]!
    void this.#bridge.submit(this.#agentId, head).then((res) => {
      if (res.ok) return
      this.#plan.lastResult = 'blocked'
      this.#plan.queue = []
      this.#planHeadInFlight = false
      void this.#writeActionMemory(`You realize you cannot: ${res.reason}`)
    })
  }

  #handleNight(tick: number, packet: PerceptionPacket): void {
    const isNight = packet.time.isNight
    const day = Math.floor(tick / MINUTES_PER_DAY)
    if (this.#wasNight && !isNight) {
      if (this.#pendingDreamMood !== null) {
        const cur = this.#personality.current().doc.current
        this.#personality.updateCurrent({ ...cur, mood: this.#pendingDreamMood })
        this.#pendingDreamMood = null
      }
      this.#dayLog = []
    }
    if (isNight && packet.self.asleep && this.#reflectedDay !== day) {
      void this.#runNight(day)
    }
    this.#wasNight = isNight
  }

  async #startTurn(_reason: WakeReason): Promise<void> {
    if (this.#turnInFlight) return
    this.#turnInFlight = true
    try {
      await this.#runTurnBody()
    } catch (err) {
      this.#llm.alert('turn_crash', err instanceof Error ? err.message : String(err))
    } finally {
      this.#turnInFlight = false
    }
  }

  async #runTurnBody(): Promise<void> {
    const tick = this.#bridge.currentTick()
    const packet = this.#bridge.perception(this.#agentId)
    const day = Math.floor(tick / MINUTES_PER_DAY)

    const prose = perceptionToProse(packet, (detail) => this.#llm.alert('prose', detail))
    this.#dayLog.push(prose)
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

    const cues = cuesFromPacket(packet)
    const ambient = await retrieveAmbient(this.#mem!, cues, tick, this.#config.ambientK)

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
      const { value } = await this.#llm.object({ schema: TurnSchema, system: assembled.system, messages: assembled.messages })
      turn = await parseTurnWithRepair(
        value,
        (issues) => this.#repair(assembled, issues),
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
    this.#clock.prevNeeds = {
      hunger: packet.self.body.needs.hunger,
      energy: packet.self.body.needs.energy,
      warmth: packet.self.body.needs.warmth,
    }
    this.#clock.prevVisibleIds = packet.visible.agents.map((a) => a.id)
  }

  async #repair(assembled: AssembledPrompt, issues: string): Promise<unknown> {
    const { value } = await this.#llm.object({
      schema: TurnSchema,
      system: assembled.system,
      messages: [...assembled.messages, { role: 'assistant', content: `Your response was rejected. Fix it:\n${issues}` }],
    })
    return value
  }

  async #applyTurn(turn: Turn, tick: number, day: number): Promise<void> {
    const mem = this.#mem!
    await mem.insertMemory({ tick, kind: 'thought', text: turn.thought, importance: turn.importance, tags: EMPTY_TAGS })

    if (turn.speech) {
      await this.#bridge.submit(this.#agentId, { verb: 'speak', params: { text: turn.speech } })
    }

    if (turn.action) {
      if ('freeform' in turn.action) {
        await this.#bridge.submit(this.#agentId, { verb: 'experiment', params: { description: turn.action.freeform } })
      } else {
        const res = await this.#bridge.submit(this.#agentId, { verb: turn.action.verb, params: turn.action.params })
        if (!res.ok) await this.#writeActionMemory(`You realize you cannot: ${res.reason}`)
      }
    }

    if (turn.plan) {
      this.#plan.queue = [...turn.plan]
      this.#plan.lastResult = turn.plan.length > 0 ? 'running' : 'done'
      this.#planHeadInFlight = false
      this.#submitPlanHead()
    }

    if (turn.journal) {
      mem.insertJournal(tick, day, turn.journal)
      await mem.insertMemory({ tick, kind: 'journal', text: turn.journal, importance: turn.importance, tags: EMPTY_TAGS })
      this.#clock.lastTurnTick += this.#config.journalTicks
    }

    if (turn.reconsider_at) {
      this.#clock.reconsiderAtTick = reconsiderTick(tick, turn.reconsider_at)
    }

    const submittedSleep =
      (turn.action !== undefined && !('freeform' in turn.action) && turn.action.verb === 'sleep') ||
      (turn.plan?.some((i) => i.verb === 'sleep') ?? false)
    if (submittedSleep && this.#reflectedDay !== day && this.#reflectionLlm !== null) {
      await this.#runNight(day)
    }
  }

  async #runNight(day: number): Promise<void> {
    if (this.#reflectedDay === day) return
    this.#reflectedDay = day
    if (this.#reflectionLlm === null) return
    this.#stats.reflections += 1
    try {
      await runSleepReflection({ mem: this.#mem!, personality: this.#personality, llm: this.#reflectionLlm, day })
      if (this.#dreamLlm !== null) {
        const dream = await rollDream({ mem: this.#mem!, agentId: this.#agentId, day, llm: this.#dreamLlm, chance: this.#config.dreamChance })
        if (dream.dreamed) this.#pendingDreamMood = dream.mood
      }
    } catch (err) {
      this.#llm.alert('reflection_failed', err instanceof Error ? err.message : String(err))
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
  }
}
