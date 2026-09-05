// Every unit test behind scenes passed while `liveWorld.ts` handed `bootMinds` no scene client
// and the served town talked exactly as it had before scenes existed. This is the row that would
// have caught it: it boots the real served world and watches a scene open inside it.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { insertAlert, insertTurnOutcome, type LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { DAYS_PER_YEAR, NO_PARAMS } from '@sj/shared'
import { SceneTurnSchema, type MindSpec } from '@sj/agents'
import { foundersFor, startDevWorld, townStructuresFor, type DevWorld } from '@sj/town'
import { createLiveCast } from './liveWorld.js'

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

// The well is on both founders' patrol, so two minds walking there end up in one another's
// earshot — the only condition under which a word said opens a scene.
const WELLSIDE = foundersFor(townStructuresFor('showcase')).find((f) => f.id === 'amara')!.patrol[1]

// A scene is closed on sight at night, so nothing can be watched until the town is in daylight:
// `isNight` runs to 06:00.
const DAYBREAK = 6 * 60
// Long enough for a whole scene and the ordinary turns on either side of it: the floor passes
// every tick and `LINE_CAP` is twelve.
const WATCHED_TICKS = 60

// Two of the town's twelve bodies. The ids match, or `resolveCast` gives the mind no body.
const TWO: MindSpec[] = [
  { id: 'amara', name: 'Amara', sex: 'f' as const },
  { id: 'omar', name: 'Omar', sex: 'm' as const },
].map((m) => ({
  id: m.id,
  sex: m.sex,
  ageDays: 34 * DAYS_PER_YEAR,
  identity: {
    name: m.name,
    age: 34,
    backstory: 'Lives in the valley.',
    temperament: 'plain',
    voiceCard: {
      register: 'plain',
      rhythm: 'short',
      tics: [],
      neverSays: [],
      exampleLines: ['Put it back.'],
      wordBudget: { typical: 12, burst: 22 },
    },
  },
  personality: {
    temperament: 'plain',
    values: ['the valley'],
    beliefs: ['what is counted keeps'],
    current: { mood: 'watchful', worries: [], goals: ['get through the day'] },
  },
}))

const OPENING_WORD = 'Well then.'
const SCENE_LINE = 'And then what.'

/** What an ordinary turn answers: walk to the well, and say nothing at all before daybreak, so
 *  the scene this row watches is one it opened itself, in the light. */
const turnAnswer = (speaking: boolean): unknown => ({
  speech: speaking ? OPENING_WORD : null,
  plan: null,
  journal: null,
  recall: null,
  reconsider_at: null,
  thought: 'Toward the well.',
  importance: 5,
  action: { verb: 'walk', params: { ...NO_PARAMS, x: WELLSIDE.x, y: WELLSIDE.y } },
})

const SCENE_TURN = {
  thought: 'Something to answer.',
  speech: SCENE_LINE,
  to: null,
  gesture: null,
  move: 'none',
  stance: null,
  answer: null,
  leave: false,
  importance: 5,
}
const SCENE_CLOSE = { summary: 'They talked at the well.', ties: [] }

// A strict schema and a hand-written answer drift apart in silence: one missing key fails the
// parse, the floor-holder never speaks, and it reads as a scene nobody happened to answer.
SceneTurnSchema.parse(SCENE_TURN)

const ANSWERS: Record<string, unknown[]> = {
  scene: [SCENE_TURN],
  'scene.close': [SCENE_CLOSE],
}
const OTHER_ANSWERS: unknown[] = [{ facts: [] }, { scenes: [] }, { summary: '' }, { edits: [] }, {}]

type Call = { caller: string; agentId: string; tick: number }

type FakeOpts = {
  db: Database.Database
  caller: string
  agentId: string | null
  turn: () => unknown
  tick: () => number
  record: (c: Call) => void
}

/** A model that never leaves the process, and a note of every call it takes: who asked, under
 *  which pin, on which tick. `noteCallBill` is not optional — the runtime books every turn
 *  through it, and a double without it fails the turn instead of the assertion. */
