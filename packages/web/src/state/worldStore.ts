import {
  SimConfigSchema,
  type AssetRecord,
  type ServerMsg,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { fold } from '@sj/engine/fold'
import type { WorldState } from '@sj/engine/state'
import { isNarratable } from '../ui/chronicleFormat.js'

const THOUGHT_LOG_CAP = 200
/** Narratable events only — see the filter in `applyServer`. */
const RECENT_EVENTS_CAP = 400

type ViewMode = { live: true } | { live: false; tick: number }
type Thought = { agentId: string; tick: number; text: string }
// Law flips are kept whole, outside the capped delta ring: a town's legal history
// is short and must not scroll away behind four hundred footsteps.
type LawChange = { tick: number; path: string; value: unknown }

// Declared as properties, not methods: every reader hands `store.getState` to
// `useSyncExternalStore` unbound, and the store is closures with no `this`.
export type WorldStore = {
  getState: () => WorldState | null
  getMode: () => ViewMode
  /** The operator has stopped the world clock. The town is still served; it is not moving. */
  getPaused: () => boolean
  getTick: () => number
  /** the furthest tick the LIVE town has reached — scrubbing back must not walk it in */
  liveEdge: () => number
  latestThought: (agentId: string) => { tick: number; text: string } | null
  thoughtsLog: () => Thought[]
  recentEvents: () => SimEvent[]
  assetsSeq: () => number
  assetRecords: () => AssetRecord[]
  /** The world log's head as the server last reported it — the signal a read model refetches on,
   *  instead of on a wall-clock timer. */
  logSeq: () => number
  getConfig: () => SimConfig | null
  getLaws: () => Record<string, unknown>
  lawHistory: () => LawChange[]
  applyServer: (msg: ServerMsg) => void
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
  let logSeq = 0
  const records: AssetRecord[] = []
  const thoughts: Thought[] = []
  const latest = new Map<string, { tick: number; text: string }>()
  const events: SimEvent[] = []
  let laws: Record<string, unknown> = {}
  const lawChanges: LawChange[] = []
  const subs = new Set<() => void>()
  const eventSubs = new Set<(evts: SimEvent[]) => void>()

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
    getPaused: () => paused,
    getTick: () => (mode.live ? (state?.tick ?? 0) : mode.tick),
    liveEdge: () => liveEdge,
    latestThought: (agentId) => latest.get(agentId) ?? null,
    thoughtsLog: () => thoughts,
    recentEvents: () => events,
    assetsSeq: () => assetsSeq,
    logSeq: () => logSeq,
    assetRecords: () => records,
    getConfig: () => config,
    getLaws: () => laws,
    lawHistory: () => lawChanges,

    applyServer(msg) {
      switch (msg.t) {
        case 'snapshot':
          logSeq = msg.seq
          config = SimConfigSchema.parse(msg.config) // strict: live view must fold with the engine's exact config
          state = msg.state as WorldState
          laws = msg.laws
          paused = msg.paused ?? false
          mode = { live: true }
          break
        case 'paused':
          paused = msg.paused
          break
        case 'tick':
          logSeq = msg.seq
          // deltas only advance the live view; while scrubbed the past moment stays still
          if (mode.live && state !== null && config !== null) {
            for (const ev of msg.events) state = fold(state, ev, config)
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
          mode = { live: false, tick: msg.tick }
          break
        case 'thought':
          thoughts.push({ agentId: msg.agentId, tick: msg.tick, text: msg.text })
          if (thoughts.length > THOUGHT_LOG_CAP)
            thoughts.splice(0, thoughts.length - THOUGHT_LOG_CAP)
          latest.set(msg.agentId, { tick: msg.tick, text: msg.text })
          break
        case 'assets':
          records.push(...msg.records)
          assetsSeq += msg.records.length
          break
      }
      if (mode.live) liveEdge = Math.max(liveEdge, state?.tick ?? 0)
      notify()
    },

    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    onEvents(fn) {
      eventSubs.add(fn)
      return () => eventSubs.delete(fn)
    },
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
