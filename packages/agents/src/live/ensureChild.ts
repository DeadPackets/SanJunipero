import type Database from 'better-sqlite3'
import { AgentBorn } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import type { LlmClient } from '@sj/llm'
import { personaOf } from '../family/derivePersona.js'
import { homeAtBirth } from '../family/homeAtBirth.js'
import { buildHouseholdSeed } from '../family/memorySeed.js'
import { captureSocialName, hasSocialName, migrateFamilyTables } from '../family/socialName.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import { MemoryStore } from '../memory/store.js'
import { hasPersonality, type MindSpec } from './liveMinds.js'

export type HouseholdDeps = {
  store: EventStore
  /** The child's own `<id>.db`. */
  db: Database.Database
  embedder: { embed(t: string): Promise<Float32Array> }
}

/** A child still owed its household: booting stamps the personality, so no personality means
 *  the seeding never finished. Founders have no `bornDay` and are never owed one. */
export const needsHousehold = (spec: MindSpec, db: Database.Database): boolean =>
  spec.bornDay !== undefined && !hasPersonality(db, spec.id)

/** Every seed entry carries the `event:<seq>` it was made from, which is what a repair reads. */
const seedTag = (tags: readonly string[]): string => tags.find((t) => t.startsWith('event:')) ?? ''

const writtenSeedTags = (db: Database.Database, agentId: string): Set<string> =>
  new Set(
    (
      db
        .prepare(
          `SELECT t.tag FROM memory_tags t JOIN memories m ON m.id = t.memory_id
           WHERE m.agent_id = ? AND t.kind = 'topic' AND t.tag LIKE 'event:%'`,
        )
        .all(agentId) as { tag: string }[]
    ).map((r) => r.tag),
  )

/** Idempotent by the event each entry came from, so a seeding a crash cut short resumes
 *  without repeating one. */
export async function ensureHousehold(
  deps: HouseholdDeps,
  born: AgentBornPayload,
  birth: { seq: number; tick: number },
): Promise<void> {
  const seed = buildHouseholdSeed(deps.store, {
    childId: born.id,
    motherId: born.motherId,
    fatherId: born.fatherId,
    homeStructureId: homeAtBirth(deps.store, born.motherId, birth.seq),
    upToTick: birth.tick,
  })
  const written = writtenSeedTags(deps.db, born.id)
  const mem = new MemoryStore(deps.db, born.id, deps.embedder)
  for (const entry of seed.filter((e) => !written.has(seedTag(e.tags)))) {
    // The household reached this mind the way anything else does; nothing here is its own act.
    await mem.insertMemory({
      tick: birth.tick,
      kind: 'perception',
      text: entry.text,
      importance: entry.importance,
      tags: { people: [], place: null, objects: [], topics: entry.tags },
    })
  }
}

export type EnsureChildrenOpts = {
  /** Who the town holds, by id — `resolveCast`'s answer. */
  cast: ReadonlyMap<string, MindSpec>
  store: EventStore
  dbFor: (agentId: string) => Database.Database
  opsDb: Database.Database
  embedder: { embed(t: string): Promise<Float32Array> }
  namingLlm: LlmClient
  boot: (spec: MindSpec) => void
}

type ResolvedBirth = {
  spec: MindSpec
  born: AgentBornPayload
  mother: MindSpec
  birth: { seq: number; tick: number }
}

/** A birth writes two things outside the world log — the household it was born into and what
 *  its mother calls it — and a crash between them leaves a child with a mind and no origin. */
export async function ensureChildren(opts: EnsureChildrenOpts): Promise<void> {
  migrateFamilyTables(opts.opsDb)
  const births: ResolvedBirth[] = []
  for (const ev of opts.store.readTypeFrom(0, 'agent_born')) {
    const born = AgentBorn.parse(ev.payload)
    const spec = opts.cast.get(born.id)
    const mother = opts.cast.get(born.motherId)
    if (spec !== undefined && mother !== undefined)
      births.push({ spec, born, mother, birth: { seq: ev.seq, tick: ev.tick } })
  }
  // Households first: no child's mind waits behind another child's naming call.
  for (const b of births) {
    const db = opts.dbFor(b.born.id)
    if (!needsHousehold(b.spec, db)) continue
    await ensureHousehold({ store: opts.store, db, embedder: opts.embedder }, b.born, b.birth)
    opts.boot(b.spec)
  }
  for (const b of births) {
    if (hasSocialName(opts.opsDb, b.born.id)) continue
    await captureSocialName(opts.namingLlm, opts.opsDb, {
      born: b.born,
      motherPersona: personaOf(b.mother),
      tick: b.birth.tick,
    })
  }
}
