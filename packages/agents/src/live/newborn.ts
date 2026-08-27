import type Database from 'better-sqlite3'
import type { EventStore } from '@sj/engine/store'
import { DAYS_PER_YEAR, SPAWN_AGE_YEARS } from '@sj/shared'
import { derivePersona, type ParentPersona } from '../family/derivePersona.js'
import { buildHouseholdSeed } from '../family/memorySeed.js'
import { captureSocialName, migrateFamilyTables } from '../family/socialName.js'
import { watchBirths, type AgentBornPayload } from '../family/watchBirths.js'
import type { LlmClient } from '../llm/client.js'
import { MemoryStore } from '../memory/store.js'
import type { EngineBridge } from '../runtime/bridge.js'
import type { BootedMinds, MindSpec } from './liveMinds.js'

export type BirthsOpts = {
  booted: BootedMinds
  bridge: EngineBridge
  store: EventStore
  /** The same `<id>.db` opener the founders were booted on: a child gets a file of its own. */
  dbFor: (agentId: string) => Database.Database
  embedder: { embed(t: string): Promise<Float32Array> }
  /** Ops-side, beside the call ledger: what the mother calls the child is never world state. */
  opsDb: Database.Database
  namingLlm: LlmClient
  /** The structure the child was born inside, '' when it was born under the sky. */
  homeOf: (agentId: string) => string
  log?: (line: string) => void
}

const personaOf = (spec: MindSpec): ParentPersona => ({
  agentId: spec.id,
  identity: spec.identity,
  personality: spec.personality,
})

/**
 * Every `agent_born` in the world's log becomes a mind: a persona derived from its parents, the
 * household it was born into written down as memory, and the mother asked what she calls it.
 * Population is unbounded — each child is another live mind on the same daily budget.
 */
export function wireBirths(opts: BirthsOpts): () => void {
  migrateFamilyTables(opts.opsDb)

  const spawn = (born: AgentBornPayload): void => {
    const mother = opts.booted.cast.get(born.motherId)
    const father = opts.booted.cast.get(born.fatherId)
    if (mother === undefined || father === undefined) {
      opts.namingLlm.alert('birth_without_parents', `${born.id} was born to nobody this cast knows`)
      return
    }
    const tick = opts.bridge.currentTick()
    const seed = buildHouseholdSeed(opts.store, {
      childId: born.id,
      motherId: born.motherId,
      fatherId: born.fatherId,
      homeStructureId: opts.homeOf(born.id),
      upToTick: tick,
    })
    const { identity, personality } = derivePersona(born, [personaOf(mother), personaOf(father)])
    const db = opts.dbFor(born.id)

    void (async () => {
      const mem = new MemoryStore(db, born.id, opts.embedder)
      for (const entry of seed) {
        // The household reached this mind the way anything else does; nothing here is its own act.
        await mem.insertMemory({
          tick,
          kind: 'perception',
          text: entry.text,
          importance: entry.importance,
          tags: { people: [], place: null, objects: [], topics: entry.tags },
        })
      }
      opts.booted.add({
        id: born.id,
        identity,
        personality,
        ageDays: SPAWN_AGE_YEARS * DAYS_PER_YEAR,
        sex: born.sex,
      })
      opts.log?.(`stream: ${born.name} was born, and has a mind and a memory of ${born.id}.db`)
      await captureSocialName(opts.namingLlm, opts.opsDb, {
        born,
        motherPersona: personaOf(mother),
        tick,
      })
    })().catch((err: unknown) => {
      opts.namingLlm.alert('birth_failed', err instanceof Error ? err.message : String(err))
    })
  }

  return watchBirths(opts.bridge, opts.store, spawn)
}
