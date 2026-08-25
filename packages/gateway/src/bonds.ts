import type Database from 'better-sqlite3'
import {
  bondId, foldBond,
  type Bond, type BondFold, type BondKind, type BondsResponse, type SimConfig, type SimEvent,
} from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { TALK_WINDOW_TICKS } from './api.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'

// What the town did, read as what the town became. Each rule is one observable act; the
// SEMANTICS (trust, debt, grudge, love from the ledgers) stay C9 T11/T12's job — when they
// land this reader swaps and BondSchema does not move. `BOND_NOTES` moved to `@sj/shared` so
// the viewer can name the six acts without reading the server — see the Bonds empty state.
export { BOND_NOTES } from '@sj/shared'

const VERB_BONDS: Readonly<Record<string, BondKind>> = { give: 'owe', teach: 'work', attack: 'rival' }

export type BondsDeps = {
  db: Database.Database
  mirror: WorldMirror
  config: SimConfig
}

/**
 * ★ A BOND IS FOLDED, NOT ACCUMULATED — see `foldBond` in `@sj/shared`.
 *
 * The draft used to be the whole `BondEvent[]`, so the answer was the size of the town's whole
 * history: 83 704 521 B at sim-day 20 of a talkative town, and the panel asked for it every
 * 30 s per viewer. What is kept per pair is now a 24-act window, six rollup rows and three
 * scalars — a constant, whatever the town's age.
 */
export function buildBonds(events: SimEvent[], earshot: number, asOfTick: number): BondsResponse {
  const drafts = new Map<string, BondFold>()

  const tie = (a: string, b: string, kind: BondKind, tick: number): void => {
    if (a === b) return
    const id = bondId(a, b)
    let fold = drafts.get(id)
    if (fold === undefined) { fold = foldBond(a, b, asOfTick); drafts.set(id, fold) }
    fold.add(kind, tick)
  }

  // ★ EVERY SPOKE AGAINST EVERY EARLIER SPOKE IS O(n²), AND IT IS THE ONE ENDPOINT A BADGE
  // POLLS. Measured at sim-day 20 of a talkative town: `/api/bonds` took 38.4 s on the tick
  // thread. A spoke older than the talk window is skipped by the next line, so it can pair with
  // nothing ever again — dropping it is the same answer in bounded time. `api.ts` does the same
  // to the same array for the same reason.
  let spokes: Array<{ agentId: string; tick: number; x: number; y: number }> = []
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
  const selEvents = deps.db.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq')
  // Whole-log scan per request; see seqCache.ts for why a public stream cannot pay that per viewer.
  const cache = makeSeqCache(() => deps.mirror.seq())

  const bonds = (): BondsResponse => cache.value('bonds', () => {
    const events = (selEvents.all() as Array<{ seq: number; tick: number; type: string; payload: string }>)
      .map((r) => ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }) as SimEvent)
    return buildBonds(events, deps.config.movement.earshotRadius, deps.mirror.state().tick)
  })

  router.route('GET', '/api/bonds', (_req, res) => sendPrebuilt(res, cache.json('bonds', bonds)))

  /**
   * ★ HOW MANY BONDS THERE ARE, WITHOUT SENDING THE BONDS.
   *
   * The lens badge showed one number and fetched every bond to measure the array. A `Bond`
   * carries its whole `history`, so this is not a small feed: measured at sim-day 20 of a
   * talkative town, `/api/bonds` answered **83.7 MB**, and the badge asked for it every 60 s
   * per viewer. `/api/chronicle/count` learned this lesson first.
   *
   * It costs the server nothing extra — the panel and the badge share one memoised build.
   */
  router.route('GET', '/api/bonds/count', (_req, res) => sendPrebuilt(res, cache.json('bonds-count', () => {
    const b = bonds()
    return { count: b.bonds.length, asOfTick: b.asOfTick }
  })))
}
