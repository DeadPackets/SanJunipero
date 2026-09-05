// Boots minds only; the arbiter arrives as an injected `SeamArbiter` because @sj/arbiter
// depends on @sj/agents and the cycle is not negotiable.
import type Database from 'better-sqlite3'
import type { LlmClient } from '@sj/llm'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import type { IdentityCore } from '../prompt/assemble.js'
import { makeDreamLlm } from '../dream.js'
import { makeReflectionLlm } from '../reflection.js'
import { AgentRuntime, type RuntimeSnapshot } from '../runtime/agentRuntime.js'
import type { EngineBridge } from '../runtime/bridge.js'
import { wireArbiter, type SeamArbiter } from '../runtime/arbiterSeam.js'
import { SceneCoordinator, type SceneMind } from '../scene/coordinator.js'
import { makeSceneLlm } from '../scene/sceneLlm.js'
import { MemoryStore } from '../memory/store.js'
import { TieStore } from '../memory/ties.js'
import type { WantBias } from '../memory/wants.js'
import type { MindConfig } from '../wake.js'

export type Kin = { id: string; relation: 'partner' | 'parent' | 'child' }

// A scene's own summary is tagged by the scene, not by a cue reader.
const EMPTY_SCENE_TAGS = { people: [], place: null, objects: [], topics: [] }

/** One person, before there is a body for them. The shape `founderMinds.ts` already speaks. */
export type MindSpec = {
  id: string
  identity: IdentityCore
  personality: PersonalityDoc
  ageDays: number
  sex: 'f' | 'm'
  /** The sim day this person's first personality is stamped with. Founders have none. */
  bornDay?: number
  /** Declared in the persona so a kin tie can be seeded from it; a body born in the world
   *  gets its kin from the birth instead. */
  kin?: readonly Kin[]
  /** What this person feels the lack of faster than everybody else, read off the voice card.
   *  A kind with no entry rises at the common rate, and so does a persona with no table. */
  wantBias?: WantBias
}

export type BootedMinds = {
  runtimes: Map<string, AgentRuntime>
  /** The world's one scene coordinator, or null when nothing supplied a scene LLM. */
  scenes: SceneCoordinator | null
  /** Who is in the town, by id — the founders plus everyone born since. A newborn's parents
   *  are read from here, so it grows as `add` is called. */
  cast: ReadonlyMap<string, MindSpec>
  /** How many of the cast still have a body. `cast` keeps the dead, because a newborn reads
   *  its parents from it; a ceiling or a per-mind rate must count only the living. */
  alive(): number
  add(spec: MindSpec): void
  /** What each mind is carrying that is not in its database — the clock, the half-run plan,
   *  the turn counts. The only thing a resume has to write down itself. */
  snapshots(): { agentId: string; snapshot: RuntimeSnapshot }[]
  /** True while any mind is still finishing a night's reflection. A caller that stops the
   *  world mid-reflection loses the night and pays for it anyway. */
  reflecting(): boolean
  /** True while a scene line or a closing is still with a back end. Closing a mind's database
   *  under one throws out of a promise nobody awaits. */
  busy(): boolean
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
  /** The wake cadence. Absent in every real run; a harness that cannot wait out the boredom
   *  floor to see a mind take one turn sets it. */
  mindConfig?: Partial<MindConfig>
  /** The sim day a first personality is stamped with. See `hasPersonality`. */
  day?: number
  onThought?: (t: { tick: number; agentId: string; text: string }) => void
  /** Per-mind runtime state to put back after `start`, which is what clears it. */
  restoring?: ReadonlyMap<string, RuntimeSnapshot>
  /** Adjudication and codification, injected because agents may not import the arbiter. */
  arbiter?: SeamArbiter
  /** What a mind pays a scene line with. Absent, no scene ever opens and every mind talks the
   *  way it did before there were scenes. The voice is built here, from what only this function
   *  holds: the persona, the mind's own personality store, and the living cast. */
  sceneClient?: (agentId: string) => LlmClient
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
  const minds = new Map<string, SceneMind>()
  const sceneClient = opts.sceneClient
  const scenes =
    sceneClient === undefined
      ? null
      : new SceneCoordinator({
          bridge: opts.bridge,
          mindFor: (id) => minds.get(id) ?? null,
        })
  // The closed roll a scene line is held to. Read per line, never snapshot: `cast` keeps the
  // dead for a newborn to read its parents from, and a birth adds to it mid-scene.
  const livingCast = (): { id: string; name: string }[] =>
    [...cast.values()]
      .filter((s) => opts.bridge.isAlive(s.id))
      .map((s) => ({ id: s.id, name: s.identity.name }))
  // The same function object the ordinary turn renders its roster from, so both prompts send
  // one prefix and share its cache.
  let asking = 0
  const whileAsking = async <T>(ask: () => Promise<T>): Promise<T> => {
    asking += 1
    try {
      return await ask()
    } finally {
      asking -= 1
    }
  }
  const roster = opts.arbiter?.roster
  const customs = opts.arbiter?.customs
  const frontier = opts.arbiter?.frontier
  const boot = (spec: MindSpec): void => {
    const db = opts.dbFor(spec.id)
    const personality = new PersonalityStore(db, spec.id)
    if (!hasPersonality(db, spec.id))
      personality.init(spec.personality, spec.bornDay ?? opts.day ?? 0)
    const ties = new TieStore(db, spec.id)
    ties.seedKin(spec.kin ?? [], opts.bridge.currentTick())
    if (sceneClient !== undefined) {
      const mem = new MemoryStore(db, spec.id, opts.embedder)
      const voice = makeSceneLlm(sceneClient(spec.id), {
        identity: spec.identity,
        personality: () => ({
          doc: personality.current().doc,
          autobiography: mem.autobiography(),
        }),
        ...(roster === undefined ? {} : { roster }),
        ...(customs === undefined ? {} : { customs }),
        ...(frontier === undefined ? {} : { frontier }),
        livingCast,
      })
      minds.set(spec.id, {
        llm: {
          line: (ask) => whileAsking(() => voice.line(ask)),
          close: (ask) => whileAsking(() => voice.close(ask)),
        },
        ties,
        remember: async (m) => {
          await mem.insertMemory({ ...m, kind: 'speech_heard', tags: EMPTY_SCENE_TAGS })
        },
        // Warmth lives in each runtime's own company map; a scene reads it through the runtime.
        warmth: (otherId) => runtimes.get(spec.id)?.warmthToward(otherId) ?? 0,
      })
    }
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
      ...(scenes === null ? {} : { scenes }),
      ties: { store: ties, cast: livingCast },
      ...(spec.wantBias === undefined ? {} : { wantBias: spec.wantBias }),
      partners: (spec.kin ?? []).filter((k) => k.relation === 'partner').map((k) => k.id),
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
    scenes,
    cast,
    alive: () => [...cast.keys()].filter((id) => opts.bridge.isAlive(id)).length,
    add: boot,
    snapshots: () =>
      [...runtimes.entries()].map(([agentId, r]) => ({ agentId, snapshot: r.snapshot() })),
    reflecting: () => [...runtimes.values()].some((r) => r.reflectionInFlight()),
    busy: () => asking > 0,
    stop: () => {
      for (const r of runtimes.values()) r.stop()
    },
  }
}
