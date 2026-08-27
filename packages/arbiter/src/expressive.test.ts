import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { FakeEmbedder, type LlmClient } from '@sj/agents'
import {
  composePerception,
  fold,
  genesisState,
  registerVerb,
  RngStream,
  submitIntent,
  unregisterVerb,
  VERBS,
  type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import {
  makeArbiter,
  wordTainted,
  type AgentCtx,
  type Arbiter,
  type Codified,
} from './adjudicate.js'
import { openArbiterDb } from './schema.js'
import { CodexStore } from './codex.js'
import { RulebookStore } from './rulebook.js'
import {
  EXPRESSIVE_INSTRUCTION,
  ExpressiveRulingSchema,
  expressiveVerbFromRuling,
  isExpressive,
  type ExpressiveRuling,
} from './expressive.js'
import { ADJUDICATION_INSTRUCTION } from './prompt.js'
import { makeArbiterRig, ScriptedLlm, type ScriptedCall } from './testutil/scriptedLlm.js'
import type { Verdict } from './verdict.js'

const ctx: AgentCtx = {
  agentId: 'a1',
  name: 'Tamar',
  skills: { cooking: 80 },
  inventory: [{ kind: 'wood', qty: 2 }],
  position: { x: 3, y: 5 },
}
const ctx2: AgentCtx = { ...ctx, agentId: 'a2', name: 'Yusuf' }

const DANCE: ExpressiveRuling = {
  word: 'dance',
  sense: 'sight',
  durationTicks: 10,
  energyCost: 2,
  targeted: false,
  emote: 'turns in slow circles, arms wide',
}
const SONG: ExpressiveRuling = {
  word: 'sing',
  sense: 'sound',
  durationTicks: 8,
  energyCost: 1,
  targeted: false,
  emote: 'lifts a long, wavering note',
}

const impossible: Verdict = {
  kind: 'impossible',
  reason: 'no clear way to do this',
  class: 'physically_impossible',
}

const makeRig = async (llm: ScriptedLlm): Promise<Arbiter> =>
  (await makeArbiterRig({ llm })).arbiter

// The scripted answer for whichever prompt arrived: the cheap one gets a ruling,
// the expensive one gets a refusal, so the two paths are told apart by the result.
const script =
  (ruling: ExpressiveRuling) =>
  ({ system }: ScriptedCall): unknown =>
    system.includes(EXPRESSIVE_INSTRUCTION) ? ruling : impossible

// Noon on a flat 64×64: the light is full, so every horizon below is a distance and
// nothing else.
function world(): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0 as const)),
  )
  for (const [id, name] of [
    ['a1', 'Tamar'],
    ['a2', 'Yusuf'],
  ]) {
    s = fold(
      s,
      {
        seq: 1,
        tick: 0,
        type: 'agent_spawned',
        payload: { id, name, x: 20, y: 20, ageDays: 7300 },
      },
      DEFAULT_CONFIG,
    )
  }
  return { ...s, tick: 720 }
}

const expressedAt = (x: number, y: number, sense: 'sight' | 'sound'): SimEvent => ({
  seq: 1,
  tick: 720,
  type: 'agent_expressed',
  payload: { agentId: 'a1', verb: sense === 'sound' ? 'sing' : 'dance', x, y, sense },
})

describe('isExpressive', () => {
  it('accepts an act that moves nothing in the world', () => {
    expect(isExpressive('I dance by the fire')).toBe(true)
    expect(isExpressive('I sing the song my mother sang')).toBe(true)
    expect(isExpressive('I kneel and pray for the child')).toBe(true)
    expect(isExpressive('I bow to Yusuf')).toBe(true)
  })

  it('refuses a taking dressed as an expression', () => {
    expect(isExpressive('I dance on his grave and take his knife')).toBe(false)
    expect(isExpressive('I sing while I build the wall')).toBe(false)
  })

  it('refuses an intent with no expression in it at all', () => {
    expect(isExpressive('I boil river water for salt')).toBe(false)
  })
})

