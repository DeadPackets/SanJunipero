import type Database from 'better-sqlite3'
import { AgentArrived, BIRTH_NAMES, RngStream } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import { insertAlert } from '@sj/llm'
import { DAYS_PER_YEAR, MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { MemoryStore } from '../memory/store.js'
import type { EngineBridge } from '../runtime/bridge.js'
import { hasPersonality, type BootedMinds, type MindSpec, type NewPerson } from './liveMinds.js'
import { arrivalSpec, type AgentArrivedPayload } from './resolveCast.js'
import { TRAVELLER_MINDS } from './travellerMinds.js'

/** Nine in the morning: the hour somebody who slept on the road reaches the valley floor. */
const ARRIVAL_HOUR = 9

/** What a walker has on their back. Three days of bread, the knife they cut it with, and
 *  something to carry water in — enough to be a person and not enough to be a windfall. */
const ROAD_KIT: readonly { kind: string; qty: number }[] = [
  { kind: 'knife', qty: 1 },
  { kind: 'waterskin', qty: 1 },
  { kind: 'bread', qty: 3 },
]

/** Three sim-days at least and five at most, read off the world's own counter rather than
 *  rolled: the runtime holds no seed, and a cadence that drifts with the log is one nobody
 *  can replay. */
export function arrivalGap(nextEntityId: number): number {
  return 3 + (nextEntityId % 3)
}

/** The day somebody last came up the road, or the founding day for a town nobody has. */
export function lastArrivalDay(store: EventStore): number {
  const last = store.readTypeFrom(0, 'agent_arrived').at(-1)
  return last === undefined ? 0 : Math.floor(last.tick / MINUTES_PER_DAY)
}

/** The first thing this mind remembers: the road behind it, and the town in front. */
export function arrivalMemory(arrived: AgentArrivedPayload): string {
  const traveller = TRAVELLER_MINDS.find((t) => t.id === arrived.id)
  return (
    traveller?.arrival ??
    'You came up the valley road today with what you could carry. The town lies up the road ahead of you.'
  )
}

/** A mind that walked in is still owed the memory of walking in: booting stamps the
 *  personality, so no personality means the seeding never finished. */
export const needsArrival = (spec: MindSpec, db: Database.Database): boolean =>
  spec.arrivedDay !== undefined && !hasPersonality(db, spec.id)

const arrivalTag = (seq: number): string => `event:${seq}`

/** Idempotent by the arrival it was made from, so a boot after a crash writes it once. */
export async function ensureArrival(
  deps: { db: Database.Database; embedder: { embed(t: string): Promise<Float32Array> } },
  arrived: AgentArrivedPayload,
  at: { seq: number; tick: number },
): Promise<void> {
  const tag = arrivalTag(at.seq)
  const written = deps.db
    .prepare(
      `SELECT 1 FROM memory_tags t JOIN memories m ON m.id = t.memory_id
       WHERE m.agent_id = ? AND t.kind = 'topic' AND t.tag = ? LIMIT 1`,
    )
    .get(arrived.id, tag)
  if (written !== undefined) return
  const mem = new MemoryStore(deps.db, arrived.id, deps.embedder)
  await mem.insertMemory({
    tick: at.tick,
    kind: 'perception',
    text: arrivalMemory(arrived),
    importance: 8,
    tags: { people: [], place: null, objects: [], topics: [tag] },
  })
}

export type ArrivalsOpts = {
  booted: BootedMinds
  bridge: EngineBridge
  store: EventStore
  /** The same `<id>.db` opener the founders were booted on: a walker gets a file of its own. */
  dbFor: (agentId: string) => Database.Database
  embedder: { embed(t: string): Promise<Float32Array> }
  opsDb: Database.Database
  /** The runtime's last line, beside the world's own ceiling: every mind is another live bill. */
  maxMinds: number
  /** Someone the town has gained. Off the log and off the tick: art is not world state. */
  onPerson?: (person: NewPerson) => void
  log?: (line: string) => void
}

/** The road brings somebody up it every three to five sim-days while the valley has room. The
 *  world does not know minds exist, so this is an announcement made from outside it and folded
 *  like any other — replay rebuilds the same body, and `resolveCast` the same person. */
export function wireArrivals(opts: ArrivalsOpts): () => void {
  const booting = new Set<string>()
  let stopped = false
  let seq = opts.store.lastSeq()

  const whoIsComing = (rim: {
    x: number
    y: number
  }): { id: string; name: string; sex: 'f' | 'm'; ageDays: number; x: number; y: number } => {
    const traveller = TRAVELLER_MINDS.find((t) => !opts.bridge.hasBody(t.id))
    if (traveller !== undefined) {
      return {
        id: traveller.id,
        name: traveller.identity.name,
        sex: traveller.sex,
        ageDays: traveller.ageDays,
        x: rim.x,
        y: rim.y,
      }
    }
    const id = opts.bridge.mintId('agent')
    const rng = RngStream.seed(id, 'road')
    const sex = rng.next() < 0.5 ? 'f' : 'm'
    const names = BIRTH_NAMES[sex]
    return {
      id,
      name: names[rng.int(names.length)]!,
      sex,
      // Grown, and not so old the road would have stopped them: eighteen to forty-eight.
      ageDays: (18 + rng.int(31)) * DAYS_PER_YEAR,
      x: rim.x,
      y: rim.y,
    }
  }

  const morning = (tick: number): void => {
    if (stopped) return
    const time = simTimeFromTick(tick)
    if (time.hour !== ARRIVAL_HOUR || time.minute !== 0) return
    if (booting.size > 0) return
    if (opts.booted.alive() + booting.size >= opts.maxMinds) return
    if (opts.bridge.headcount() >= opts.bridge.maxMinds()) return
    const day = Math.floor(tick / MINUTES_PER_DAY)
    if (day - lastArrivalDay(opts.store) < arrivalGap(opts.bridge.nextEntityId())) return
    const rim = opts.bridge.roadRim()
    if (rim === null) {
      insertAlert(opts.opsDb, {
        agentId: null,
        kind: 'no_road',
        detail: 'nobody could come up the valley road today: this world has no town to walk to',
      })
      return
    }
    const who = whoIsComing(rim)
    opts.bridge.announce('agent_arrived', who)
    ROAD_KIT.forEach((item, i) => {
      opts.bridge.announce('item_spawned', {
        id: opts.bridge.mintId('item', i + 1),
        kind: item.kind,
        qty: item.qty,
        loc: { t: 'agent', id: who.id },
        owner: who.id,
        ...opts.bridge.spoilage(item.kind),
      })
    })
    const structureIds = opts.bridge.publicPlaces().map((p) => p.id)
    if (structureIds.length > 0)
      opts.bridge.announce('places_seen', { agentId: who.id, structureIds })
  }

  const spawn = (arrived: AgentArrivedPayload, at: { seq: number; tick: number }): void => {
    if (opts.booted.cast.has(arrived.id) || booting.has(arrived.id)) return
    if (opts.booted.alive() + booting.size >= opts.maxMinds) {
      insertAlert(opts.opsDb, {
        agentId: arrived.id,
        kind: 'arrival_over_max_minds',
        detail: `${arrived.name} walked into a town already holding ${opts.maxMinds} minds; the body lives and no mind was booted for it`,
      })
      return
    }
    const spec = arrivalSpec(arrived, Math.floor(at.tick / MINUTES_PER_DAY))
    const db = opts.dbFor(arrived.id)
    booting.add(arrived.id)
    // Off the tick: the first memory is an embedding call.
    void (async () => {
      await ensureArrival({ db, embedder: opts.embedder }, arrived, at)
      opts.booted.add(spec)
      opts.onPerson?.({
        id: arrived.id,
        name: arrived.name,
        sex: arrived.sex,
        ageYears: Math.floor(arrived.ageDays / DAYS_PER_YEAR),
        parents: null,
      })
      opts.log?.(
        `stream: ${arrived.name} came up the valley road, and has a mind and a memory of ${arrived.id}.db`,
      )
    })()
      .catch((err: unknown) => {
        insertAlert(opts.opsDb, {
          agentId: arrived.id,
          kind: 'arrival_failed',
          detail: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => booting.delete(arrived.id))
  }

  const watch = (): void => {
    if (stopped) return
    const fresh = opts.store.readTypeFrom(seq, 'agent_arrived')
    // Past the last arrival SEEN, not the last event written: a later one still has a higher seq.
    seq = fresh.at(-1)?.seq ?? seq
    for (const ev of fresh) spawn(AgentArrived.parse(ev.payload), { seq: ev.seq, tick: ev.tick })
  }

  opts.bridge.onTick((tick) => {
    watch()
    morning(tick)
  })
  return () => {
    stopped = true
  }
}

export type EnsureArrivalsOpts = {
  /** Who the town holds, by id — `resolveCast`'s answer. */
  cast: ReadonlyMap<string, MindSpec>
  store: EventStore
  dbFor: (agentId: string) => Database.Database
  embedder: { embed(t: string): Promise<Float32Array> }
  boot: (spec: MindSpec) => void
}

/** An arrival writes one thing outside the world log — the memory of the road — and a crash
 *  before it leaves a walker with a mind and no reason to be here. */
export async function ensureArrivals(opts: EnsureArrivalsOpts): Promise<void> {
  for (const ev of opts.store.readTypeFrom(0, 'agent_arrived')) {
    const arrived = AgentArrived.parse(ev.payload)
    const spec = opts.cast.get(arrived.id)
    if (spec === undefined) continue
    const db = opts.dbFor(arrived.id)
    if (!needsArrival(spec, db)) continue
    await ensureArrival({ db, embedder: opts.embedder }, arrived, { seq: ev.seq, tick: ev.tick })
    opts.boot(spec)
  }
}
