// Boots minds only; the arbiter arrives as an injected `SeamArbiter` because @sj/arbiter
// depends on @sj/agents and the cycle is not negotiable.
import type Database from 'better-sqlite3'
import { type LlmClient } from '@sj/llm'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import type { IdentityCore } from '../prompt/assemble.js'
import { makeDreamLlm } from '../dream.js'
import { makeReflectionLlm } from '../reflection.js'
import { AgentRuntime, type RuntimeSnapshot } from '../runtime/agentRuntime.js'
import type { EngineBridge } from '../runtime/bridge.js'
import { wireArbiter, type SeamArbiter } from '../runtime/arbiterSeam.js'
import type { MindConfig } from '../wake.js'

/** One person, before there is a body for them. The shape `founderMinds.ts` already speaks. */
export type MindSpec = {
  id: string
  identity: IdentityCore
  personality: PersonalityDoc
  ageDays: number
  sex: 'f' | 'm'
}

export type BootedMinds = {
  runtimes: Map<string, AgentRuntime>
  /** Who is in the town, by id — the founders plus everyone born since. A newborn's parents
   *  are read from here, so it grows as `add` is called. */
  cast: ReadonlyMap<string, MindSpec>
  /** Bring one more mind up on a town that is already running: a birth. */
  add(spec: MindSpec): void
  /** What each mind is carrying that is not in its database — the clock, the half-run plan,
   *  the turn counts. The only thing a resume has to write down itself. */
  snapshots(): { agentId: string; snapshot: RuntimeSnapshot }[]
  /** True while any mind is still finishing a night's reflection. A caller that stops the
   *  world mid-reflection loses the night and pays for it anyway. */
  reflecting(): boolean
  stop(): void
}

export type BootMindsOpts = {
  minds: readonly MindSpec[]
  bridge: EngineBridge
  embedder: { embed(t: string): Promise<Float32Array> }
  /** One database per mind (`<agentDbDir>/<id>.db`) is what the gateway's read API expects and
   *  one shared database is what a gate script passes; every row is keyed by `agent_id`. */
  dbFor: (agentId: string) => Database.Database
  /** The LLM for a mind's turns. Separate from `dbFor`: the call ledger is ops, not memory. */
  turnLlm: (agentId: string) => LlmClient
  /** Absent, a mind sleeps without reflecting — cheaper, and a night that costs nothing. */
  reflectionLlm?: (agentId: string) => LlmClient
  /** Absent, a mind sleeps without dreaming. Rolled per night against `dreamChance`. */
  dreamLlm?: (agentId: string) => LlmClient
  /** The wake cadence. Absent in every real run; a harness that cannot wait out the 120-tick
   *  boredom floor to see a mind take one turn sets it. */
  mindConfig?: Partial<MindConfig>
  /** The sim day a first personality is stamped with. See `hasPersonality`. */
  day?: number
  onThought?: (t: { tick: number; agentId: string; text: string }) => void
  /** Per-mind runtime state to put back after `start`, which is what clears it. */
  restoring?: ReadonlyMap<string, RuntimeSnapshot>
  /** Adjudication and codification, injected because agents may not import the arbiter. */
  arbiter?: SeamArbiter
}

/** `init` on a mind that already has version 1 writes a second one and `current()` then reads
 *  whichever row the index picks — so ask the database, never a `resuming` flag. */
export function hasPersonality(db: Database.Database, agentId: string): boolean {
  try {
    return (
      db.prepare('SELECT 1 FROM personality_versions WHERE agent_id = ? LIMIT 1').get(agentId) !==
      undefined
    )
  } catch {
    return false
  }
}

export function bootMinds(opts: BootMindsOpts): BootedMinds {
  const runtimes = new Map<string, AgentRuntime>()
  const cast = new Map<string, MindSpec>()
  const boot = (spec: MindSpec): void => {
    const db = opts.dbFor(spec.id)
    const personality = new PersonalityStore(db, spec.id)
    if (!hasPersonality(db, spec.id)) personality.init(spec.personality, opts.day ?? 0)
    const runtime = new AgentRuntime({
      db,
      llm: opts.turnLlm(spec.id),
      embedder: opts.embedder,
      identity: spec.identity,
      personality,
      bridge: opts.bridge,
      ...(opts.mindConfig === undefined ? {} : { config: opts.mindConfig }),
      ...(opts.reflectionLlm === undefined
        ? {}
        : { reflectionLlm: makeReflectionLlm(opts.reflectionLlm(spec.id)) }),
      ...(opts.dreamLlm === undefined ? {} : { dreamLlm: makeDreamLlm(opts.dreamLlm(spec.id)) }),
      ...(opts.onThought === undefined ? {} : { onThought: opts.onThought }),
    })
    runtime.start(spec.id)
    const was = opts.restoring?.get(spec.id)
    if (was !== undefined) runtime.restore(was)
    if (opts.arbiter !== undefined) wireArbiter(runtime, opts.arbiter)
    runtimes.set(spec.id, runtime)
    cast.set(spec.id, spec)
  }
  for (const spec of opts.minds) boot(spec)
  return {
    runtimes,
    cast,
    add: boot,
    snapshots: () =>
      [...runtimes.entries()].map(([agentId, r]) => ({ agentId, snapshot: r.snapshot() })),
    reflecting: () => [...runtimes.values()].some((r) => r.reflectionInFlight()),
    stop: () => {
      for (const r of runtimes.values()) r.stop()
    },
  }
}
