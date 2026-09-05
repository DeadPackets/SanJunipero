import { dayPhaseFromTick, MINUTES_PER_DAY, sanitizeSpokenText, STAKES_BY_KIND } from '@sj/shared'
import { LAW_TABLED_DAYS, LAW_TEXT_MAX, type LawPredicate } from '@sj/engine'
import type { EngineBridge, SubmitResult } from '../runtime/bridge.js'
import type { LawSeam } from '../runtime/arbiterSeam.js'
import type { Tie, TieStore } from '../memory/ties.js'
import type { WantOccasion } from '../memory/wants.js'
import {
  addressedIn,
  appendLine,
  CLOSING_TIMEOUTS,
  councilDecided,
  FLOOR_TIMEOUT_MS,
  idNamed,
  lawIdOf,
  roomForACouncil,
  lineCapOf,
  nextFloor,
  openQuarrelTie,
  openScene,
  stakesFor,
  TALKERS_NEEDED,
  tallyCouncil,
  threadFor,
  upgradedKind,
  wrapUpDue,
  type Scene,
  type SceneLlm,
  type SceneTurn,
  type Stance,
  type TieDelta,
} from './scene.js'
import {
  INVITATION_STAKES,
  memoryLinesFor,
  momentPassedLine,
  noAnswerLine,
  peopleIn,
  DEPARTED_IMPORTANCE,
  readFact,
  tiesFor,
  wentDownTheRoadLine,
  type RelationshipFact,
} from './invitations.js'

/** What one mind lends a scene: the call it pays for, the ties it holds, the memory the scene
 *  leaves it, and how warm it feels toward whoever else is standing there. */
export type SceneMind = {
  llm: SceneLlm
  ties: TieStore
  remember(m: { tick: number; text: string; importance: number }): Promise<void>
  warmth(otherId: string): number
  /** The wants this mind's own runtime keeps. Absent, a relationship feeds none of them. */
  feed?(occasions: readonly WantOccasion[], tick: number): void
}

type Proposal = NonNullable<Scene['proposal']>
/** A scene as a checkpoint holds it. The three fields a talk gained when it learned to have an
 *  audience are absent in anything written before that, and so are the two a proposal gained
 *  when a council learned to count; a live run has to resume anyway. */
type StoredScene = Omit<Scene, 'audience' | 'anchor' | 'timeouts' | 'proposal'> &
  Partial<Pick<Scene, 'audience' | 'anchor' | 'timeouts'>> & {
    proposal?: Omit<Proposal, 'proposedBy' | 'stances'> &
      Partial<Pick<Proposal, 'proposedBy' | 'stances'>>
  }

export type SceneCoordinatorOpts = {
  bridge: EngineBridge
  mindFor: (agentId: string) => SceneMind | null
  /** The court, for the one call a passed rule makes. Absent, a town still writes its rules —
   *  they are kept in words only, and the neighbours are the whole of the enforcement. */
  laws?: LawSeam
  /** Everyone the town holds a mind for, by id. Read when somebody walks out, so the people
   *  who knew them hear of it. Absent, a leaving reaches only whoever was standing in a talk. */
  everyone?: () => readonly string[]
  /** The wall clock the floor timeout is measured on. Injected so a test need not wait 30 s. */
  now?: () => number
  onError?: (kind: string, detail: string) => void
}

// A scene opens as a talk and is worth what a talk is worth; the kind it turns into raises it.
const OPENING_STAKES = STAKES_BY_KIND.talk
/** How long a mind may spend in talks in one day before a casual one stops opening for it. Three
 *  hours: r13 measured six hours a day in talks against a fifth of an hour of work, and a talk
 *  somebody is named into, or an ask, a quarrel or a rule, still opens. */
export const TALK_BUDGET_TICKS = 180
/** How long a talker may be out of earshot before the talk goes on without them. Eight ticks is a
 *  doorway: r14 closed 31 of 59 talks with both people at one tile, one inside and one at the door,
 *  and the same pair opened a new talk indoors a minute later. */
export const EARSHOT_GRACE_TICKS = 8
/** How long a turn's own choice to walk, sleep or leave still explains the body going. */
export const WALK_OFF_WINDOW_TICKS = 60
// Three expressers on the plaza at dusk is a crowd, not a pair.
const GATHERING_MINIMUM = 3
// How many of its own last lines a mind is shown before it speaks again.
const RECENT_LINES_KEPT = 4
// A coordinator with nobody to tell drops what it would have reported.
const NO_REPORT = (): void => {
  /* nothing to tell */
}
/** Beyond this many rules in one day the court is not asked again. The limiter and the budget
 *  both see every call; this is the bound on a day where the town does nothing but agree. */
export const MAX_COMPILES_PER_DAY = 6
/** What a rule comes to with no court to read it: remembered, quoted in every prompt, and held
 *  to by nobody but the neighbours. */
const WORDS_ONLY = {
  predicate: { kind: 'none' } as LawPredicate,
  repeals: null,
  why: 'kept in words only',
}

/** Which want each of them answers. A partnership feeds affection, a birth feeds legacy, and
 *  being refused in front of people or being walked out on feeds rivalry. */
