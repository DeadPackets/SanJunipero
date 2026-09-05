import type Database from 'better-sqlite3'
import {
  bondId,
  foldBond,
  tieActOf,
  tieActOfLetGo,
  type Bond,
  type BondFold,
  type BondKind,
  type BondsResponse,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import type { Router } from './router.js'
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

/** What a close writes about one pair. The minds' own reading, not an act the world witnessed. */
type SceneTieDelta = { agentId: string; personId: string; kind: string; settled?: true }

/** The whole of what `buildBonds` folds; every other type falls through its chain untouched.
 *  `co_slept` is not here: a shared roof is a roof, and the partnership is its own act now. */
export const BOND_TYPES: readonly string[] = [
  'agent_spoke',
  'action_started',
  'action_completed',
  'agent_born',
  'invitation_accepted',
  'invitation_refused',
  'partnership_formed',
  'partnership_dissolved',
  'scene_closed',
  'tie_let_go',
]

/** How often the graph is read forward. Warmth's half-life is 2,880 ticks, so 20 moves
 *  `asOfTick` by under 1% of it. */
export const BONDS_REBUILD_TICKS = 20

export type BondsDeps = {
  db: Database.Database
  mirror: WorldMirror
  config: SimConfig
}

/** A bond is folded, not accumulated (`foldBond` in `@sj/shared`): what is kept per pair is a
 *  24-act window, six rollup rows and three scalars — a constant, whatever the town's age.
 *  Kept alive between rebuilds, so a rebuild costs the rows since the last one and not the
 *  town's whole history. */
type BondsFold = {
  apply(events: Iterable<SimEvent>): void
  read(asOfTick: number): BondsResponse
}

function makeBondsFold(earshot: number): BondsFold {
  const drafts = new Map<string, BondFold>()

  const between = (a: string, b: string): BondFold | null => {
    if (a === b) return null
    const id = bondId(a, b)
    let fold = drafts.get(id)
    if (fold === undefined) {
      fold = foldBond(a, b, 0)
      drafts.set(id, fold)
    }
    return fold
  }

  const tie = (a: string, b: string, kind: BondKind, tick: number): void => {
    between(a, b)?.add(kind, tick)
  }

  // Every spoke against every earlier spoke is O(n²) and a badge polls this. A spoke older than the
  // talk window can pair with nothing again, so dropping it is the same answer in bounded time.
  let spokes: { agentId: string; tick: number; x: number; y: number }[] = []
  const started = new Map<string, Record<string, unknown>>() // `${agentId}\n${verb}` → params

  const apply = (events: Iterable<SimEvent>): void => {
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
      } else if (ev.type === 'partnership_formed') {
        const p = ev.payload as { aId: string; bId: string }
        tie(p.aId, p.bId, 'partner', ev.tick)
      } else if (ev.type === 'partnership_dissolved') {
        const p = ev.payload as { aId: string; bId: string }
        between(p.aId, p.bId)?.part(ev.tick)
      } else if (ev.type === 'invitation_accepted') {
        // Walking out together is warmth. A proposal accepted is the partnership one event
        // later, and a bedding is nobody's business but theirs.
        const p = ev.payload as { agentId: string; byId: string; verb: string }
        if (p.verb === 'court') between(p.byId, p.agentId)?.addTie('attraction', ev.tick)
      } else if (ev.type === 'invitation_refused') {
        // A no said in private costs nothing; a no said in front of people is a slight.
        const p = ev.payload as { agentId: string; byId: string; witnesses: readonly string[] }
        if (p.witnesses.length > 0) between(p.byId, p.agentId)?.addTie('slight', ev.tick)
      } else if (ev.type === 'agent_born') {
        const p = ev.payload as { id: string; motherId: string; fatherId: string }
        for (const parent of [p.motherId, p.fatherId]) tie(parent, p.id, 'kin', ev.tick)
      } else if (ev.type === 'scene_closed') {
        const p = ev.payload as { deltas: readonly SceneTieDelta[] }
        for (const d of p.deltas) {
          const act = tieActOf(d.kind, d.settled === true)
          if (act !== null) between(d.agentId, d.personId)?.addTie(act, ev.tick)
        }
      } else if (ev.type === 'tie_let_go') {
        const p = ev.payload as { agentId: string; personId: string; kind: string }
        const act = tieActOfLetGo(p.kind)
        if (act !== null) between(p.agentId, p.personId)?.addTie(act, ev.tick)
      }
    }
  }

  return {
    apply,
    read(asOfTick) {
      const bonds: Bond[] = [...drafts.values()]
        .map((fold): Bond => {
          fold.advanceTo(asOfTick)
          return fold.bond()
        })
        .sort((a, b) => a.id.localeCompare(b.id))
      return { bonds, asOfTick }
    },
  }
}

export function buildBonds(
  events: Iterable<SimEvent>,
  earshot: number,
  asOfTick: number,
): BondsResponse {
  const fold = makeBondsFold(earshot)
  fold.apply(events)
  return fold.read(asOfTick)
}

export function mountBondsApi(router: Router, deps: BondsDeps): void {
  const selEvents = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events WHERE type IN (${BOND_TYPES.map(() => '?').join(', ')})
     AND seq > ? ORDER BY seq`,
  )
  // A filtered scan per CADENCE, not per generation; see seqCache.ts for why a public stream
  // cannot pay one per viewer, and BONDS_REBUILD_TICKS for why it cannot pay one per tick either.
  const cache = makeSeqCache(() => Math.floor(deps.mirror.state().tick / BONDS_REBUILD_TICKS))
  const graph = makeBondsFold(deps.config.movement.earshotRadius)
  let folded = 0

  const bonds = (): BondsResponse =>
    cache.value('bonds', () => {
      // Streamed, so the rows and the parsed events are never both fully materialised: measured on
      // this shape at 86.9 MB of retained log, see the fold note in `api.ts`.
      const events = function* (): Generator<SimEvent> {
        for (const r of selEvents.iterate(...BOND_TYPES, folded) as Iterable<EventRow>) {
          folded = r.seq
          yield toEvent(r)
        }
      }
      graph.apply(events())
      return graph.read(deps.mirror.state().tick)
    })

  router.route('GET', '/api/bonds', (_req, res) => {
    sendPrebuilt(res, cache.json('bonds', bonds))
  })
}