describe('the cheap approval', () => {
  it('rules an expression with one call on the expressive prompt, never the verdict prompt', async () => {
    const llm = new ScriptedLlm(script(DANCE))
    const arbiter = await makeRig(llm)
    try {
      const verdict = await arbiter.adjudicate('I dance by the fire', ctx)
      expect(verdict).toEqual({ kind: 'map', verb: 'express:dance', params: {} })
      expect(llm.objectCalls).toBe(1)
      expect(llm.systems[0]).toContain(EXPRESSIVE_INSTRUCTION)
      expect(llm.systems[0]).not.toContain(ADJUDICATION_INSTRUCTION)
      expect(VERBS['express:dance']).toBeDefined()
    } finally {
      unregisterVerb('express:dance')
    }
  })

  it('gives the word to the whole town — a second body spends nothing', async () => {
    const llm = new ScriptedLlm(script(DANCE))
    const arbiter = await makeRig(llm)
    try {
      await arbiter.adjudicate('I dance by the fire', ctx)
      expect(llm.objectCalls).toBe(1)
      const second = await arbiter.adjudicate('dance', ctx2)
      expect(second).toEqual({ kind: 'map', verb: 'express:dance', params: {} })
      expect(llm.objectCalls).toBe(1)
    } finally {
      unregisterVerb('express:dance')
    }
  })

  it('sends a taking dressed as a dance down the expensive path', async () => {
    const llm = new ScriptedLlm(script(DANCE))
    const arbiter = await makeRig(llm)
    const verdict = await arbiter.adjudicate('I dance on his grave and take his knife', ctx)
    expect(verdict).toEqual(impossible)
    expect(llm.systems[0]).toContain(ADJUDICATION_INSTRUCTION)
    expect(llm.systems[0]).not.toContain(EXPRESSIVE_INSTRUCTION)
    expect(VERBS['express:dance']).toBeUndefined()
  })

  it('shows the model every word it is asked to answer with', () => {
    for (const word of ['sight', 'sound']) expect(EXPRESSIVE_INSTRUCTION).toContain(word)
    expect(ExpressiveRulingSchema.safeParse({ ...DANCE, sense: 'smell' }).success).toBe(false)
    expect(ExpressiveRulingSchema.safeParse({ ...DANCE, extra: 1 }).success).toBe(false)
    expect(ExpressiveRulingSchema.safeParse({ ...DANCE, word: 'Dance The Long One' }).success).toBe(
      false,
    )
  })
})

describe('the coined verb', () => {
  it('does the act, costs the body a little, and leaves the world exactly as it was', () => {
    registerVerb(expressiveVerbFromRuling('dance', DANCE))
    try {
      const s = world()
      const started = submitIntent(s, DEFAULT_CONFIG, 'a1', 'express:dance', {})
      expect(started.ok).toBe(true)
      const def = VERBS['express:dance']!
      expect(def.duration(s, DEFAULT_CONFIG, 'a1', {})).toBe(10)
      const events = def.onComplete(s, DEFAULT_CONFIG, 'a1', {}, RngStream.seed('t', 'expressive'))
      expect(events[0]).toEqual({
        type: 'agent_expressed',
        payload: { agentId: 'a1', verb: 'dance', x: 20, y: 20, sense: 'sight' },
      })
      expect(events[1]).toEqual({
        type: 'need_changed',
        payload: { id: 'a1', need: 'energy', delta: -2 },
      })
    } finally {
      unregisterVerb('express:dance')
    }
  })

  it('carries the sense the ruling gave it, so the world knows a song from a dance', () => {
    registerVerb(expressiveVerbFromRuling('sing', SONG))
    try {
      const s = world()
      const events = VERBS['express:sing']!.onComplete(
        s,
        DEFAULT_CONFIG,
        'a1',
        {},
        RngStream.seed('t', 'expressive'),
      )
      expect(events[0]).toEqual({
        type: 'agent_expressed',
        payload: { agentId: 'a1', verb: 'sing', x: 20, y: 20, sense: 'sound' },
      })
    } finally {
      unregisterVerb('express:sing')
    }
  })

  it('folds to nothing at all — the same object, the same hash', () => {
    const s = world()
    const after = fold(s, expressedAt(20, 20, 'sight'), DEFAULT_CONFIG)
    expect(after).toBe(s)
    expect(stateHash(after)).toBe(stateHash(s))
  })
})

describe('who witnesses it', () => {
  const seenBy = (watcherX: number, ev: SimEvent): unknown[] => {
    const s = world()
    const w: WorldState = { ...s, agents: { ...s.agents, a2: { ...s.agents.a2!, x: watcherX } } }
    return composePerception(w, DEFAULT_CONFIG, 'a2', [ev]).seen
  }

  it('a dance is seen as far as the eye reaches, and no further', () => {
    expect(seenBy(30, expressedAt(20, 20, 'sight'))).toEqual([
      { kind: 'expression', actorName: 'Tamar', verb: 'dance', sense: 'sight' },
    ])
    expect(seenBy(34, expressedAt(20, 20, 'sight'))).toEqual([])
  })

  it('a song carries only as far as the ear, though the eye reaches further', () => {
    expect(seenBy(26, expressedAt(20, 20, 'sound'))).toEqual([
      { kind: 'expression', actorName: 'Tamar', verb: 'sing', sense: 'sound' },
    ])
    expect(seenBy(30, expressedAt(20, 20, 'sound'))).toEqual([])
  })

  it('nobody watches themselves', () => {
    const s = world()
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', [expressedAt(20, 20, 'sight')]).seen).toEqual(
      [],
    )
  })
})