function wantsFrom(fact: RelationshipFact): [string, WantOccasion][] {
  if (fact.type === 'partnership_formed') {
    return [fact.aId, fact.bId].map((id): [string, WantOccasion] => [id, 'partnered'])
  }
  if (fact.type === 'agent_born') {
    return [fact.motherId, fact.fatherId].map((id): [string, WantOccasion] => [id, 'child'])
  }
  if (fact.type === 'invitation_refused' && fact.witnesses.length > 0)
    return [[fact.byId, 'slight']]
  if (fact.type === 'partnership_dissolved') {
    return [[fact.byId === fact.aId ? fact.bId : fact.aId, 'slight']]
  }
  return []
}

/** One per world. It hears every word, decides who holds the floor, and is the only thing that
 *  knows a conversation is a conversation. */
export class SceneCoordinator {
  readonly #bridge: EngineBridge
  readonly #mindFor: (agentId: string) => SceneMind | null
  readonly #everyone: () => readonly string[]
  readonly #laws: LawSeam | null
  readonly #lapsed = new Set<string>()
  readonly #talked = new Map<string, { day: number; ticks: number }>()
  readonly #away = new Map<string, number>()
  /** Minds whose own turn chose legs or bed mid-talk, by the tick they chose. */
  readonly #leaving = new Map<string, number>()
  readonly #now: () => number
  readonly #onError: (kind: string, detail: string) => void
  readonly #scenes = new Map<string, Scene>()
  /** The ask now in flight, per scene, as the token it was made under. A late answer to a stale
   *  token is dropped — the floor has already moved on. */
  readonly #asked = new Map<string, number>()
  /** The last few lines each mind said, in any scene. Shown back to it so a line it liked does
   *  not become a catchphrase by the second day. */
  readonly #recent = new Map<string, string[]>()
  /** The kind, stakes and cast last announced per scene. A talk that turns, or grows a voice,
   *  is a new fact about the same scene, and this is what says whether it is new. */
  readonly #announced = new Map<string, string>()
  /** When the floor was last handed over, in wall-clock ms. Measured from the hand-off and not
   *  from the ask, because a mouth that never asks is exactly what a stalled talk is made of. */
  readonly #floorSince = new Map<string, { agentId: string; atMs: number }>()
  #token = 0
  #lastTick = -1
  #compileDay = -1
  #compilesToday = 0
  /** How far into the log the relationship scan has read. Starts where the world stands, so a
   *  restart never replays yesterday's weddings. */
  #lastSeq: number
  /** Everyone who came up the valley road and has not yet stood in a talk. Rebuilt from the log
   *  at boot, so a restart carries exactly the set the run before it had. */
  readonly #strangers: Set<string>

  constructor(opts: SceneCoordinatorOpts) {
    this.#bridge = opts.bridge
    this.#mindFor = opts.mindFor
    this.#everyone = opts.everyone ?? ((): readonly string[] => [])
    this.#laws = opts.laws ?? null
    this.#now = opts.now ?? Date.now
    this.#onError = opts.onError ?? NO_REPORT
    this.#lastSeq = opts.bridge.lastSeq()
    this.#strangers = new Set(opts.bridge.strangersSoFar())
  }

