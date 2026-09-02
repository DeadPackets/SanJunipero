import { dayPhaseFromTick, sanitizeSpokenText } from '@sj/shared'
import type { EngineBridge } from '../runtime/bridge.js'
import type { Tie, TieStore } from '../memory/ties.js'
import {
  addressedIn,
  appendLine,
  CLOSING_TIMEOUTS,
  FLOOR_TIMEOUT_MS,
  lineCapOf,
  nextFloor,
  openScene,
  TALKERS_NEEDED,
  threadFor,
  upgradedKind,
  wrapUpDue,
  type Scene,
  type SceneLlm,
  type SceneTurn,
  type TieDelta,
} from './scene.js'

/** What one mind lends a scene: the call it pays for, the ties it holds, the memory the scene
 *  leaves it, and how warm it feels toward whoever else is standing there. */
export type SceneMind = {
  llm: SceneLlm
  ties: TieStore
  remember(m: { tick: number; text: string; importance: number }): Promise<void>
  warmth(otherId: string): number
}

/** A scene as a checkpoint holds it. The three fields a talk gained when it learned to have an
 *  audience are absent in anything written before that, and a live run has to resume anyway. */
type StoredScene = Omit<Scene, 'audience' | 'anchor' | 'timeouts'> &
  Partial<Pick<Scene, 'audience' | 'anchor' | 'timeouts'>>

export type SceneCoordinatorOpts = {
  bridge: EngineBridge
  mindFor: (agentId: string) => SceneMind | null
  /** The wall clock the floor timeout is measured on. Injected so a test need not wait 30 s. */
  now?: () => number
  onError?: (kind: string, detail: string) => void
}

// A scene opens with everything still to play for, and nothing has told us otherwise yet.
const OPENING_STAKES = 5
// Three expressers on the plaza at dusk is a crowd, not a pair.
const GATHERING_MINIMUM = 3
// A coordinator with nobody to tell drops what it would have reported.
const NO_REPORT = (): void => {
  /* nothing to tell */
}

/** One per world. It hears every word, decides who holds the floor, and is the only thing that
 *  knows a conversation is a conversation. */
export class SceneCoordinator {
  readonly #bridge: EngineBridge
  readonly #mindFor: (agentId: string) => SceneMind | null
  readonly #now: () => number
  readonly #onError: (kind: string, detail: string) => void
  readonly #scenes = new Map<string, Scene>()
  /** The ask now in flight, per scene: who was asked and when, in wall-clock ms. A late answer
   *  to a stale token is dropped — the floor has already moved on. */
  readonly #asked = new Map<string, { agentId: string; atMs: number; token: number }>()
  #token = 0
  #lastTick = -1

