import type Database from 'better-sqlite3'
import { addressedIn } from '../scene/scene.js'
import type { PerceptionPacket } from '../prompt/prose.js'

export const WANT_KINDS = [
  'belonging',
  'affection',
  'esteem',
  'curiosity',
  'rivalry',
  'order',
  'legacy',
] as const
export type WantKind = (typeof WANT_KINDS)[number]

export const WANT_RISE_PER_TICK = 0.017

/** The same 0–100 the body's needs and a scene's energy are read on. Four sim-days unfed
 *  reaches it, and past that more waiting says nothing a morning line could act on. */
export const WANT_CAP = 100

/** What feeds a want, one occasion per row of the contract. `law_broken` and `child` have no
 *  source in the world yet — Task 13 raises the first and a birth is an engine event. */
export const FED_BY = {
  scene: 'belonging',
  partner_scene: 'affection',
  expressed_at: 'affection',
  taught: 'esteem',
  praised: 'esteem',
  discovery_credit: 'esteem',
  new_place: 'curiosity',
  discovery_witnessed: 'curiosity',
  slight: 'rivalry',
  item_taken_from_you: 'rivalry',
  law_broken: 'order',
  child: 'legacy',
  named_building: 'legacy',
  verb_codified: 'legacy',
} as const satisfies Record<string, WantKind>

export type WantOccasion = keyof typeof FED_BY

/** How much faster than everybody else this mind feels one of these. Read off the voice card
 *  and carried in the persona; a kind with no entry rises at the common rate. */
export type WantBias = Partial<Record<WantKind, number>>

/** A want as it reads now: `level` has the rise since `lastFedTick` already in it. */
export type Want = { kind: WantKind; level: number; lastFedTick: number }

/** Being told you were relied on, in the seven plainest ways a mind says it. Matched as
 *  lowercase substrings of a line addressed to you by name. */
const PRAISE = [
  'well done',
  'good work',
  'thank you',
  'proud of you',
  'you were right',
  'i trust you',
  'nobody else could',
]

/** Every occasion this packet holds. The rest of the table is fed by the runtime, which knows
 *  what the eyes cannot report: the talk this mind is in, and what its own hands finished. */
export function occasionsInPacket(packet: PerceptionPacket, selfName: string): WantOccasion[] {
  const found = new Set<WantOccasion>()
  for (const line of packet.heard) {
    if (addressedIn(line.text, [selfName], (n) => n) === null) continue
    const said = line.text.toLowerCase()
    if (PRAISE.some((p) => said.includes(p))) found.add('praised')
  }
  for (const s of packet.seen) {
    if (s.kind === 'discovery') found.add('discovery_witnessed')
    if (s.kind === 'item_taken' && s.ownerName === selfName) found.add('item_taken_from_you')
  }
  if (packet.feltEvents.includes('you_were_attacked')) found.add('slight')
  return [...found]
}

type RawWant = { kind: WantKind; level: number; last_fed_tick: number }

/** What this mind is short of, and for how long. A level is stored only when something feeds
 *  it; the rise between is arithmetic, so an idle tick writes nothing. */
export class WantStore {
  #seeded = false

  constructor(
    readonly db: Database.Database,
    readonly agentId: string,
    readonly bias: WantBias = {},
  ) {}

  /** Where a want that has never been fed starts rising from. Called when the mind starts, so
   *  the anchor is the tick it began living here and never whenever something first asked. */
  begin(tick: number): void {
    if (this.#seeded) return
    const add = this.db.prepare(
      'INSERT OR IGNORE INTO wants (agent_id, kind, level, last_fed_tick) VALUES (?, ?, 0, ?)',
    )
    for (const kind of WANT_KINDS) add.run(this.agentId, kind, tick)
    this.#seeded = true
  }

  /** Every want as it stands at this tick, highest first. */
  levels(tick: number): Want[] {
    this.begin(tick)
    const rows = this.db
      .prepare('SELECT kind, level, last_fed_tick FROM wants WHERE agent_id = ?')
      .all(this.agentId) as RawWant[]
    return rows
      .map((r) => ({
        kind: r.kind,
        level: this.#risen(r, tick),
        lastFedTick: r.last_fed_tick,
      }))
      .sort(
        (a, b) =>
          b.level - a.level ||
          a.lastFedTick - b.lastFedTick ||
          WANT_KINDS.indexOf(a.kind) - WANT_KINDS.indexOf(b.kind),
      )
  }

  /** The one the morning line names: highest, and on a tie whichever went unfed longest. */
  top(tick: number): WantKind {
    return this.levels(tick)[0]?.kind ?? WANT_KINDS[0]
  }

  levelOf(kind: WantKind, tick: number): number {
    return this.levels(tick).find((w) => w.kind === kind)?.level ?? 0
  }

  /** Something happened that answers a want, so it starts over from here. */
  feed(occasions: Iterable<WantOccasion>, tick: number): void {
    this.begin(tick)
    const set = this.db.prepare(
      'UPDATE wants SET level = 0, last_fed_tick = ? WHERE agent_id = ? AND kind = ?',
    )
    for (const occasion of occasions) set.run(tick, this.agentId, FED_BY[occasion])
  }

  #risen(r: RawWant, tick: number): number {
    const elapsed = Math.max(0, tick - r.last_fed_tick)
    const rate = WANT_RISE_PER_TICK * (this.bias[r.kind] ?? 1)
    return Math.min(WANT_CAP, r.level + rate * elapsed)
  }
}
