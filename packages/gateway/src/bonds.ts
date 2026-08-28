import type Database from 'better-sqlite3'
import {
  bondId,
  foldBond,
  type Bond,
  type BondFold,
  type BondKind,
  type BondsResponse,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { TALK_WINDOW_TICKS } from './api.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { toEvent, type EventRow } from './http.js'

// Each rule here is one observable act, not a semantic.
const VERB_BONDS: Readonly<Record<string, BondKind>> = {
  give: 'owe',
  teach: 'work',
  attack: 'rival',
}

/** The whole of what `buildBonds` folds; every other type falls through its chain untouched. */
export const BOND_TYPES: readonly string[] = [
  'agent_spoke',
  'action_started',
  'action_completed',
  'co_slept',
  'agent_born',
]

/**
 * Ticks between rebuilds. The graph is folded from the WHOLE bond history — measured 4.2 ms over
 * 1,605 rows at tick 5,000, and linear in the town's age — so keying the memo on the mirror's
 * generation rebuilt it on the tick thread every tick a viewer's poll landed in. Warmth's
 * half-life is 2,880 ticks, so 20 moves `asOfTick` by under 1% of it.
 */
export const BONDS_REBUILD_TICKS = 20

export type BondsDeps = {
  db: Database.Database
  mirror: WorldMirror
  config: SimConfig
}

/**
 * A bond is folded, not accumulated (`foldBond` in `@sj/shared`): what is kept per pair is a
 * 24-act window, six rollup rows and three scalars — a constant, whatever the town's age.
 */
export function buildBonds(
  events: Iterable<SimEvent>,
  earshot: number,
  asOfTick: number,
): BondsResponse {
  const drafts = new Map<string, BondFold>()

  const tie = (a: string, b: string, kind: BondKind, tick: number): void => {
    if (a === b) return
    const id = bondId(a, b)
    let fold = drafts.get(id)
    if (fold === undefined) {
      fold = foldBond(a, b, asOfTick)
      drafts.set(id, fold)
    }
    fold.add(kind, tick)
  }

  // Every spoke against every earlier spoke is O(n²) and a badge polls this. A spoke older than
  // the talk window can pair with nothing ever again, so dropping it is the same answer in
  // bounded time.
  let spokes: { agentId: string; tick: number; x: number; y: number }[] = []
  const started = new Map<string, Record<string, unknown>>() // `${agentId}\n${verb}` → params

  for (const ev of events) {
    if (ev.type === 'agent_spoke') {
      const p = ev.payload as { agentId: string; x: number; y: number }
      if (spokes.length > 0 && spokes[0]!.tick < ev.tick - TALK_WINDOW_TICKS) {
        spokes = spokes.filter((s) => ev.tick - s.tick <= TALK_WINDOW_TICKS)
      }
      for (const prev of spokes) {
        if (prev.agentId === p.agentId) continue
        if (Math.hypot(p.x - prev.x, p.y - prev.y) > earshot) continue
        tie(prev.agentId, p.agentId, 'friend', ev.tick)
      }
      spokes.push({ agentId: p.agentId, tick: ev.tick, x: p.x, y: p.y })
    } else if (ev.type === 'action_started') {
      const p = ev.payload as { agentId: string; verb: string; params: Record<string, unknown> }
      if (VERB_BONDS[p.verb] !== undefined) started.set(`${p.agentId}\n${p.verb}`, p.params)
    } else if (ev.type === 'action_completed') {
      const p = ev.payload as { agentId: string; verb: string }
      const kind = VERB_BONDS[p.verb]
      if (kind === undefined) continue
      const targetId = started.get(`${p.agentId}\n${p.verb}`)?.targetId
      if (typeof targetId === 'string') tie(p.agentId, targetId, kind, ev.tick)
    } else if (ev.type === 'co_slept') {
      const p = ev.payload as { aId: string; bId: string }
      tie(p.aId, p.bId, 'partner', ev.tick)
    } else if (ev.type === 'agent_born') {
      const p = ev.payload as { id: string; motherId: string; fatherId: string }
      for (const parent of [p.motherId, p.fatherId]) tie(parent, p.id, 'kin', ev.tick)
    }
  }

  const bonds: Bond[] = [...drafts.values()]
    .map((fold): Bond => fold.bond())
    .sort((a, b) => a.id.localeCompare(b.id))
  return { bonds, asOfTick }
}

export function mountBondsApi(router: Router, deps: BondsDeps): void {
  const selEvents = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events WHERE type IN (${BOND_TYPES.map(() => '?').join(', ')})
     ORDER BY seq`,
  )
  // A filtered scan per CADENCE, not per generation; see seqCache.ts for why a public stream
  // cannot pay one per viewer, and BONDS_REBUILD_TICKS for why it cannot pay one per tick either.
  const cache = makeSeqCache(() => Math.floor(deps.mirror.state().tick / BONDS_REBUILD_TICKS))

  const bonds = (): BondsResponse =>
    cache.value('bonds', () => {
      // Streamed, so the rows and the parsed events are never both fully materialised: measured on
      // this shape at 86.9 MB of retained log, see the fold note in `api.ts`.
      const events = function* (): Generator<SimEvent> {
        for (const r of selEvents.iterate(...BOND_TYPES) as Iterable<EventRow>) yield toEvent(r)
      }
      return buildBonds(events(), deps.config.movement.earshotRadius, deps.mirror.state().tick)
    })

  router.route('GET', '/api/bonds', (_req, res) => {
    sendPrebuilt(res, cache.json('bonds', bonds))
  })
}