describe('F-C — a coined word is held to the framing law, like a recipe name', () => {
  // makeRig above keeps its db private; this one hands it back so the rulebook can be read.
  async function riggedDb(llm: ScriptedLlm): Promise<{ arbiter: Arbiter; db: Database.Database }> {
    const db = openArbiterDb(':memory:')
    new CodexStore(db).insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
    const arbiter = makeArbiter({
      db,
      llm: llm as unknown as LlmClient,
      embedder: await FakeEmbedder.create(),
      tick: () => 100,
    })
    return { arbiter, db }
  }

  it('refuses every machinery word the schema would otherwise admit', () => {
    for (const w of [
      'ai',
      'model',
      'models',
      'token',
      'tokens',
      'tool',
      'tools',
      'prompt',
      'neural',
      'chatbot',
      'simulation',
    ]) {
      expect(wordTainted(w), w).toBe(true)
    }
  })

  it('admits the words the town actually coins', () => {
    for (const w of ['dance', 'sing', 'mourn', 'salute', 'bow', 'keen', 'hum']) {
      expect(wordTainted(w), w).toBe(false)
    }
  })

  it('does not codify a tainted word — no rulebook row, no verb, no ruling', async () => {
    const tainted: ExpressiveRuling = { ...DANCE, word: 'model' }
    const llm = new ScriptedLlm(script(tainted))
    const { arbiter, db } = await riggedDb(llm)
    try {
      const v = await arbiter.adjudicate('I dance by the fire', ctx)
      // The harm, asserted first: a machinery word became a PERMANENT verb and a permanent
      // rulebook row, and the chronicle would have printed "Tamar was seen to model."
      expect(VERBS['express:model']).toBeUndefined()
      expect(new RulebookStore(db).byId('express:model')).toBeNull()
      expect(v).toEqual(impossible)
    } finally {
      unregisterVerb('express:model')
    }
  })

  it('still codifies the clean word the same run would have coined', async () => {
    const llm = new ScriptedLlm(script(DANCE))
    const { arbiter, db } = await riggedDb(llm)
    try {
      const v = await arbiter.adjudicate('I dance by the fire', ctx)
      expect(v).toEqual({ kind: 'map', verb: 'express:dance', params: {} })
      expect(new RulebookStore(db).byId('express:dance')).not.toBeNull()
    } finally {
      unregisterVerb('express:dance')
    }
  })
})

describe('F-B — BOTH codification paths report their mint, and a third could not hide', () => {
  async function rigWithSpy(llm: ScriptedLlm, seen: Codified[]): Promise<Arbiter> {
    const db = openArbiterDb(':memory:')
    new CodexStore(db).insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
    return makeArbiter({
      db,
      llm: llm as unknown as LlmClient,
      embedder: await FakeEmbedder.create(),
      tick: () => 100,
      onCodified: (d) => seen.push(d),
    })
  }

  it('calls onCodified for a coined word, with kind "word" and no products', async () => {
    const seen: Codified[] = []
    const arbiter = await rigWithSpy(new ScriptedLlm(script(DANCE)), seen)
    try {
      await arbiter.adjudicate('I dance by the fire', ctx)
      expect(seen).toEqual([
        {
          recipeId: 'express:dance',
          name: 'dance',
          kind: 'word',
          makes: [],
          credit: { agentId: ctx.agentId, intent: 'I dance by the fire' },
        },
      ])
    } finally {
      unregisterVerb('express:dance')
    }
  })

  it('does not report a word the town already has', async () => {
    const seen: Codified[] = []
    const arbiter = await rigWithSpy(new ScriptedLlm(script(DANCE)), seen)
    try {
      await arbiter.adjudicate('I dance by the fire', ctx)
      await arbiter.adjudicate('I dance in the rain', ctx2)
      expect(seen).toHaveLength(1)
    } finally {
      unregisterVerb('express:dance')
    }
  })

  it('does not report a tainted word, because a tainted word is never codified', async () => {
    const seen: Codified[] = []
    const arbiter = await rigWithSpy(new ScriptedLlm(script({ ...DANCE, word: 'prompt' })), seen)
    try {
      await arbiter.adjudicate('I dance by the fire', ctx)
      expect(seen).toEqual([])
    } finally {
      unregisterVerb('express:prompt')
    }
  })

  // A discovery record hooked only to codify() misses every coined word: a new rulebook row is
  // a new codification, and every one of them must report it.
  it('every rulebook INSERT in the arbiter reports its mint — a third path could not be silent', () => {
    const dir = new URL('.', import.meta.url)
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')] as const)

    const mints: { file: string; line: number; text: string }[] = []
    for (const [file, src] of sources) {
      src.split('\n').forEach((text, i) => {
        if (/\brulebook\.insert\(/.test(text)) mints.push({ file, line: i + 1, text: text.trim() })
      })
    }

    // A third codification path arriving fails this count, which is the point. Counted by file
    // rather than by line so an unrelated edit above does not cry wolf.
    expect(mints.map((m) => m.file)).toEqual(['adjudicate.ts', 'codify.ts'])

    for (const mint of mints) {
      const src = sources.find(([f]) => f === mint.file)![1].split('\n')
      const after = src.slice(mint.line, mint.line + 12).join('\n')
      expect(
        after,
        `${mint.file}:${mint.line} mints a permanent verb and never reports it`,
      ).toContain('onCodified')
    }
  })
})