  /** Everyone the town has not properly met yet. The viewer never sees it; a test does. */
  strangers(): string[] {
    return [...this.#strangers].sort()
  }

  /** Every open scene, for the gateway's frame and for a snapshot. */
  open(): Scene[] {
    return [...this.#scenes.values()].filter((s) => s.closedTick === null)
  }

  sceneFor(agentId: string): Scene | null {
    for (const s of this.#scenes.values()) {
      if (s.closedTick === null && s.participants.includes(agentId)) return s
    }
    return null
  }

  /** Put a scene back after a restore. Keyed by id, so twelve minds restoring the same scene
   *  converge on one — the id is derived from the opening tick and the cast, not from a counter.
   *  A checkpoint written before a scene had an audience or an anchor still has to come back. */
  adopt(scene: StoredScene | null | undefined): void {
    if (scene === null || scene === undefined) return
    if (scene.closedTick !== null) return
    if (this.#scenes.has(scene.id)) return
    const { proposal, ...back } = structuredClone(scene)
    const anchor = back.anchor ?? back.participants[0] ?? ''
    this.#scenes.set(back.id, {
      ...back,
      audience: back.audience ?? [],
      anchor,
      timeouts: back.timeouts ?? 0,
      ...(proposal === undefined
        ? {}
        : {
            proposal: {
              ...proposal,
              proposedBy: proposal.proposedBy ?? anchor,
              stances: proposal.stances ?? {},
            },
          }),
    })
  }

  /** A word the world took. Said inside the mouth's own talk — an ordinary turn that resolved
   *  after the scene opened around it — it is a line of that talk. Inside another open scene's
   *  earshot it is a line of THAT scene and the mouth joins it; otherwise, if anyone who could
   *  answer heard it, it opens one between the speaker and the mind they spoke to, and everybody
   *  else stands and listens. */
  noteSpoken(agentId: string, text: string, tick: number): Scene | null {
    const said = sanitizeSpokenText(text)
    const mine = this.sceneFor(agentId)
    if (mine !== null) {
      this.#leaving.delete(agentId)
      this.#recordLine(mine, agentId, said, '', 'none', null, tick)
      return mine
    }
    const joined = this.#joinNearby(agentId, said, tick)
    if (joined !== null) return joined
    const heard = this.#bridge
      .earshot(agentId)
      .filter((id) => this.#mindFor(id) !== null && this.#canTalk(id))
    if (heard.length + 1 < TALKERS_NEEDED) return null
    // A name opens a talk whatever the day has held; a remark to the air does not once the
    // speaker, or everyone near enough to answer, has talked their fill today.
    const named = addressedIn(said, heard, (id) => this.#nameOf(id))
    const fresh = heard.filter((id) => !this.#talkedOut(id, tick))
    const answering =
      named ?? (this.#talkedOut(agentId, tick) ? null : this.#bridge.nearestOf(agentId, fresh))
    if (answering === null) return null
    const scene = openScene({
      openedTick: tick,
      participants: [agentId, answering],
      audience: heard.filter((id) => id !== answering),
      opener: agentId,
      topic: said,
      stakes: OPENING_STAKES,
    })
    scene.kind = this.#kindAfter(scene, said, tick)
    this.#tellingIfStranger(scene)
    scene.stakes = this.#stakesOf(scene)
    // A rule still waiting for its vote comes before any new one this room might put.
    const voting = this.#voteIfTabled(scene, tick)
    if (!voting && scene.kind === 'council') this.#propose(scene, agentId, said)
    this.#scenes.set(scene.id, scene)
    this.#announced.set(scene.id, this.#mark(scene))
    this.#bridge.announce('scene_opened', {
      id: scene.id,
      kind: scene.kind,
      participants: [...scene.participants],
      topic: scene.topic,
      stakes: scene.stakes,
    })
    this.#recordLine(scene, agentId, said, '', 'none', null, tick)
    for (const id of scene.participants) this.#standStill(id)
    return scene
  }

  /** Talking to somebody stops your legs, and being talked to stops theirs. Without this a mind
   *  spoken to mid-walk kept walking, left earshot before its turn to answer came, and the talk
   *  died at one line: a quarter of all of them, in rehearsal 12. Hands at work are left alone. */
  #standStill(agentId: string): void {
    if (this.#bridge.perception(agentId).self.activity !== 'walk') return
    void this.#bridge.submit(agentId, { verb: 'stop', params: {} }).catch(this.#sink)
  }

  /** One invariant: a say inside an open scene's earshot is a line of that scene. So no second
   *  scene ever opens over the top of one, and two can share a square only out of each other's
   *  hearing. Ties by id, because a mouth heard by two scenes has to pick the same one twice. */
  #joinNearby(agentId: string, said: string, tick: number): Scene | null {
    if (this.#mindFor(agentId) === null || !this.#canTalk(agentId)) return null
    const within = new Set(this.#bridge.earshot(agentId))
    const scene = this.open()
      .filter((s) => s.participants.some((id) => within.has(id)))
      .sort((a, b) => a.id.localeCompare(b.id))[0]
    if (scene === undefined) return null
    this.#admit(scene, agentId, tick)
    this.#recordLine(scene, agentId, said, '', 'none', null, tick)
    return scene
  }

  /** A mind moves off the audience and into the talk. The arrival is a line rather than a roster
   *  edit, so every byte the prompt already sent stays where it was. */
  #admit(scene: Scene, agentId: string, tick: number): void {
    if (scene.participants.includes(agentId)) return
    scene.audience = scene.audience.filter((id) => id !== agentId)
    scene.participants = [...scene.participants, agentId].sort()
    this.#tellingIfStranger(scene)
    this.#standStill(agentId)
    appendLine(scene, { agentId, text: '', aside: '', move: 'none', tick, presence: 'joined' })
    if (scene.kind !== 'council') this.#voteIfTabled(scene, tick)
    scene.stakes = this.#stakesOf(scene)
    this.#turned(scene)
  }

  /** A rule an earlier council was for is voted on by the first room big enough on a later day.
   *  One that waited too long lapses instead. A talk with a fresh rule in it is not the place: the
   *  tabled one comes first, and the new one can be put again another time. */
  #voteIfTabled(scene: Scene, tick: number): boolean {
    if (!roomForACouncil(scene)) return false
    const today = Math.floor(tick / MINUTES_PER_DAY)
    const underVote = new Set(
      [...this.#scenes.values()].map((s) => s.proposal?.tabledId).filter((id) => id !== undefined),
    )
    for (const law of this.#bridge.tabledLaws()) {
      if (underVote.has(law.id)) continue
      const day = Math.floor(law.tabledTick / MINUTES_PER_DAY)
      if (day >= today) continue
      if (today - day > LAW_TABLED_DAYS) {
        // Announced once: the event folds on the next step, and two rooms can open before it.
        if (!this.#lapsed.has(law.id)) {
          this.#lapsed.add(law.id)
          this.#bridge.announce('law_dropped', { lawId: law.id, text: law.text, why: 'lapsed' })
        }
        continue
      }
      scene.kind = 'council'
      scene.proposal = {
        lawText: law.text,
        proposedBy: law.proposedBy,
        stances: {},
        predicate: { kind: 'none' },
        tabledId: law.id,
      }
      scene.stakes = this.#stakesOf(scene)
      return true
    }
    return false
  }

  /** One body out of the talk, and the talk goes on without them. The anchor and the floor both
   *  move off anyone who is no longer in it. */
  #part(scene: Scene, agentId: string, tick: number): void {
    if (!scene.participants.includes(agentId)) return
    scene.participants = scene.participants.filter((id) => id !== agentId)
    appendLine(scene, { agentId, text: '', aside: '', move: 'none', tick, presence: 'left' })
    if (!scene.participants.includes(scene.anchor)) {
      scene.anchor = scene.participants[0] ?? scene.anchor
    }
    if (scene.floor === agentId) {
      this.#floorTo(scene, scene.participants.length === 0 ? null : scene.anchor)
    }
    this.#turned(scene)
  }

  /** The one turn a scene ever takes. Called by the floor-holder's own runtime, so the cost of
   *  a line is booked to the mouth that said it and to nobody listening. */
  async takeFloor(agentId: string, tick: number): Promise<void> {
    const scene = this.sceneFor(agentId)
    if (scene?.floor !== agentId) return
    const mind = this.#mindFor(agentId)
    if (mind === null) return
    const token = ++this.#token
    this.#asked.set(scene.id, token)
    let turn: SceneTurn
    try {
      turn = await mind.llm.line({
        scene: structuredClone(scene),
        agentId,
        cast: this.#named(scene.participants),
        audience: this.#named(scene.audience),
        ties: this.#tiesBetween(mind.ties, scene, agentId),
        thread: threadFor(scene, agentId),
        recent: this.#recent.get(agentId) ?? [],
        wrapUp: wrapUpDue(scene),
        tick,
        energy: this.#bridge.energyOf(agentId),
      })
    } catch (err) {
      this.#onError('scene_line', err instanceof Error ? err.message : String(err))
      this.#asked.delete(scene.id)
      return
    }
    // The floor moved while the provider was thinking: a timeout already counted this as a pass.
    if (this.#asked.get(scene.id) !== token) return
    this.#asked.delete(scene.id)
    // Or the mouth left the talk while the provider was thinking: went to bed, or walked out of
    // earshot. Saying the line now would wake a sleeper with its own words.
    if (scene.closedTick !== null || !scene.participants.includes(agentId)) return

    const said = turn.speech === null ? '' : sanitizeSpokenText(turn.speech)
    // One mouth leaving takes itself out, not the whole talk: a goodbye is said and remembered as
    // one, a leave without a word is remembered as walking off. r18 closed 52 of 92 talks here.
    if (turn.leave) {
      if (said.length > 0) {
        void this.#bridge
          .submit(agentId, { verb: 'speak', params: { text: said } })
          .catch(this.#sink)
        this.#recordLine(scene, agentId, said, turn.thought, turn.move, turn.to, tick, turn.stance)
        this.#saidLately(agentId, said)
        this.#noteGoodbye(scene, agentId, tick)
      } else this.#noteWalkedOff(scene, agentId, tick)
      this.#leaving.delete(agentId)
      this.#part(scene, agentId, tick)
      if (scene.participants.length < TALKERS_NEEDED) await this.#close(scene, 'left', tick)
      return
    }
    // An answer given and an invitation put are both things done: a mouth that did one of them
    // and said nothing has not passed.
    const answered = this.#answer(scene, agentId, turn, tick)
    const invited = this.#askFrom(scene, agentId, turn, tick)
    if (said.length === 0 && !answered && !invited) {
      await this.#pass(scene, tick)
      return
    }
    scene.passes = 0
    scene.timeouts = 0
    // Not awaited: an intent settles on the next tick, and the floor must not wait a tick to move.
    if (said.length > 0) {
      void this.#bridge.submit(agentId, { verb: 'speak', params: { text: said } }).catch(this.#sink)
    }
    this.#recordLine(scene, agentId, said, turn.thought, turn.move, turn.to, tick, turn.stance)
    this.#saidLately(agentId, said)
    if (councilDecided(scene)) await this.#close(scene, 'ended', tick)
    else if (scene.thread.length >= lineCapOf(scene)) await this.#close(scene, 'capped', tick)
  }

  /** The body took this mind out of the talk. One person's alarm drops that person; the talk
   *  ends only where too few are left to answer each other. */
  leave(agentId: string, tick: number): void {
    const scene = this.sceneFor(agentId)
    if (scene === null) return
    this.#part(scene, agentId, tick)
    if (scene.participants.length < TALKERS_NEEDED) {
      void this.#close(scene, 'left', tick).catch(this.#sink)
    }
  }

  /** This mind's own turn chose legs or bed while in a talk. Nothing happens until the body
   *  goes: a walk to the tile underfoot or a step through a door leaves nobody. */
  walkingOff(agentId: string, tick: number): void {
    if (this.sceneFor(agentId) !== null) this.#leaving.set(agentId, tick)
  }

  /** The body has gone. If its own turn chose that, the others remember it, and so does the walker. */
  #gone(scene: Scene, agentId: string, tick: number): void {
    const chose = this.#leaving.get(agentId)
    this.#leaving.delete(agentId)
    if (chose !== undefined && tick - chose <= WALK_OFF_WINDOW_TICKS)
      this.#noteWalkedOff(scene, agentId, tick)
    this.#part(scene, agentId, tick)
  }

  #noteWalkedOff(scene: Scene, agentId: string, tick: number): void {
    const name = this.#nameOf(agentId) ?? agentId
    const others = scene.participants.filter((id) => id !== agentId)
    for (const id of others)
      this.#tell(id, `${name} walked off while you were still talking.`, 5, tick)
    const them = others.map((id) => this.#nameOf(id) ?? id).join(' and ')
    if (them.length > 0) this.#tell(agentId, `You walked off from ${them} mid-talk.`, 3, tick)
  }

  #noteGoodbye(scene: Scene, agentId: string, tick: number): void {
    const name = this.#nameOf(agentId) ?? agentId
    for (const id of scene.participants) {
      if (id !== agentId) this.#tell(id, `${name} said goodbye and left the talk.`, 3, tick)
    }
  }

  /** Every tick, once, whoever calls first: the ones who walked away or went to bed, and the
   *  ones who never answered. */
  onTick(tick: number): void {
    if (tick === this.#lastTick) return
    this.#lastTick = tick
    this.#readRelationshipEvents(tick)
    for (const scene of this.open()) {
      for (const id of scene.participants) this.#countTalk(id, tick)
      this.#dropAbsent(scene, tick)
      if (scene.participants.length < TALKERS_NEEDED) {
        void this.#close(scene, 'left', tick).catch(this.#sink)
        continue
      }
      if (scene.floor === null) continue
      const held = this.#floorSince.get(scene.id)
      if (held?.agentId !== scene.floor) {
        this.#floorSince.set(scene.id, { agentId: scene.floor, atMs: this.#now() })
        continue
      }
      if (this.#now() - held.atMs < FLOOR_TIMEOUT_MS) continue
      this.#asked.delete(scene.id)
      void this.#timedOut(scene, tick).catch(this.#sink)
    }
  }

  #countTalk(agentId: string, tick: number): void {
    const day = Math.floor(tick / MINUTES_PER_DAY)
    const had = this.#talked.get(agentId)
    const ticks = had?.day === day ? had.ticks + 1 : 1
    this.#talked.set(agentId, { day, ticks })
  }

  #talkedOut(agentId: string, tick: number): boolean {
    const had = this.#talked.get(agentId)
    return had?.day === Math.floor(tick / MINUTES_PER_DAY) && had.ticks >= TALK_BUDGET_TICKS
  }

  #sink = (err: unknown): void => {
    this.#onError('scene_close', err instanceof Error ? err.message : String(err))
  }

  /** A silence the mouth chose. It hands the floor back to the anchor, and the anchor's own
   *  silence is the end of it — there is nobody left for the talk to fall back on. */
  async #pass(scene: Scene, tick: number): Promise<void> {
    const quiet = scene.floor ?? scene.anchor
    if (quiet === scene.anchor) {
      await this.#close(scene, 'ended', tick)
      return
    }
    scene.passes += 1
    this.#floorTo(scene, this.#floorAfter(scene, quiet, '', null))
  }

