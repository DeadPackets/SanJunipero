import { dayPhaseFromTick, sanitizeSpokenText, simTimeFromTick } from '@sj/shared'
import type { EngineBridge } from '../runtime/bridge.js'
import type { Tie, TieStore } from '../memory/ties.js'
import {
  appendLine,
  CLOSING_PASSES,
  FLOOR_TIMEOUT_MS,
  LINE_CAP,
  nextFloor,
  openScene,
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
   *  converge on one — the id is derived from the opening tick and the cast, not from a counter. */
  adopt(scene: Scene | null | undefined): void {
    if (scene === null || scene === undefined) return
    if (scene.closedTick !== null) return
    if (!this.#scenes.has(scene.id)) this.#scenes.set(scene.id, structuredClone(scene))
  }

  /** A word said outside any scene. If anyone heard it, that is a scene. */
  noteSpoken(agentId: string, text: string, tick: number): Scene | null {
    if (this.sceneFor(agentId) !== null) return null
    const heard = this.#bridge.earshot(agentId).filter((id) => this.#mindFor(id) !== null)
    if (heard.length === 0) return null
    const said = sanitizeSpokenText(text)
    const scene = openScene({
      openedTick: tick,
      participants: [agentId, ...heard],
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
    this.#recordLine(scene, agentId, said, '', 'none', tick)
    return scene
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
        cast: this.#castOf(scene),
        ties: this.#tiesBetween(mind.ties, scene, agentId),
        thread: threadFor(scene, agentId),
        wrapUp: wrapUpDue(scene),
      })
    } catch (err) {
      this.#onError('scene_line', err instanceof Error ? err.message : String(err))
      this.#asked.delete(scene.id)
      return
    }
    // The floor moved while the provider was thinking: a timeout already counted this as a pass.
    if (this.#asked.get(scene.id)?.token !== token) return
    this.#asked.delete(scene.id)
    if (scene.closedTick !== null) return

    if (turn.leave) {
      await this.#close(scene, 'left', tick)
      return
    }
    const said = turn.speech === null ? '' : sanitizeSpokenText(turn.speech)
    if (said.length === 0) {
      await this.#pass(scene, tick, 'ended')
      return
    }
    scene.passes = 0
    // Not awaited: an intent settles on the next tick, and the floor must not wait a tick to move.
    void this.#bridge.submit(agentId, { verb: 'speak', params: { text: said } }).catch(this.#sink)
    this.#recordLine(scene, agentId, said, turn.thought, turn.move, tick)
    if (scene.thread.length >= LINE_CAP) await this.#close(scene, 'capped', tick)
  }

  /** Every tick, once, whoever calls first: night, the ones who walked away, and the ones who
   *  never answered. */
  onTick(tick: number): void {
    if (tick === this.#lastTick) return
    this.#lastTick = tick
    const night = simTimeFromTick(tick).isNight
    for (const scene of this.open()) {
      if (night) {
        void this.#close(scene, 'night', tick).catch(this.#sink)
        continue
      }
      this.#dropAbsent(scene)
      if (scene.participants.length <= 1) {
        void this.#close(scene, 'left', tick).catch(this.#sink)
        continue
      }
      const ask = this.#asked.get(scene.id)
      if (ask !== undefined && this.#now() - ask.atMs >= FLOOR_TIMEOUT_MS) {
        this.#asked.delete(scene.id)
        void this.#pass(scene, tick, 'timeout').catch(this.#sink)
      }
    }
  }

  #sink = (err: unknown): void => {
    this.#onError('scene_close', err instanceof Error ? err.message : String(err))
  }

  /** A silence, whether the mouth chose it or the provider never answered. Two of them end it,
   *  and the second one's kind names the reason. */
  async #pass(scene: Scene, tick: number, reason: 'ended' | 'timeout'): Promise<void> {
    scene.passes += 1
    if (scene.passes >= CLOSING_PASSES) {
      await this.#close(scene, reason, tick)
      return
    }
    scene.floor = nextFloor(
      scene,
      scene.floor ?? scene.thread[scene.thread.length - 1]?.agentId ?? '',
      '',
      (id) => this.#nameOf(id),
      (id) => this.#warmthToward(scene, id),
    )
  }

  #recordLine(
    scene: Scene,
    agentId: string,
    text: string,
    aside: string,
    move: Scene['thread'][number]['move'],
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
    scene.floor = nextFloor(
      scene,
      agentId,
      text,
      (id) => this.#nameOf(id),
      (id) => this.#warmthToward(scene, id),
    )
    this.#bridge.announce('scene_line', { id: scene.id, agentId, text, move })
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

  /** Anyone out of the last speaker's earshot, or dead, has left. A sleeper keeps the floor
   *  until the timeout takes it off them, which is the same thing one beat slower. */
  #dropAbsent(scene: Scene): void {
    const anchor = scene.thread[scene.thread.length - 1]?.agentId ?? scene.participants[0]!
    const within = new Set([anchor, ...this.#bridge.earshot(anchor)])
    const kept = scene.participants.filter((id) => within.has(id) && this.#bridge.isAlive(id))
    if (kept.length === scene.participants.length) return
    scene.participants = kept
    if (scene.floor !== null && !kept.includes(scene.floor)) {
      scene.floor = kept.length > 0 ? (kept[0] ?? null) : null
    }
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
    const named = cast.map((id) => ({ id, name: this.#nameOf(id) ?? id }))
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
    for (const id of cast) {
      const mind = this.#mindFor(id)
      if (mind === null) continue
      await mind.remember({ tick, text: summary, importance }).catch(this.#sink)
    }
  }

  #castOf(scene: Scene): { id: string; name: string }[] {
    return scene.participants.map((id) => ({ id, name: this.#nameOf(id) ?? id }))
  }

  #tiesBetween(store: TieStore, scene: Scene, agentId: string): Tie[] {
    const others = new Set(scene.participants.filter((id) => id !== agentId))
    return store.open().filter((t) => others.has(t.personId))
  }

  #nameOf(agentId: string): string | null {
    return this.#bridge.agentFacts(agentId)?.name ?? null
  }

  /** How warm the mind who just spoke feels toward a candidate for the floor. */
  #warmthToward(scene: Scene, candidateId: string): number {
    const speaker = scene.thread[scene.thread.length - 1]?.agentId
    if (speaker === undefined) return 0
    return this.#mindFor(speaker)?.warmth(candidateId) ?? 0
  }
}