  constructor(opts: SceneCoordinatorOpts) {
    this.#bridge = opts.bridge
    this.#mindFor = opts.mindFor
    this.#now = opts.now ?? Date.now
    this.#onError = opts.onError ?? NO_REPORT
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
    const back = structuredClone(scene)
    this.#scenes.set(back.id, {
      ...back,
      audience: back.audience ?? [],
      anchor: back.anchor ?? back.participants[0] ?? '',
      timeouts: back.timeouts ?? 0,
    })
  }

  /** A word said by a mind in no scene. Inside an open scene's earshot it is a line of THAT
   *  scene and the mouth joins it; otherwise, if anyone who could answer heard it, it opens one
   *  between the speaker and the mind they spoke to, and everybody else stands and listens. */
  noteSpoken(agentId: string, text: string, tick: number): Scene | null {
    if (this.sceneFor(agentId) !== null) return null
    const said = sanitizeSpokenText(text)
    const joined = this.#joinNearby(agentId, said, tick)
    if (joined !== null) return joined
    const heard = this.#bridge
      .earshot(agentId)
      .filter((id) => this.#mindFor(id) !== null && this.#canTalk(id))
    if (heard.length + 1 < TALKERS_NEEDED) return null
    const answering =
      addressedIn(said, heard, (id) => this.#nameOf(id)) ?? this.#bridge.nearestOf(agentId, heard)
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
    if (scene.kind === 'council') scene.proposal = { lawText: said, predicate: { kind: 'none' } }
    this.#scenes.set(scene.id, scene)
    this.#bridge.announce('scene_opened', {
      id: scene.id,
      kind: scene.kind,
      participants: [...scene.participants],
      topic: scene.topic,
      stakes: scene.stakes,
    })
    this.#recordLine(scene, agentId, said, '', 'none', null, tick)
    return scene
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
    appendLine(scene, { agentId, text: '', aside: '', move: 'none', tick, presence: 'joined' })
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
      scene.floor = scene.participants.length === 0 ? null : scene.anchor
    }
  }

  /** The one turn a scene ever takes. Called by the floor-holder's own runtime, so the cost of
   *  a line is booked to the mouth that said it and to nobody listening. */
  async takeFloor(agentId: string, tick: number): Promise<void> {
    const scene = this.sceneFor(agentId)
    if (scene?.floor !== agentId) return
    const mind = this.#mindFor(agentId)
    if (mind === null) return
    const token = ++this.#token
    this.#asked.set(scene.id, { agentId, atMs: this.#now(), token })
    let turn: SceneTurn
    try {
      turn = await mind.llm.line({
        scene: structuredClone(scene),
        agentId,
        cast: this.#named(scene.participants),
        audience: this.#named(scene.audience),
        ties: this.#tiesBetween(mind.ties, scene, agentId),
        thread: threadFor(scene, agentId),
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
    if (this.#asked.get(scene.id)?.token !== token) return
    this.#asked.delete(scene.id)
    // Or the mouth left the talk while the provider was thinking: went to bed, or walked out of
    // earshot. Saying the line now would wake a sleeper with its own words.
    if (scene.closedTick !== null || !scene.participants.includes(agentId)) return

    if (turn.leave) {
      await this.#close(scene, 'left', tick)
      return
    }
    const said = turn.speech === null ? '' : sanitizeSpokenText(turn.speech)
    if (said.length === 0) {
      await this.#pass(scene, tick)
      return
    }
    scene.passes = 0
    scene.timeouts = 0
    // Not awaited: an intent settles on the next tick, and the floor must not wait a tick to move.
    void this.#bridge.submit(agentId, { verb: 'speak', params: { text: said } }).catch(this.#sink)
    this.#recordLine(scene, agentId, said, turn.thought, turn.move, turn.to, tick)
    if (scene.thread.length >= lineCapOf(scene)) await this.#close(scene, 'capped', tick)
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

  /** Every tick, once, whoever calls first: the ones who walked away or went to bed, and the
   *  ones who never answered. */
  onTick(tick: number): void {
    if (tick === this.#lastTick) return
    this.#lastTick = tick
    for (const scene of this.open()) {
      this.#dropAbsent(scene, tick)
      if (scene.participants.length < TALKERS_NEEDED) {
        void this.#close(scene, 'left', tick).catch(this.#sink)
        continue
      }
      const ask = this.#asked.get(scene.id)
      if (ask !== undefined && this.#now() - ask.atMs >= FLOOR_TIMEOUT_MS) {
        this.#asked.delete(scene.id)
        void this.#timedOut(scene, tick).catch(this.#sink)
      }
    }
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
    scene.floor = this.#floorAfter(scene, quiet, '', null)
  }

  /** A provider that never came back. The floor moves on and nobody is asked twice for the same
   *  line; two silences in a row is a scene nothing is coming back from. */
  async #timedOut(scene: Scene, tick: number): Promise<void> {
    scene.timeouts += 1
    if (scene.timeouts >= CLOSING_TIMEOUTS) {
      await this.#close(scene, 'timeout', tick)
      return
    }
    scene.floor = this.#floorAfter(scene, scene.floor ?? scene.anchor, '', null)
  }

  #recordLine(
    scene: Scene,
    agentId: string,
    text: string,
    aside: string,
    move: Scene['thread'][number]['move'],
    to: string | null,
    tick: number,
  ): void {
    appendLine(scene, { agentId, text, aside, move, tick })
    const upgraded = this.#kindAfter(scene, text, tick)
    if (upgraded !== scene.kind) {
      scene.kind = upgraded
      if (upgraded === 'council' && scene.proposal === undefined) {
        scene.proposal = { lawText: text, predicate: { kind: 'none' } }
      }
    }
    const next = this.#floorAfter(scene, agentId, text, to)
    if (next !== null) this.#admit(scene, next, tick)
    scene.floor = next
    this.#bridge.announce('scene_line', { id: scene.id, agentId, text, move })
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
    const spoke = scene.thread.filter((l) => l.presence === undefined)
    const ear = spoke[spoke.length - 1]?.agentId ?? scene.anchor
    const within = new Set([ear, ...this.#bridge.earshot(ear)])
    const here = (id: string): boolean => within.has(id) && this.#canTalk(id)
    for (const id of scene.participants.filter((id) => !here(id))) this.#part(scene, id, tick)
    scene.audience = scene.audience.filter(here)
  }

  async #close(
    scene: Scene,
    reason: NonNullable<Scene['closeReason']>,
    tick: number,
  ): Promise<void> {
    if (scene.closedTick !== null) return
    scene.closedTick = tick
    scene.closeReason = reason
    scene.floor = null
    this.#asked.delete(scene.id)
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
    const at = this.#bridge.currentTick()
    for (const id of cast) this.#mindFor(id)?.ties.apply(deltas, at)
    this.#bridge.announce('scene_closed', {
      id: scene.id,
      summary,
      deltas,
      closeReason: reason,
    })
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
