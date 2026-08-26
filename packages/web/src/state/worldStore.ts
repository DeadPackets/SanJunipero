import { SimConfigSchema, type AssetRecord, type ServerMsg, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '@sj/engine/fold'
import type { WorldState } from '@sj/engine/state'
import { isNarratable } from '../ui/chronicleFormat.js'

export const THOUGHT_LOG_CAP = 200
/** Narratable events only — see the filter in `applyServer`. */
export const RECENT_EVENTS_CAP = 400

export type ViewMode = { live: true } | { live: false; tick: number }
export type Thought = { agentId: string; tick: number; text: string }
// Law flips are kept whole, outside the capped delta ring: a town's legal history
// is short and must not scroll away behind four hundred footsteps.
export type LawChange = { tick: number; path: string; value: unknown }

export type WorldStore = {
  getState(): WorldState | null
  getMode(): ViewMode
  getTick(): number
  latestThought(agentId: string): { tick: number; text: string } | null
  thoughtsLog(): Thought[]
  recentEvents(): SimEvent[]
  assetsSeq(): number
  assetRecords(): AssetRecord[]
  getConfig(): SimConfig | null
  getLaws(): Record<string, unknown>
  lawHistory(): LawChange[]
  applyServer(msg: ServerMsg): void
  subscribe(fn: () => void): () => void
  onEvents(fn: (evts: SimEvent[]) => void): () => void
}

export function createWorldStore(): WorldStore {
  let state: WorldState | null = null
  let config: SimConfig | null = null // arrives inside the snapshot message — never assumed
  let mode: ViewMode = { live: true }
  let assetsSeq = 0
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
    if (typeof requestAnimationFrame !== 'function') { flush(); return }
    if (pending) return
    pending = true
    requestAnimationFrame(flush)
  }

  return {
    getState: () => state,
    getMode: () => mode,
    getTick: () => (mode.live ? state?.tick ?? 0 : mode.tick),
    latestThought: (agentId) => latest.get(agentId) ?? null,
    thoughtsLog: () => thoughts,
    recentEvents: () => events,
    assetsSeq: () => assetsSeq,
    assetRecords: () => records,
    getConfig: () => config,
    getLaws: () => laws,
    lawHistory: () => lawChanges,

    applyServer(msg) {
      switch (msg.t) {
        case 'snapshot':
          config = SimConfigSchema.parse(msg.config) // strict: live view must fold with the engine's exact config
          state = msg.state as WorldState
          laws = msg.laws
          mode = { live: true }
          break
        case 'tick':
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
            if (events.length > RECENT_EVENTS_CAP) events.splice(0, events.length - RECENT_EVENTS_CAP)
            for (const fn of eventSubs) fn(msg.events)
          }
          break
        case 'scrubbed':
          state = msg.state as WorldState
          mode = { live: false, tick: msg.tick }
          break
        case 'thought':
          thoughts.push({ agentId: msg.agentId, tick: msg.tick, text: msg.text })
          if (thoughts.length > THOUGHT_LOG_CAP) thoughts.splice(0, thoughts.length - THOUGHT_LOG_CAP)
          latest.set(msg.agentId, { tick: msg.tick, text: msg.text })
          break
        case 'asset':
          records.push(msg.record)
          assetsSeq += 1
          break
      }
      notify()
    },

    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    onEvents(fn) { eventSubs.add(fn); return () => eventSubs.delete(fn) },
  }
}
