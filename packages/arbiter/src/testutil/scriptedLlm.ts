import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { makeArbiter, type AgentCtx, type Arbiter } from '../adjudicate.js'
import { CodexStore, type CodexEntry } from '../codex.js'
import { openArbiterDb } from '../schema.js'
import { StrictVerdictSchema, VerdictSchema } from '../verdict.js'

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

export type ScriptedCall = { intent: string; system: string; user: string }

type AnyZod = z.ZodType
type AnyShape = z.ZodObject<Record<string, AnyZod>>

/** A verdict the town keeps, written in the dialect the court answers in: every key the schema
 *  names, absence written null. Derived like the dialect itself, so a script never spells one out. */
export function strictDialect(value: unknown, schema: AnyZod = VerdictSchema): unknown {
  const { type } = schema.def
  if (type === 'optional' || type === 'nullable')
    return strictDialect(value, (schema as z.ZodOptional<AnyZod>).unwrap())
  if (type === 'array')
    return Array.isArray(value)
      ? value.map((v) => strictDialect(v, (schema as z.ZodArray<AnyZod>).element))
      : value
  if (type === 'union') {
    const option = (schema as z.ZodUnion<[AnyZod]>).options.find((o) => o.safeParse(value).success)
    return option === undefined ? value : strictDialect(value, option)
  }
  if (type !== 'object' || value === null || typeof value !== 'object') return value
  const named = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries((schema as AnyShape).shape).map(([key, field]) => [
      key,
      named[key] === undefined ? null : strictDialect(named[key], field),
    ]),
  )
}

// Never talks to a provider: answers from a script, counts the calls, and keeps every prompt
// it was handed so a glass scan can run over all of the suite's traffic.
export class ScriptedLlm {
  objectCalls = 0
  lastSystem = ''
  systems: string[] = []
  users: string[] = []
  alerts: { kind: string; detail: string }[] = []

  constructor(private readonly respond: (call: ScriptedCall) => unknown) {}

  object(opts: {
    system: string
    messages: LlmMessage[]
    schema: unknown
  }): Promise<{ value: unknown; usage: LlmUsage }> {
    this.objectCalls += 1
    this.lastSystem = opts.system
    this.systems.push(opts.system)
    const user = opts.messages.at(-1)?.content ?? ''
    this.users.push(user)
    const intent =
      user
        .split('\n')
        .at(-1)
        ?.replace(/^Intent: /, '') ?? ''
    const value = this.respond({ intent, system: opts.system, user })
    const wire = opts.schema === StrictVerdictSchema ? { verdict: strictDialect(value) } : value
    return Promise.resolve({ value: wire, usage: emptyUsage() })
  }

  text(): Promise<{ text: string; usage: LlmUsage }> {
    return Promise.resolve({ text: '', usage: emptyUsage() })
  }

  totalCostUsd(): number {
    return 0
  }

  alert(kind: string, detail: string): void {
    this.alerts.push({ kind, detail })
  }
}

export const TAMAR_CTX: AgentCtx = {
  agentId: 'a1',
  name: 'Tamar',
  skills: { cooking: 80, farming: 120 },
  inventory: [
    { kind: 'wood', qty: 2 },
    { kind: 'clay_pot', qty: 1 },
  ],
  position: { x: 3, y: 5 },
}

const HANDWORK_LADDER: readonly CodexEntry[] = [
  { id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null },
  { id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null },
]

export type EmbedderLike = { embed(t: string): Promise<Float32Array> }

export async function makeArbiterRig(opts: {
  llm: ScriptedLlm
  embedder?: EmbedderLike
  ladder?: readonly CodexEntry[]
  vocabulary?: { itemKinds: readonly string[]; structureKinds: readonly string[] }
}): Promise<{
  db: Database.Database
  codex: CodexStore
  arbiter: Arbiter
  embedder: EmbedderLike
}> {
  const db = openArbiterDb(':memory:')
  const codex = new CodexStore(db)
  for (const entry of opts.ladder ?? HANDWORK_LADDER) codex.insert(entry)
  const embedder = opts.embedder ?? (await FakeEmbedder.create())
  const arbiter = makeArbiter({
    db,
    llm: opts.llm as unknown as LlmClient,
    embedder,
    tick: () => 100,
    ...(opts.vocabulary === undefined ? {} : { vocabulary: opts.vocabulary }),
  })
  return { db, codex, arbiter, embedder }
}
