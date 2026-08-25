// ★ THE ASSEMBLY THAT WAS TRAPPED IN A SCRIPT.
//
// Every live run in this repo — `g11-deepworld.ts`, `night-probe.ts`, `motive-probe.ts`,
// `hearth-probe.ts` — writes the same twelve lines by hand: a `PersonalityStore`, a turn
// client, a reflection client, an `AgentRuntime`, `start`, the optional `restore`, the optional
// `wireArbiter`, into a map. Four copies of one wiring is four places a mind can be booted
// subtly differently, and until now there was no way to boot one from anything that is not a
// script, because the wiring did not exist as a function.
//
// This is that function. It is deliberately the SMALL half of the job:
//
//   what is here          the minds, on a bridge somebody else built
//   what is NOT here      the world, the loop, the store, the arbiter, the narrator, the
//                         checkpoints, the report, the money
//
// The reason is the dependency graph and it is not negotiable: `@sj/arbiter` and
// `@sj/narrator` both depend on `@sj/agents`, so nothing in `@sj/agents` may import them. The
// arbiter therefore arrives as an INJECTED seam (`SeamArbiter`), exactly as `wireArbiter`
// already intended, and the place where minds, world, arbiter and narrator may legally meet is
// the top of the graph — `@sj/gateway`. See `gateway/src/liveWorld.ts`.
import type Database from 'better-sqlite3'
import type { LlmClient } from '../llm/client.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import type { IdentityCore } from '../prompt/assemble.js'
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
  /** What each mind is carrying that is not in its database — the clock, the half-run plan,
   *  the turn counts. The only thing a resume has to write down itself. */
  snapshots(): Array<{ agentId: string; snapshot: RuntimeSnapshot }>
  /** True while any mind is still finishing a night's reflection. A caller that stops the
   *  world mid-reflection loses the night and pays for it anyway. */
  reflecting(): boolean
  stop(): void
}

export type BootMindsOpts = {
  minds: readonly MindSpec[]
  bridge: EngineBridge
  embedder: { embed(t: string): Promise<Float32Array> }
  /**
   * Where this mind's memory, journal, ledgers and personality live. One database per mind is
   * what the gateway's read API expects (`<agentDbDir>/<id>.db`); one shared database for all
   * of them is what the gate scripts do. Both are legal — the store keys every row by
   * `agent_id` either way — so the choice is the caller's and this function does not care.
   */
  dbFor: (agentId: string) => Database.Database
  /** The LLM for a mind's turns. Separate from `dbFor`: the call ledger is ops, not memory. */
  turnLlm: (agentId: string) => LlmClient
  /** Absent, a mind sleeps without reflecting — cheaper, and a night that costs nothing. */
  reflectionLlm?: (agentId: string) => LlmClient
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

/**
 * ★ WRITE A FIRST PERSONALITY, OR TRUST THE ONE ON DISK — AND DECIDE IT BY LOOKING, NOT BY A
 * FLAG THE CALLER MIGHT GET WRONG. `PersonalityStore.current()` THROWS on a mind with no
 * version 1, and `init` on a mind that already has one writes a SECOND version 1, after which
 * `current()` reads back whichever row the index happens to pick. A caller passing
 * `resuming = false` on a directory that still holds yesterday's minds gets the second failure
 * silently. Asking the database removes the question.
 */
export function hasPersonality(db: Database.Database, agentId: string): boolean {
  try {
    return db.prepare('SELECT 1 FROM personality_versions WHERE agent_id = ? LIMIT 1').get(agentId) !== undefined
  } catch { return false }
}

export function bootMinds(opts: BootMindsOpts): BootedMinds {
  const runtimes = new Map<string, AgentRuntime>()
  for (const spec of opts.minds) {
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
      ...(opts.onThought === undefined ? {} : { onThought: opts.onThought }),
    })
    runtime.start(spec.id)
    const was = opts.restoring?.get(spec.id)
    if (was !== undefined) runtime.restore(was)
    if (opts.arbiter !== undefined) wireArbiter(runtime, opts.arbiter)
    runtimes.set(spec.id, runtime)
  }
  return {
    runtimes,
    snapshots: () => [...runtimes.entries()].map(([agentId, r]) => ({ agentId, snapshot: r.snapshot() })),
    reflecting: () => [...runtimes.values()].some((r) => r.reflectionInFlight()),
    stop: () => { for (const r of runtimes.values()) r.stop() },
  }
}
