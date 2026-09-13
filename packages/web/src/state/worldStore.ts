import {
  SimConfigSchema,
  type AssetRecord,
  type ServerBoard,
  type ServerDirector,
  type ServerMind,
  type ServerMsg,
  type ServerScene,
  type ServerThreads,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { fold } from '@sj/engine/fold'
import type { WorldState } from '@sj/engine/state'
import { isNarratable } from '../ui/chronicleFormat.js'
import { createTension, type Tension } from '../render/tension.js'

const THOUGHT_LOG_CAP = 200
/** Narratable events only — see the filter in `applyServer`. */
const RECENT_EVENTS_CAP = 400

/** Three states, not two: LIVE, a STILL scrub pinned to one minute, and a REPLAY walking the
 *  past forward. A replay is not live — it never moves the live watermark — but its time moves. */
type ViewMode = { live: true } | { live: false; replaying: boolean; tick: number }
type Thought = { agentId: string; tick: number; text: string; importance: number }
/** A provider call in flight, or one that has landed. The wire's own two words. */
export type MindState = ServerMind['state']
/** The coordinator's scene as the frame states it. Named apart from `render/scene.ts`'s `Scene`,
 *  which is the Pixi handle and has nothing to do with this. */
export type TownScene = ServerScene['scene']
// Law flips are kept whole, outside the capped delta ring: a town's legal history
// is short and must not scroll away behind four hundred footsteps.
type LawChange = { tick: number; path: string; value: unknown }

const NO_SCENES: readonly TownScene[] = []

/** What a frame the view could not take asks of whoever delivered it: a fresh snapshot, or a
 *  bundle that can read this town at all. */
type Trouble = 'reload' | 'resnapshot'

// Declared as properties, not methods: every reader hands `store.getState` to
// `useSyncExternalStore` unbound, and the store is closures with no `this`.
export type WorldStore = {
  getState: () => WorldState | null
  getMode: () => ViewMode
  /** Is the clock on screen advancing? The question every reader that folds a delta or walks a
   *  body is really asking — live and replaying both answer yes, a still scrub answers no. */
  timeMoving: () => boolean
  /** The operator has stopped the world clock. The town is still served; it is not moving. */
  getPaused: () => boolean
  getTick: () => number
  /** the furthest tick the LIVE town has reached — scrubbing back must not walk it in */
  liveEdge: () => number
  latestThought: (agentId: string) => { tick: number; text: string } | null
  /** The word the mind itself holds about how it is; null until the town has said one. */
  latestMood: (agentId: string) => string | null
  thoughtsLog: () => Thought[]
  /** Every thought ever heard, the ones the capped log has already dropped included: an index
   *  into the log is reused the moment it is trimmed, so a reader counts from here. */
  thoughtsSeq: () => number
  recentEvents: () => SimEvent[]
  /** The scene the town holds under this id, open or standing on the summary its closing frame
   *  carried. The town runs many at once, so nobody may ask it for "the scene". */
  sceneById: (id: string) => TownScene | null
  /** Every scene open right now, in the order the town opened them. */
  openScenes: () => readonly TownScene[]
  /** The scene the camera is framing: the town's own cut, or the talk a pinned body is in. The
   *  director writes it, because a viewer's own pin is client state the wire never carries. */
  shotScene: () => TownScene | null
  setShotScene: (id: string | null) => void
  /** The bars of every talk, folded ONCE for the whole page: two folds of one event stream
   *  drift, and an instance built later than the scene never hears it open. */
  tension: Omit<Tension, 'destroy'>
  /** What the gateway says is worth watching, and the act the day has reached. One frame, kept
   *  until the next one changes it — the camera, the cue and the stamp all read this one. */
  getDirector: () => ServerDirector | null
  /** The stories the gateway is running, ranked. Dropped with the director and for the same
   *  reason: they are about the live minute, not the one a scrub is standing in. */
  threads: () => ServerThreads | null
  /** The gateway's own survey, not just the row it cut to. */
  board: () => ServerBoard | null
  /** Who is thinking right now, and as of when. Dropped on a scrub and a replay with the
   *  director and the board, for the same reason: it is about the live minute. */
  minds: () => ReadonlyMap<string, { state: MindState; tick: number }>
  assetsSeq: () => number
  assetRecords: () => AssetRecord[]
  /** The world log's head as the server last reported it — the signal a read model refetches on,
   *  instead of on a wall-clock timer. */
  logSeq: () => number
  getConfig: () => SimConfig | null
  getLaws: () => Record<string, unknown>
  lawHistory: () => LawChange[]
  applyServer: (msg: ServerMsg) => Trouble | null
  subscribe: (fn: () => void) => () => void
  onEvents: (fn: (evts: SimEvent[]) => void) => () => void
}

export function createWorldStore(): WorldStore {
  let state: WorldState | null = null
  let config: SimConfig | null = null // arrives inside the snapshot message — never assumed
  let mode: ViewMode = { live: true }
  let paused = false
  let liveEdge = 0
  let assetsSeq = 0
  let thoughtsSeq = 0
  let logSeq = 0
  const records: AssetRecord[] = []
  const thoughts: Thought[] = []
  const latest = new Map<string, { tick: number; text: string }>()
  const moods = new Map<string, string>()
  const events: SimEvent[] = []
  const scenes = new Map<string, TownScene>()
  let openList: readonly TownScene[] = NO_SCENES
  let director: ServerDirector | null = null
  let threads: ServerThreads | null = null
  let board: ServerBoard | null = null
  // Swapped, never mutated: `useSyncExternalStore` re-renders on identity, so a Map edited in
  // place leaves the rail showing the minute before this one.
  let minds: ReadonlyMap<string, { state: MindState; tick: number }> = new Map()
  const setMind = (agentId: string, state: MindState, tick: number): void => {
    if (minds.get(agentId)?.state === state) return
    minds = new Map(minds).set(agentId, { state, tick })
  }
  let laws: Record<string, unknown> = {}
  const lawChanges: LawChange[] = []
  const subs = new Set<() => void>()
  const eventSubs = new Set<(evts: SimEvent[]) => void>()
  const timeMoving = (): boolean => mode.live || mode.replaying
  const onEvents = (fn: (evts: SimEvent[]) => void): (() => void) => {
    eventSubs.add(fn)
    return () => eventSubs.delete(fn)
  }
  const tension = createTension({ onEvents })
  let shotSceneId: string | null = null
  const forgetScenes = (): void => {
    scenes.clear()
    openList = NO_SCENES
    shotSceneId = null
    tension.forget()
  }

  // Every subscriber pass is a full entity sync, so a burst is coalesced onto the next frame.
  // Off a browser there is no frame to wait for and the pass stays synchronous.
  let pending = false
  const flush = (): void => {
    pending = false
    for (const fn of subs) fn()
  }
  const notify = (): void => {
    if (typeof requestAnimationFrame !== 'function') {
      flush()
      return
    }
    if (pending) return
    pending = true
    requestAnimationFrame(flush)
  }

  return {
    getState: () => state,
    getMode: () => mode,
    timeMoving,
    getPaused: () => paused,
    getTick: () => (mode.live ? (state?.tick ?? 0) : mode.tick),
    liveEdge: () => liveEdge,
    latestThought: (agentId) => latest.get(agentId) ?? null,
    latestMood: (agentId) => moods.get(agentId) ?? null,
    thoughtsLog: () => thoughts,
    thoughtsSeq: () => thoughtsSeq,
    recentEvents: () => events,
    sceneById: (id) => scenes.get(id) ?? null,
    openScenes: () => openList,
    // The director owns this, because a viewer's own pin is client state the wire never carries.
    // It is written on every shot, so the town's cut is not a fallback: it is what the director
    // hands over when nobody has pinned anybody.
    setShotScene: (id) => {
      if (id === shotSceneId) return
      shotSceneId = id
      for (const fn of subs) fn()
    },
    shotScene: () => (shotSceneId === null ? null : (scenes.get(shotSceneId) ?? null)),
    tension,
    getDirector: () => director,
    threads: () => threads,
    board: () => board,
    minds: () => minds,
    assetsSeq: () => assetsSeq,
    logSeq: () => logSeq,
    assetRecords: () => records,
    getConfig: () => config,
    getLaws: () => laws,
    lawHistory: () => lawChanges,

    applyServer(msg) {
      switch (msg.t) {
        case 'snapshot': {
          // strict: the live view must fold with the engine's exact config, and a tab left open
          // across a config change cannot — only a reload fetches a bundle that can.
          const carried = SimConfigSchema.safeParse(msg.config)
          if (!carried.success) return 'reload'
          logSeq = msg.seq
          config = carried.data
          state = msg.state as WorldState
          laws = msg.laws
          paused = msg.paused ?? false
          mode = { live: true }
          break
        }
        case 'paused':
          paused = msg.paused
          break
        case 'tick':
          // The hub resyncs a drained viewer with a snapshot taken AFTER the deltas it then
          // sends: refolding an event this state already has throws, and the town stops.
          if (msg.seq <= logSeq) return null
          logSeq = msg.seq
          // deltas advance whatever clock is moving; while scrubbed the past moment stays still
          if (timeMoving() && state !== null && config !== null) {
            // Folded aside first: a throw halfway through must not leave half a town on screen.
            let next = state
            try {
              for (const ev of msg.events) next = fold(next, ev, config)
            } catch {
              return 'resnapshot'
            }
            state = next
            // The replay's own playhead, so every reader of `mode.tick` follows the past forward.
            if (!mode.live) mode = { live: false, replaying: true, tick: next.tick }
            for (const ev of msg.events) {
              if (ev.type !== 'config_changed') continue
              const p = ev.payload as { path?: unknown; value?: unknown }
              if (typeof p.path !== 'string') continue
              laws = { ...laws, [p.path]: p.value }
              lawChanges.push({ tick: ev.tick, path: p.path, value: p.value })
            }
            // Only what the chronicle can narrate: unnarratable events would push a death out
            // of the ring. Every event still folds into state above and reaches `onEvents`.
            for (const ev of msg.events) if (isNarratable(ev)) events.push(ev)
            if (events.length > RECENT_EVENTS_CAP)
              events.splice(0, events.length - RECENT_EVENTS_CAP)
            for (const fn of eventSubs) fn(msg.events)
          }
          break
        case 'scrubbed':
          state = msg.state as WorldState
          mode = { live: false, replaying: false, tick: msg.tick }
          // The live cut is about the live minute. Left standing it aimed the camera and the
          // caption at people doing something that has not happened in the minute on screen.
          director = null
          threads = null
          board = null
          minds = new Map()
          forgetScenes()
          break
        case 'replaying':
          // The log head goes BACK to where this state was taken: the recorded deltas that follow
          // carry their own old seqs, and the guard above must read them as the rise they are.
          logSeq = msg.seq
          state = msg.state as WorldState
          mode = { live: false, replaying: true, tick: msg.tick }
          director = null
          threads = null
          board = null
          minds = new Map()
          forgetScenes()
          break
        case 'mood':
          moods.set(msg.agentId, msg.mood)
          break
        case 'thought':
          thoughtsSeq++
          thoughts.push({
            agentId: msg.agentId,
            tick: msg.tick,
            text: msg.text,
            importance: msg.importance,
          })
          if (thoughts.length > THOUGHT_LOG_CAP)
            thoughts.splice(0, thoughts.length - THOUGHT_LOG_CAP)
          latest.set(msg.agentId, { tick: msg.tick, text: msg.text })
          // A landed thought ends the flight whether or not the `idle` frame beat it here.
          setMind(msg.agentId, 'idle', msg.tick)
          break
        case 'assets':
          records.push(...msg.records)
          assetsSeq += msg.records.length
          break
        case 'scene':
          // Only the newest close is ever on screen, so an older one goes rather than sit here
          // for the life of the session.
          if (!msg.scene.open) {
            for (const [id, held] of scenes) if (!held.open) scenes.delete(id)
          }
          scenes.set(msg.scene.id, msg.scene)
          openList = [...scenes.values()].filter((held) => held.open)
          break
        case 'director':
          director = msg
          break
        case 'board':
          board = msg
          break
        case 'threads':
          threads = msg
          break
        case 'mind':
          setMind(msg.agentId, msg.state, msg.tick)
          break
      }
      if (mode.live) liveEdge = Math.max(liveEdge, state?.tick ?? 0)
      notify()
      return null
    },

    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    onEvents,
  }
}

/** Run `fn` the moment the world can be asked anything — now, if it already can. An address is
 *  read before the first snapshot lands, so the town cannot yet say if what it names is real. */
export function onFirstSnapshot(store: WorldStore, fn: () => void): () => void {
  if (store.getState() !== null) {
    fn()
    return () => undefined
  }
  const off = store.subscribe(() => {
    if (store.getState() === null) return
    off()
    fn()
  })
  return off
}