  /** A provider that never came back. The floor moves on and nobody is asked twice for the same
   *  line; two silences in a row is a scene nothing is coming back from. */
  async #timedOut(scene: Scene, tick: number): Promise<void> {
    scene.timeouts += 1
    if (scene.timeouts >= CLOSING_TIMEOUTS) {
      await this.#close(scene, 'timeout', tick)
      return
    }
    this.#floorTo(scene, this.#floorAfter(scene, scene.floor ?? scene.anchor, '', null))
  }

  /** Every hand-off of the floor: the stall clock starts here, not where the mouth gets round
   *  to asking. */
  #floorTo(scene: Scene, next: string | null): void {
    // Whatever was in flight was asked of the floor as it stood; an answer to it is stale.
    this.#asked.delete(scene.id)
    scene.floor = next
    if (next === null) this.#floorSince.delete(scene.id)
    else this.#floorSince.set(scene.id, { agentId: next, atMs: this.#now() })
  }

  #recordLine(
    scene: Scene,
    agentId: string,
    text: string,
    aside: string,
    move: Scene['thread'][number]['move'],
    to: string | null,
    tick: number,
    stance: Stance | null = null,
  ): void {
    appendLine(scene, { agentId, text, aside, move, tick })
    const upgraded = this.#kindAfter(scene, text, tick)
    if (upgraded !== scene.kind) {
      scene.kind = upgraded
      scene.stakes = this.#stakesOf(scene)
      if (upgraded === 'council' && scene.proposal === undefined) {
        this.#propose(scene, agentId, text)
      }
    }
    // A vote is one of the others answering the rule; the one who put it is already for it, and
    // a stance said outside a council answers nothing.
    const proposal = scene.proposal
    if (proposal !== undefined && stance !== null && agentId !== proposal.proposedBy) {
      proposal.stances[agentId] = stance
    }
    const next = this.#floorAfter(scene, agentId, text, to)
    if (next !== null) this.#admit(scene, next, tick)
    this.#floorTo(scene, next)
    this.#turned(scene)
    this.#bridge.announce('scene_line', { id: scene.id, agentId, text, move })
  }

  #saidLately(agentId: string, said: string): void {
    const ring = this.#recent.get(agentId) ?? []
    ring.push(said)
    if (ring.length > RECENT_LINES_KEPT) ring.shift()
    this.#recent.set(agentId, ring)
  }

  /** What the town has been told about this scene: its kind, what it is worth, and who is in it. */
  #mark(scene: Scene): string {
    return `${scene.kind}\n${scene.stakes}\n${scene.participants.join(',')}`
  }

  /** One event for a talk that became something else, or grew a voice. Without it the viewer's
   *  frame and the camera's scorer both keep the opening kind and the opening pair. */
  #turned(scene: Scene): void {
    if (scene.closedTick !== null) return
    const mark = this.#mark(scene)
    if (this.#announced.get(scene.id) === mark) return
    this.#announced.set(scene.id, mark)
    this.#bridge.announce('scene_turned', {
      id: scene.id,
      kind: scene.kind,
      participants: [...scene.participants],
      stakes: scene.stakes,
    })
  }

  #stakesOf(scene: Scene): number {
    return stakesFor(
      scene.stakes,
      scene.kind,
      openQuarrelTie(scene, (id) => this.#mindFor(id)?.ties.open() ?? []),
    )
  }

  #floorAfter(scene: Scene, speakerId: string, text: string, to: string | null): string | null {
    const mind = this.#mindFor(speakerId)
    return nextFloor(
      scene,
      speakerId,
      text,
      to,
      (id) => this.#nameOf(id),
      (id) => mind?.warmth(id) ?? 0,
    )
  }

  #kindAfter(scene: Scene, text: string, tick: number): Scene['kind'] {
    return upgradedKind(scene, text, {
      tiesOf: (id) => this.#mindFor(id)?.ties.open() ?? [],
      nameOf: (id) => this.#nameOf(id),
      gathering: this.#gathering(tick),
    })
  }

  #gathering(tick: number): boolean {
    if (dayPhaseFromTick(tick) !== 'dusk') return false
    return this.#bridge.expressersAtSquare().length >= GATHERING_MINIMUM
  }

  /** Whether this body can hold up its end of a talk: alive, and not in bed. The one rule the
   *  opener and the tick sweep both read, so nothing opens a scene the same tick would close.
   *  The hour is not in it — a talk that runs past midnight is a late night, not a fault. */
  #canTalk(agentId: string): boolean {
    return this.#bridge.isAlive(agentId) && this.#bridge.isAwake(agentId)
  }

  /** Anyone out of the last speaker's earshot, dead, or gone to bed has left the talk, and the
   *  same rule thins the audience. The floor moves off them the tick they lie down, so no scene
   *  waits on a sleeper. Presence lines are not speech, so they never become the ear. */
  #dropAbsent(scene: Scene, tick: number): void {
    const spoke = scene.thread.filter(
      (l) => l.presence === undefined && scene.participants.includes(l.agentId),
    )
    const ear = spoke[spoke.length - 1]?.agentId ?? scene.anchor
    const within = new Set([ear, ...this.#bridge.earshot(ear)])
    const here = (id: string): boolean => within.has(id) && this.#canTalk(id)
    for (const id of scene.participants) {
      const key = `${scene.id}:${id}`
      if (here(id)) {
        this.#away.delete(key)
        const chose = this.#leaving.get(id)
        if (chose !== undefined && tick - chose > WALK_OFF_WINDOW_TICKS) this.#leaving.delete(id)
        continue
      }
      // Asleep or dead is gone at once; merely out of earshot gets the length of a doorway.
      if (!this.#canTalk(id)) {
        this.#gone(scene, id, tick)
        continue
      }
      const since = this.#away.get(key) ?? tick
      this.#away.set(key, since)
      if (tick - since >= EARSHOT_GRACE_TICKS) this.#gone(scene, id, tick)
    }
    scene.audience = scene.audience.filter(here)
  }

  async #close(
    scene: Scene,
    reason: NonNullable<Scene['closeReason']>,
    tick: number,
  ): Promise<void> {
    if (scene.closedTick !== null) return
    // An ask nobody ever answered. There is no event for a silence, so the asker gets a memory.
    if (scene.invitation !== undefined) {
      const { from, to } = scene.invitation
      delete scene.invitation
      this.#tell(from, noAnswerLine(this.#nameOf(to) ?? to), 7, tick)
    }
    scene.closedTick = tick
    scene.closeReason = reason
    scene.floor = null
    this.#asked.delete(scene.id)
    this.#floorSince.delete(scene.id)
    this.#announced.delete(scene.id)
    this.#scenes.delete(scene.id)
    // Everyone who was ever in it gets the memory, not only whoever was left at the end.
    const cast = [...new Set([...scene.participants, ...scene.thread.map((l) => l.agentId)])].sort()
    // Standing near it is not being in it: the audience carries the summary away and no tie.
    const overheard = scene.audience.filter((id) => !cast.includes(id))
    const named = this.#named(cast)
    const teller = cast.map((id) => this.#mindFor(id)).find((m) => m !== null) ?? null
    let summary = ''
    let deltas: TieDelta[] = []
    if (teller !== null) {
      try {
        const answer = await teller.llm.close({ scene: structuredClone(scene), cast: named })
        summary = answer.summary
        deltas = answer.deltas
      } catch (err) {
        this.#onError('scene_close', err instanceof Error ? err.message : String(err))
      }
    }
    // A tie is what passed between two people who were in it. Standing near it is not being in
    // it, so a delta naming anyone outside the cast reaches no book and no bond graph.
    deltas = deltas.filter((d) => cast.includes(d.agentId) && cast.includes(d.personId))
    const at = this.#bridge.currentTick()
    for (const id of cast) this.#mindFor(id)?.ties.apply(deltas, at)
    this.#bridge.announce('scene_closed', {
      id: scene.id,
      summary,
      deltas,
      closeReason: reason,
      participants: cast,
    })
    await this.#settleCouncil(scene, tick)
    if (summary.length === 0) return
    // Importance is the scene's stakes; the memories table's floor is one, and a scene nobody
    // had anything at stake in still happened.
    const importance = Math.min(10, Math.max(1, Math.round(scene.stakes)))
    for (const id of [...cast, ...overheard]) {
      const mind = this.#mindFor(id)
      if (mind === null) continue
      await mind.remember({ tick, text: summary, importance }).catch(this.#sink)
    }
  }

  /** Somebody has put a rule to the room. The words are the record — the town heard them said,
   *  and the same sentence is what a refusal quotes back for as long as the rule stands. */
  #propose(scene: Scene, agentId: string, text: string): void {
    const lawText = text.slice(0, LAW_TEXT_MAX)
    scene.proposal = { lawText, proposedBy: agentId, stances: {}, predicate: { kind: 'none' } }
    this.#bridge.announce('law_proposed', { lawId: lawIdOf(scene), agentId, text: lawText })
  }

  /** What a closed council leaves the town. A vote that failed leaves the argument and nothing
   *  else; one that passed asks the court once what of it the world can hold them to, and the
   *  answer rides in the event, so a replay of the log asks nobody anything. */
  async #settleCouncil(scene: Scene, tick: number): Promise<void> {
    const proposal = scene.proposal
    if (scene.kind !== 'council' || proposal === undefined) return
    const tally = tallyCouncil(scene)
    const { lawText, proposedBy, tabledId } = proposal
    const votes = { for: tally.for, against: tally.against }
    if (tabledId === undefined) {
      // A rule the room was for waits for a vote on a later day: a law is two councils, not one.
      if (tally.passed) {
        this.#bridge.announce('law_tabled', {
          lawId: lawIdOf(scene),
          agentId: proposedBy,
          text: lawText,
          votes,
        })
      }
      return
    }
    if (!tally.passed) {
      // Nobody answering leaves it on the table for the next room; a room against it drops it.
      if (tally.for.length + tally.against.length > 1)
        this.#bridge.announce('law_dropped', { lawId: tabledId, text: lawText, why: 'rejected' })
      return
    }
    const answer = await this.#compile(lawText, tick)
    const letGo =
      answer.repeals === null
        ? undefined
        : this.#bridge.socialLaws().find((l) => l.ordinal === answer.repeals)
    if (letGo !== undefined) {
      this.#bridge.announce('law_repealed', {
        lawId: letGo.id,
        agentId: proposedBy,
        text: lawText,
      })
      return
    }
    proposal.predicate = answer.predicate
    this.#bridge.announce('law_ratified', {
      lawId: tabledId,
      agentId: proposedBy,
      text: lawText,
      why: answer.why,
      predicate: answer.predicate,
      votes,
    })
  }

  /** The one call a rule ever makes. A court that is not there, one that throws, and a day that
   *  has already asked six times all come to the same place: the rule stands in words. */
  async #compile(
    text: string,
    tick: number,
  ): Promise<{ predicate: LawPredicate; repeals: number | null; why: string }> {
    const laws = this.#laws
    if (laws === null || !this.#mayCompile(tick)) return WORDS_ONLY
    try {
      return await laws({
        text,
        standing: this.#bridge.socialLaws().map((l) => ({ ordinal: l.ordinal, text: l.text })),
        places: this.#bridge.publicPlaces(),
      })
    } catch (err) {
      this.#onError('law_compile', err instanceof Error ? err.message : String(err))
      return WORDS_ONLY
    }
  }

  #mayCompile(tick: number): boolean {
    const day = Math.floor(tick / MINUTES_PER_DAY)
    if (day !== this.#compileDay) {
      this.#compileDay = day
      this.#compilesToday = 0
    }
    if (this.#compilesToday >= MAX_COMPILES_PER_DAY) return false
    this.#compilesToday += 1
    return true
  }

  /** Every relationship the log has written since the last look, and the one place their ties,
   *  their memories and their wants are written from. A `leave_partner` said in an ordinary turn
   *  and a restart mid-invitation both come through here, so both land the same. */
  #readRelationshipEvents(tick: number): void {
    for (const ev of this.#bridge.relationshipEventsSince(this.#lastSeq)) {
      this.#lastSeq = Math.max(this.#lastSeq, ev.seq)
      const fact = readFact(ev)
      if (fact === null) continue
      this.#writeFact(fact, tick)
      if (fact.type === 'invited') this.#onInvited(fact, tick)
    }
  }

  #writeFact(fact: RelationshipFact, tick: number): void {
    if (fact.type === 'agent_arrived') {
      this.#strangers.add(fact.agentId)
      return
    }
    if (fact.type === 'agent_departed') {
      this.#wentDownTheRoad(fact.agentId, tick)
      return
    }
    const people = peopleIn(fact)
    const partnered = this.#bridge.partnerOf(people[0]!) === people[1]
    const deltas = tiesFor(fact, { partnered, roof: this.#bridge.roofOf(people[0]!) })
    const at = this.#bridge.currentTick()
    for (const id of people) this.#mindFor(id)?.ties.apply(deltas, at, 'relationship')
    for (const m of memoryLinesFor(fact, (id) => this.#nameOf(id) ?? id)) {
      this.#tell(m.agentId, m.text, m.importance, tick)
    }
    for (const [id, occasion] of wantsFrom(fact)) this.#mindFor(id)?.feed?.([occasion], tick)
  }

  /** Somebody walked out of the valley. Everyone still holding an open tie to them learns of
   *  it — the one they belonged to hardest of all, and nobody else at all. */
  #wentDownTheRoad(agentId: string, tick: number): void {
    this.#strangers.delete(agentId)
    const name = this.#nameOf(agentId) ?? agentId
    for (const id of this.#everyone()) {
      if (id === agentId) continue
      const mind = this.#mindFor(id)
      if (mind === null) continue
      const tie = mind.ties.open().find((t) => t.personId === agentId)
      if (tie === undefined) continue
      const weight = tie.kind === 'kin' ? DEPARTED_IMPORTANCE.kin : DEPARTED_IMPORTANCE.other
      this.#tell(id, wentDownTheRoadLine(name), weight, tick)
    }
  }

  /** The first talk a stranger stands in is the one where the town finds out who they are. It
   *  is said to both sides, and once it is over they are one of the people here. */
  #tellingIfStranger(scene: Scene): void {
    const stranger = scene.participants.find((id) => this.#strangers.has(id))
    if (stranger === undefined) return
    this.#strangers.delete(stranger)
    scene.stranger = stranger
    // A quarrel or a rule put to the room is what this talk is ABOUT; being new is not.
    if (scene.kind === 'talk') scene.kind = 'telling'
  }

  /** An ask reached the world. It opens a scene between the two of them, or takes over the one
   *  either is already standing in, and hands the floor to whoever has to answer. */
  #onInvited(fact: RelationshipFact & { type: 'invited' }, tick: number): void {
    const from = fact.byId
    const to = fact.agentId
    if (this.#mindFor(to) === null) {
      this.#tell(from, noAnswerLine(this.#nameOf(to) ?? to), 7, tick)
      return
    }
    let scene = this.sceneFor(from) ?? this.sceneFor(to)
    if (scene === null) {
      scene = openScene({
        openedTick: tick,
        participants: [from, to],
        audience: this.#bridge
          .earshot(from)
          .filter((id) => id !== to && this.#mindFor(id) !== null && this.#canTalk(id)),
        opener: from,
        topic: null,
        stakes: INVITATION_STAKES,
      })
      scene.kind = 'invitation'
      this.#tellingIfStranger(scene)
      scene.stakes = this.#stakesOf(scene)
      this.#scenes.set(scene.id, scene)
      this.#announced.set(scene.id, this.#mark(scene))
      this.#bridge.announce('scene_opened', {
        id: scene.id,
        kind: scene.kind,
        participants: [...scene.participants],
        topic: scene.topic,
        stakes: scene.stakes,
      })
    } else {
      scene.kind = 'invitation'
      this.#admit(scene, from, tick)
      this.#admit(scene, to, tick)
      scene.stakes = this.#stakesOf(scene)
      this.#turned(scene)
    }
    scene.invitation = { verb: fact.verb, from, to, askedTick: tick }
    this.#floorTo(scene, to)
  }

  /** The answer, said by the one it was put to. Yes is the same verb aimed back, so the world
   *  judges the second consent at the moment it is given; no is a fact with no verb to it. */
  #answer(scene: Scene, agentId: string, turn: SceneTurn, tick: number): boolean {
    const invitation = scene.invitation
    if (invitation?.to !== agentId || turn.answer === null) return false
    delete scene.invitation
    const { from, verb } = invitation
    if (turn.answer === 'refuse') {
      const witnesses = [
        ...scene.audience,
        ...scene.participants.filter((id) => id !== from && id !== agentId),
      ].sort()
      this.#bridge.announce('invitation_refused', { agentId, byId: from, verb, witnesses })
      return true
    }
    void this.#bridge
      .submit(agentId, { verb, params: { targetId: from } }, (res) => {
        this.#accepted(scene, invitation, res, tick)
      })
      .catch(this.#sink)
    return true
  }

  /** What the world made of the yes. It is judged at the moment of the answer and not of the
   *  ask, so an asker who walked off, went to bed or married elsewhere is a moment lost. */
  #accepted(
    scene: Scene,
    invitation: NonNullable<Scene['invitation']>,
    res: SubmitResult,
    tick: number,
  ): void {
    if (!res.ok) {
      for (const id of [invitation.from, invitation.to]) {
        this.#tell(id, momentPassedLine(res.reason), 6, tick)
      }
      return
    }
    // Two bodies busy for an hour do not hold a floor.
    if (invitation.verb === 'lie_with') {
      void this.#close(scene, 'ended', this.#bridge.currentTick()).catch(this.#sink)
    }
  }

  /** An invitation put inside a talk. The floor-holder names the verb and who it is for; the
   *  scan picks the ask up next tick and aims the floor at whoever has to answer. */
  #askFrom(scene: Scene, agentId: string, turn: SceneTurn, tick: number): boolean {
    if (turn.ask === null) return false
    const others = [...scene.participants, ...scene.audience].filter((id) => id !== agentId)
    const named = turn.to === null ? null : idNamed(turn.to, others, (id) => this.#nameOf(id))
    const inTalk = scene.participants.filter((id) => id !== agentId)
    const targetId = named ?? (inTalk.length === 1 ? inTalk[0]! : null)
    if (targetId === null) return false
    const verb = turn.ask
    void this.#bridge
      .submit(agentId, { verb, params: { targetId } }, (res) => {
        if (!res.ok) this.#tell(agentId, `You could not ask: ${res.reason}.`, 4, tick)
      })
      .catch(this.#sink)
    return true
  }

  /** One line into one mind's book. Never awaited: nothing in a tick waits on a memory. */
  #tell(agentId: string, text: string, importance: number, tick: number): void {
    void this.#mindFor(agentId)?.remember({ tick, text, importance }).catch(this.#sink)
  }

  #named(ids: readonly string[]): { id: string; name: string }[] {
    return ids.map((id) => ({ id, name: this.#nameOf(id) ?? id }))
  }

  #tiesBetween(store: TieStore, scene: Scene, agentId: string): Tie[] {
    const others = new Set(scene.participants.filter((id) => id !== agentId))
    return store.open().filter((t) => others.has(t.personId))
  }

  #nameOf(agentId: string): string | null {
    return this.#bridge.agentFacts(agentId)?.name ?? null
  }
}