function fakeLlm(o: FakeOpts): LlmClient {
  const answers = (): unknown[] =>
    o.caller === 'turn' ? [o.turn()] : (ANSWERS[o.caller] ?? OTHER_ANSWERS)
  return {
    async object<T>(a: { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) {
      o.record({ caller: o.caller, agentId: o.agentId ?? '-', tick: o.tick() })
      for (const c of answers()) {
        const parsed = a.schema.safeParse(c)
        if (parsed.success) return { value: parsed.data as T, usage: NO_USAGE }
      }
      throw new Error(`no canned answer fits the schema ${o.caller} was asked with`)
    },
    async text() {
      return { text: 'the day passes', usage: NO_USAGE }
    },
    totalCostUsd: () => 0,
    alert: (kind: string, detail: string) => {
      insertAlert(o.db, { agentId: o.agentId, kind, detail })
    },
    noteCallBill: () => {},
    noteTurnOutcome: (out: { acted: boolean; spoke: boolean; planContinued: boolean }) => {
      insertTurnOutcome(o.db, { agentId: o.agentId, provider: null, ...out })
    },
    // The scene's close rides its own pin, so the account of a scene is told apart from its lines.
    forCaller: (caller: string) => fakeLlm({ ...o, caller }),
  } as unknown as LlmClient
}

type Event = { tick: number; type: string; payload: Record<string, unknown> }

const dirs: string[] = []
const worlds: DevWorld[] = []

afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** The served world, exactly as `serve.ts` builds it, with every mind-facing call answered in
 *  process and written down. */
async function watchedTown(): Promise<{ dir: string; calls: Call[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'sj-scene-'))
  dirs.push(dir)
  const agentDbDir = join(dir, 'minds')
  const calls: Call[] = []
  let world: DevWorld | null = null
  const tick = (): number => world?.loop.tick ?? -1
  world = await startDevWorld({
    dbPath: join(dir, 'world.db'),
    port: 0,
    world: { map: 'showcase' },
    realMsPerTick: 10_000_000,
    agentDbDir,
    cast: async () =>
      await createLiveCast({
        agentDbDir,
        minds: TWO,
        preflight: false,
        embedder: new FakeEmbedder(),
        // A turn every twelve ticks: eager enough to reach the well before noon, quiet enough
        // that the night this row must sit through does not cost seven hundred turns.
        mindConfig: {
          idleGapTicks: 12,
          boredomTicks: 1,
          bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
        },
        log: () => {},
        makeClient: (db, caller, agentId) =>
          fakeLlm({
            db,
            caller,
            agentId: agentId ?? null,
            turn: () => turnAnswer(tick() >= DAYBREAK),
            tick,
            record: (c) => calls.push(c),
          }),
      }),
  })
  worlds.push(world)
  for (let i = 0; i < DAYBREAK + WATCHED_TICKS; i++) {
    world.tick()
    for (let k = 0; k < 12; k++) await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
  return { dir, calls }
}

function eventsOf(dir: string, type: string): Event[] {
  const db = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  try {
    return (
      db
        .prepare('SELECT tick, type, payload FROM events WHERE type = ? ORDER BY seq')
        .all(type) as {
        tick: number
        type: string
        payload: string
      }[]
    ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }))
  } finally {
    db.close()
  }
}

describe('★ A SCENE OPENS IN THE SERVED WORLD', () => {
  it('★ two minds at the well fall into one scene, and the second one takes the floor', async () => {
    const { dir, calls } = await watchedTown()

    const opened = eventsOf(dir, 'scene_opened')
    expect(opened.length).toBeGreaterThan(0)
    expect(opened[0]!.payload.participants).toEqual(expect.arrayContaining(['amara', 'omar']))
    // The pin a scene line is paid for under. Absent, `bootMinds` was handed no scene client and
    // no coordinator was ever built.
    expect(calls.map((c) => c.caller)).toContain('scene')

    const lines = eventsOf(dir, 'scene_line').filter((e) => e.payload.id === opened[0]!.payload.id)
    // The opener's own word is the first line. A word the other mind had already sent when the
    // talk opened lands in the thread too; every line after those was taken by the floor.
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]!.payload.text).toBe(OPENING_WORD)
    const taken = lines.filter((l) => l.payload.text === SCENE_LINE)
    expect(taken.length).toBeGreaterThan(0)
    expect(taken[0]!.payload.agentId).not.toBe(lines[0]!.payload.agentId)
    expect(new Set(lines.map((l) => l.payload.agentId))).toEqual(new Set(['amara', 'omar']))
  }, 120_000)

  it('★ a listener pays for NOTHING — one call a line, taken by the mouth that says it', async () => {
    const { dir, calls } = await watchedTown()

    const opened = eventsOf(dir, 'scene_opened')[0]!
    const id = opened.payload.id
    const lines = eventsOf(dir, 'scene_line').filter((e) => e.payload.id === id)
    // The close is stamped on the same tick as the last line, and both minds are back on
    // ordinary turns from that tick on — so the scene runs over the ticks strictly between.
    const closedAt = eventsOf(dir, 'scene_closed').find((e) => e.payload.id === id)?.tick
    const until = closedAt ?? DAYBREAK + WATCHED_TICKS
    const during = calls.filter((c) => c.tick > opened.tick && c.tick < until)

    // Not vacuous: both minds were taking ordinary turns right up to the word that opened it.
    expect(
      calls.filter((c) => c.caller === 'turn' && c.tick <= opened.tick).map((c) => c.agentId),
    ).toEqual(expect.arrayContaining(['amara', 'omar']))
    // Nobody in the scene takes an ordinary turn while it runs — that is what makes hearing free.
    expect(during.filter((c) => c.caller === 'turn')).toEqual([])
    // And every line the floor took cost exactly one call, made by the mouth that said it; a
    // word sent before the talk opened was paid for as the ordinary turn it was.
    expect(during.filter((c) => c.caller === 'scene').map((c) => c.agentId)).toEqual(
      lines.filter((l) => l.payload.text === SCENE_LINE).map((l) => l.payload.agentId),
    )
  }, 120_000)
})
