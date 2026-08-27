import type Database from 'better-sqlite3'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { makeArbiter, type AgentCtx, type Arbiter } from '../adjudicate.js'
import { CodexStore, type CodexEntry } from '../codex.js'
import { openArbiterDb } from '../schema.js'

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

export type ScriptedCall = { intent: string; system: string; user: string }

// Never talks to a provider: answers from a script, counts the calls, and keeps every prompt
// it was handed so a glass scan can run over all of the suite's traffic.
export class ScriptedLlm {
  objectCalls = 0
  lastSystem = ''
  systems: string[] = []
  users: string[] = []

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
    return Promise.resolve({
      value: this.respond({ intent, system: opts.system, user }),
      usage: emptyUsage(),
    })
  }

  text(): Promise<{ text: string; usage: LlmUsage }> {
    return Promise.resolve({ text: '', usage: emptyUsage() })
  }

  totalCostUsd(): number {
    return 0
  }

  alert(): void {
    // a scripted client has no provider to raise anything against
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
