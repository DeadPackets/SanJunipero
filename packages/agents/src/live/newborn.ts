import type Database from 'better-sqlite3'
import type { EventStore } from '@sj/engine/store'
import { MINUTES_PER_DAY } from '@sj/shared'
import { personaOf } from '../family/derivePersona.js'
import { captureSocialName, hasSocialName, migrateFamilyTables } from '../family/socialName.js'
import { watchBirths, type AgentBornPayload } from '../family/watchBirths.js'
import { insertAlert, type LlmClient } from '@sj/llm'
import type { EngineBridge } from '../runtime/bridge.js'
import { ensureHousehold } from './ensureChild.js'
import type { BootedMinds } from './liveMinds.js'
import { childSpec } from './resolveCast.js'

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
  /** Past this many minds a birth gets a body and no mind: every mind is another live bill. */
  maxMinds: number
  log?: (line: string) => void
}

/**
 * Every `agent_born` in the world's log becomes a mind: a persona derived from its parents, the
 * household it was born into written down as memory, and the mother asked what she calls it.
 */
export function wireBirths(opts: BirthsOpts): () => void {
  migrateFamilyTables(opts.opsDb)

  // A child counts against the ceiling from the tick it is born, not from the moment its
  // seeding finishes — two births in one tick must not both take the last slot.
  const booting = new Set<string>()

  const spawn = (born: AgentBornPayload, seq: number): void => {
    if (opts.booted.cast.size + booting.size >= opts.maxMinds) {
      insertAlert(opts.opsDb, {
        agentId: born.id,
        kind: 'birth_over_max_minds',
        detail: `${born.id} was born into a town already holding ${opts.maxMinds} minds; the body lives and no mind was booted for it`,
      })
      return
    }
    const mother = opts.booted.cast.get(born.motherId)
    const father = opts.booted.cast.get(born.fatherId)
    if (mother === undefined || father === undefined) {
      insertAlert(opts.opsDb, {
        agentId: born.id,
        kind: 'birth_without_parents',
        detail: `${born.id} was born to nobody this cast knows`,
      })
      return
    }
    const tick = opts.bridge.currentTick()
    const spec = childSpec(
      born,
      personaOf(mother),
      personaOf(father),
      Math.floor(tick / MINUTES_PER_DAY),
    )
    const db = opts.dbFor(born.id)
    booting.add(born.id)

    // Off the tick: the household seed reads the log and the naming is a call.
    // The same two writes a boot repairs, in the same order — see `ensureChildren`.
    void (async () => {
      await ensureHousehold({ store: opts.store, db, embedder: opts.embedder }, born, { seq, tick })
      opts.booted.add(spec)
      opts.log?.(`stream: ${born.name} was born, and has a mind and a memory of ${born.id}.db`)
      if (!hasSocialName(opts.opsDb, born.id))
        await captureSocialName(opts.namingLlm, opts.opsDb, {
          born,
          motherPersona: personaOf(mother),
          tick,
        })
    })()
      .catch((err: unknown) => {
        insertAlert(opts.opsDb, {
          agentId: born.id,
          kind: 'birth_failed',
          detail: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => booting.delete(born.id))
  }

  return watchBirths(opts.bridge, opts.store, spawn)
}
