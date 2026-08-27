import type Database from 'better-sqlite3'
import { AgentBorn } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import type { LlmClient } from '@sj/llm'
import { personaOf } from '../family/derivePersona.js'
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
  /** The structure the child was born inside, '' when it was born under the sky. */
  homeOf: (agentId: string) => string
}

const countMemories = (db: Database.Database, agentId: string): number =>
  (
    db.prepare('SELECT COUNT(*) AS n FROM memories WHERE agent_id = ?').get(agentId) as {
      n: number
    }
  ).n

/**
 * The household a child was born into, written down as its first memories. Call it before the
 * mind is booted: booting stamps the personality, and until that row exists nothing but a seed
 * can have written to this database — which is what lets a half-written one resume in place.
 */
export async function ensureHousehold(
  deps: HouseholdDeps,
  born: AgentBornPayload,
  tick: number,
): Promise<void> {
  const seed = buildHouseholdSeed(deps.store, {
    childId: born.id,
    motherId: born.motherId,
    fatherId: born.fatherId,
    homeStructureId: deps.homeOf(born.id),
    upToTick: tick,
  })
  const mem = new MemoryStore(deps.db, born.id, deps.embedder)
  for (const entry of seed.slice(countMemories(deps.db, born.id))) {
    // The household reached this mind the way anything else does; nothing here is its own act.
    await mem.insertMemory({
      tick,
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
  homeOf: (agentId: string) => string
  /** Bring up a child whose household this call had to finish. */
  boot: (spec: MindSpec) => void
}

/**
 * A birth writes two things outside the world log: the household it was born into, and what its
 * mother calls it. A crash between them leaves a child with a mind and no origin and nothing
 * retries, so every boot finishes what the last one started. Both halves are idempotent.
 */
export async function ensureChildren(opts: EnsureChildrenOpts): Promise<void> {
  migrateFamilyTables(opts.opsDb)
  for (const ev of opts.store.readTypeFrom(0, 'agent_born')) {
    const born = AgentBorn.parse(ev.payload)
    const spec = opts.cast.get(born.id)
    const mother = opts.cast.get(born.motherId)
    if (spec === undefined || mother === undefined) continue
    const db = opts.dbFor(born.id)
    if (!hasPersonality(db, born.id)) {
      await ensureHousehold(
        { store: opts.store, db, embedder: opts.embedder, homeOf: opts.homeOf },
        born,
        ev.tick,
      )
      opts.boot(spec)
    }
    if (!hasSocialName(opts.opsDb, born.id))
      await captureSocialName(opts.namingLlm, opts.opsDb, {
        born,
        motherPersona: personaOf(mother),
        tick: ev.tick,
      })
  }
}
