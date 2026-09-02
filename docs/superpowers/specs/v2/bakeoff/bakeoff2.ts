// Phase 2: model x provider quality panel on six unambiguous scenes, through the live client
// (LlmClient -> ai SDK -> OpenRouter), live schema TurnSchemaActionRequired, real prose renderer.
// Run from the repo root:
//   node --env-file=/home/ubuntu/workspace/SanJunipero/.env --import tsx \
//     /tmp/claude-1001/-home-ubuntu-workspace-SanJunipero/17e53c4c-8688-42fe-bd93-a48d187bfbab/scratchpad/bakeoff/bakeoff2.ts \
//     [--models=z-ai/glm-5.3-flash,...] [--providers=wafer,reka,...] [--n=8] [--scenes=1,2,3] [--cap=2.9] [--waves=3]
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { openAgentDb } from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/memory/schema.ts'
import { LlmClient, migrateLlmTables } from '/home/ubuntu/workspace/SanJunipero/packages/llm/src/index.ts'
import { createOpenRouter } from '/home/ubuntu/workspace/SanJunipero/packages/llm/node_modules/@openrouter/ai-sdk-provider/dist/index.js'
import { simTimeFromTick } from '/home/ubuntu/workspace/SanJunipero/packages/shared/src/index.ts'
import {
  fixtureBlocks,
  quietMeadowPacket,
} from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/testutil/fixtures.ts'
import {
  heardProse,
  perceptionToProse,
  placesKnownLine,
  standingWallsLine,
  type PerceptionPacket,
} from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/prompt/prose.ts'
import { assemblePrompt, type AssembledPrompt } from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/prompt/assemble.ts'
import {
  TurnSchemaActionRequired,
  turnSpeaks,
  waitIsRest,
  type Turn,
} from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/turn.ts'

const require = createRequire('/home/ubuntu/workspace/SanJunipero/packages/agents/src/turn.ts')
const { z } = require('zod') as typeof import('zod')

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = ''] = a.replace(/^--/, '').split('=')
    return [k, v] as const
  }),
)
const list = (k: string): string[] => (args.get(k) ?? '').split(',').filter((x) => x.length > 0)
const N = Number(args.get('n') ?? 8)
const CAP_USD = Number(args.get('cap') ?? 2.9)
const WAVES = Number(args.get('waves') ?? 3)
const TIMEOUT_MS = 60_000
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const DB_PATH = path.join(OUT_DIR, 'bakeoff2.db')
const OUT_PATH = path.join(OUT_DIR, 'results2.json')

// ---------------------------------------------------------------- candidates
type Candidate = {
  id: string
  model: string
  slug: string // OpenRouter provider slug for provider.order
  provider: string // display name OpenRouter reports back
  transport: 'response_format' | 'tool'
  toolChoice?: 'named' | 'auto'
  schema: 'live' | 'strict'
  reasoning?: { effort: 'low' }
  maxOutputTokens: number
  priceIn: number // $/M
  priceOut: number
  quant: string
}
const GLM = 'z-ai/glm-5.3-flash'
const GEM = 'google/gemini-3.7-flash'
const DSP = 'deepseek/deepseek-v4-pro-0813'
const LUNA = 'openai/gpt-5.6-luna'
const glm = (slug: string, provider: string, quant: string, priceIn = 0.15, priceOut = 0.5): Candidate => ({
  id: `glm@${slug}`,
  model: GLM,
  slug,
  provider,
  transport: 'response_format',
  schema: 'live',
  maxOutputTokens: 600,
  priceIn,
  priceOut,
  quant,
})
const CANDIDATES: Candidate[] = [
  glm('wafer', 'Wafer', 'unknown'),
  glm('reka', 'Reka', 'fp8'),
  glm('nextbit', 'NextBit', 'fp8'),
  glm('deepinfra', 'DeepInfra', 'fp8', 0.075, 0.25),
  glm('together', 'Together', 'unknown'),
  glm('cloudflare', 'Cloudflare', 'unknown'),
  // No structured_outputs on these two: the client's other transport, tools with auto choice.
  { ...glm('z-ai', 'Z.AI', 'fp8', 0.075, 0.25), id: 'glm@z-ai(tool)', transport: 'tool', toolChoice: 'auto' },
  { ...glm('gmicloud', 'GMICloud', 'fp8', 0.075, 0.25), id: 'glm@gmicloud(tool)', transport: 'tool', toolChoice: 'auto' },
  {
    id: 'gemini@google-ai-studio',
    model: GEM,
    slug: 'google-ai-studio',
    provider: 'Google AI Studio',
    transport: 'response_format',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.75,
    priceOut: 3.75,
    quant: 'unknown',
  },
  {
    id: 'gemini@google-vertex',
    model: GEM,
    slug: 'google-vertex/global',
    provider: 'Google',
    transport: 'response_format',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.75,
    priceOut: 3.75,
    quant: 'unknown',
  },
  {
    id: 'gemini@google-ai-studio-flex',
    model: GEM,
    slug: 'google-ai-studio/flex',
    provider: 'Google AI Studio',
    transport: 'response_format',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.375,
    priceOut: 1.875,
    quant: 'unknown',
  },
  {
    id: 'dsv4pro@alibaba',
    model: DSP,
    slug: 'alibaba',
    provider: 'Alibaba',
    transport: 'response_format',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.581,
    priceOut: 1.742,
    quant: 'unknown',
  },
  {
    id: 'dsv4pro@deepseek(tool-auto)',
    model: DSP,
    slug: 'deepseek',
    provider: 'DeepSeek',
    transport: 'tool',
    toolChoice: 'auto',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.66,
    priceOut: 1.98,
    quant: 'unknown',
  },
  {
    id: 'luna@openai(rf-live)',
    model: LUNA,
    slug: 'openai',
    provider: 'OpenAI',
    transport: 'response_format',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.2,
    priceOut: 1.2,
    quant: 'unknown',
  },
  {
    id: 'luna@openai(tool)',
    model: LUNA,
    slug: 'openai',
    provider: 'OpenAI',
    transport: 'tool',
    toolChoice: 'named',
    schema: 'live',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.2,
    priceOut: 1.2,
    quant: 'unknown',
  },
  // What a schema fix would buy: every field required-and-nullable, params a closed 13-key object.
  {
    id: 'luna@openai(rf-strictfix)',
    model: LUNA,
    slug: 'openai',
    provider: 'OpenAI',
    transport: 'response_format',
    schema: 'strict',
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
    priceIn: 0.2,
    priceOut: 1.2,
    quant: 'unknown',
  },
]

// ------------------------------------------------------- strict schema (mock of a fix)
const nullStr = z.string().min(1).nullable()
const StrictParams = z
  .object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    itemId: nullStr,
    structureId: nullStr,
    targetId: nullStr,
    cropId: nullStr,
    nodeId: nullStr,
    faunaId: nullStr,
    kind: nullStr,
    recipe: nullStr,
    track: nullStr,
    text: nullStr,
    description: nullStr,
  })
  .strict()
  .describe('Exactly what the act asks for, named by its keys; every key you do not need is null.')
const StrictIntent = z
  .object({
    verb: z.string().min(1).describe('The exact word of the act, such as walk or eat.'),
    params: StrictParams,
  })
  .strict()
const StrictTurn = z
  .object({
    thought: z.string().min(1).describe('What passes through your mind this moment. Yours alone.'),
    speech: z.string().min(1).nullable().describe('Words you say aloud, or null.'),
    action: z
      .union([StrictIntent, z.object({ freeform: z.string().min(1) }).strict()])
      .describe(
        "One act you begin now. If you truly do nothing this turn, answer { verb: 'wait', params: all null }.",
      ),
    plan: z.array(StrictIntent).max(12).nullable(),
    journal: z.string().min(1).nullable(),
    recall: z.string().min(1).nullable(),
    importance: z.number().int().min(1).max(10),
    reconsider_at: z
      .union([
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        z.object({ day: z.number().int().positive(), phase: z.enum(['day', 'dusk', 'night']) }).strict(),
      ])
      .nullable(),
  })
  .strict()
// Back to the live shape: null params dropped, so the live schema can judge it.
function fromStrict(v: unknown): unknown {
  const t = v as { action?: unknown; plan?: unknown[] | null }
  const clean = (i: unknown): unknown => {
    const o = i as { verb?: string; params?: Record<string, unknown> }
    if (o.params === undefined) return i
    return {
      verb: o.verb,
      params: Object.fromEntries(Object.entries(o.params).filter(([, x]) => x !== null)),
    }
  }
  return { ...(t as object), action: clean(t.action), plan: t.plan == null ? t.plan : t.plan.map(clean) }
}

// ------------------------------------------------------------------ scenes
type Axis = { verb: 0 | 1; param: 0 | 1; speech: 0 | 1; ids: 0 | 1 }
type Scene = {
  n: number
  name: string
  prompt: AssembledPrompt
  knownIds: Set<string>
  actRequired: boolean
  judge: (turn: Turn) => Axis
}
const WORLD = {
  isWalkable: () => true,
  isEdible: (k: string) => k === 'bread' || k === 'berries',
  waterAtHand: () => false,
  nearestWater: () => null,
  nearestFood: () => null,
}
const TAMAR = 'tamar'
const base = (over: Partial<PerceptionPacket> & { self?: Partial<PerceptionPacket['self']> }): PerceptionPacket => ({
  ...quietMeadowPacket,
  ...over,
  self: { ...quietMeadowPacket.self, ...(over.self ?? {}) },
  reach: over.reach ?? { atHand: [], noFooting: [] },
})
const speechText = (turn: Turn): string => {
  if (turn.speech) return turn.speech
  const a = turn.action
  if (a && !('freeform' in a) && a.verb === 'speak' && typeof a.params.text === 'string') return a.params.text
  return ''
}
const ID_KEYS = ['itemId', 'structureId', 'targetId', 'cropId', 'nodeId', 'faunaId'] as const
function idsOk(turn: Turn, known: Set<string>): 0 | 1 {
  const intents = [turn.action, ...(turn.plan ?? [])].filter(
    (a): a is { verb: string; params: Record<string, unknown> } => !!a && !('freeform' in a),
  )
  for (const i of intents)
    for (const k of ID_KEYS) {
      const v = i.params[k]
      if (v !== undefined && v !== null && !known.has(String(v))) return 0
    }
  return 1
}
const act = (turn: Turn): { verb: string; params: Record<string, unknown> } | null => {
  const a = waitIsRest(turn).action
  return a && !('freeform' in a) ? a : null
}
const b = (x: boolean): 0 | 1 => (x ? 1 : 0)

function scene1(): Scene {
  const packet = base({
    self: {
      body: { needs: { hunger: 20, energy: 78, warmth: 71, social: 55 }, hp: 100, injuries: [], ill: false },
      inventory: [{ id: 'item_bread_7', kind: 'bread', qty: 1, loc: { t: 'agent', id: TAMAR } }],
    },
  })
  const prose = perceptionToProse(packet, undefined, WORLD)
  return {
    n: 1,
    name: 'hungry, bread in hand -> eat item_bread_7',
    prompt: assemblePrompt(fixtureBlocks({ now: { prose } })),
    knownIds: new Set(['item_bread_7']),
    actRequired: true,
    judge: (t) => {
      const a = act(t)
      return {
        verb: b(a?.verb === 'eat'),
        param: b(a?.verb === 'eat' && a.params.itemId === 'item_bread_7'),
        speech: b(!turnSpeaks(t)),
        ids: idsOk(t, new Set(['item_bread_7'])),
      }
    },
  }
}
function scene2(): Scene {
  const packet = base({
    time: simTimeFromTick(14 * 60),
    visible: {
      agents: [{ id: 'nadia', name: 'Nadia', x: 13, y: 9, activityVerb: null, collapsed: false, asleep: false }],
      structures: [],
      items: [],
      crops: [],
    },
    heard: [
      {
        speakerId: 'nadia',
        name: 'Nadia',
        text: 'Tamar, did your roof hold in last night\'s wind, or do you need a hand with it?',
        distance: 1,
      },
    ],
  })
  const prose = perceptionToProse(packet, undefined, WORLD)
  const heardStr = heardProse(packet)
  const asked = /roof|held|hold|wind|storm|night|hand|help/i
  return {
    n: 2,
    name: 'Nadia asks about the roof -> speak an answer',
    prompt: assemblePrompt(fixtureBlocks({ now: { prose, heard: heardStr } })),
    knownIds: new Set(['nadia']),
    actRequired: false,
    judge: (t) => {
      const text = speechText(t)
      const spoke = turnSpeaks(t)
      return {
        verb: b(spoke),
        param: b(spoke && asked.test(text)),
        speech: b(spoke && !/did your roof hold in last night/i.test(text)),
        ids: idsOk(t, new Set(['nadia'])),
      }
    },
  }
}
function scene3(): Scene {
  const packet = base({
    self: {
      inventory: [{ id: 'item_bread_7', kind: 'bread', qty: 1, loc: { t: 'agent', id: TAMAR } }],
    },
    visible: {
      agents: [
        {
          id: 'nadia',
          name: 'Nadia',
          x: 13,
          y: 9,
          activityVerb: null,
          collapsed: true,
          asleep: false,
          condition: 'grey in the face and thin',
        },
      ],
      structures: [],
      items: [],
      crops: [],
    },
  })
  const prose = perceptionToProse(packet, undefined, WORLD)
  const known = new Set(['nadia', 'item_bread_7'])
  return {
    n: 3,
    name: 'Nadia collapsed at hand, bread in hand -> give/tend nadia',
    prompt: assemblePrompt(fixtureBlocks({ now: { prose } })),
    knownIds: known,
    actRequired: true,
    judge: (t) => {
      const a = act(t)
      const verbOk = a?.verb === 'give' || a?.verb === 'tend'
      const paramOk =
        (a?.verb === 'give' && a.params.targetId === 'nadia' && a.params.itemId === 'item_bread_7') ||
        (a?.verb === 'tend' && a.params.targetId === 'nadia')
      return { verb: b(verbOk), param: b(!!paramOk), speech: 1, ids: idsOk(t, known) }
    },
  }
}
function scene4(): Scene {
  const packet = base({
    time: simTimeFromTick(22 * 60 + 30),
    self: {
      x: 12,
      y: 9,
      body: { needs: { hunger: 60, energy: 50, warmth: 25, social: 55 }, hp: 100, injuries: [], ill: false },
    },
    weather: { kind: 'clear', temperatureC: 2 },
    cold: { biting: true },
    light: 'dark',
  })
  const places = placesKnownLine(
    [{ id: 'house_tamar', kind: 'house', x: 40, y: 30, name: "Tamar's house" }],
    packet,
  )
  const prose = `${perceptionToProse(packet, undefined, WORLD)} ${places}`
  return {
    n: 4,
    name: 'night, cold, far from home, home known -> walk house_tamar',
    prompt: assemblePrompt(
      fixtureBlocks({
        dayLog: ['You left your house (house_tamar) at first light and walked out to the far meadow.'],
        now: { prose },
      }),
    ),
    knownIds: new Set(['house_tamar']),
    actRequired: true,
    judge: (t) => {
      const a = act(t)
      const toHouse =
        a?.params.structureId === 'house_tamar' ||
        (typeof a?.params.x === 'number' &&
          typeof a.params.y === 'number' &&
          Math.hypot(a.params.x - 40, a.params.y - 30) <= 3)
      return {
        verb: b(a?.verb === 'walk' || a?.verb === 'enter'),
        param: b(!!toHouse),
        speech: b(!turnSpeaks(t)),
        ids: idsOk(t, new Set(['house_tamar'])),
      }
    },
  }
}
function scene5(): Scene {
  const packet = base({
    self: {
      x: 12,
      y: 10,
      inventory: [{ id: 'item_wood_12', kind: 'wood', qty: 3, loc: { t: 'agent', id: TAMAR } }],
    },
    visible: {
      agents: [],
      structures: [
        { id: 'shed_tamar_1', kind: 'shed', x: 12, y: 8, w: 2, h: 2, burning: false, stage: 'construction', raised: { done: 2, needs: 5 } },
      ],
      items: [],
      crops: [],
    },
  })
  const walls = standingWallsLine({ kind: 'shed', at: { x: 12, y: 8 }, done: 2, needs: 5 })
  const prose = `${perceptionToProse(packet, undefined, WORLD)} What your hands know how to raise, given the stuff and a spot to put it: a shed (3 wood). ${walls}`
  const known = new Set(['shed_tamar_1', 'item_wood_12'])
  return {
    n: 5,
    name: 'wood in hand at own half-built shed -> build shed',
    prompt: assemblePrompt(
      fixtureBlocks({
        dayLog: ['You began raising your shed (shed_tamar_1) this morning and went for more wood.'],
        now: { prose },
      }),
    ),
    knownIds: known,
    actRequired: true,
    judge: (t) => {
      const a = act(t)
      return {
        verb: b(a?.verb === 'build'),
        param: b(a?.verb === 'build' && (a.params.kind === 'shed' || a.params.structureId === 'shed_tamar_1')),
        speech: b(!turnSpeaks(t)),
        ids: idsOk(t, known),
      }
    },
  }
}
function scene6(): Scene {
  const packet = base({
    self: { activity: 'walk', activityToward: { x: 30, y: 20 } },
  })
  const prose = perceptionToProse(packet, undefined, WORLD)
  return {
    n: 6,
    name: 'plan running, nothing new -> wait, no speech',
    prompt: assemblePrompt(
      fixtureBlocks({ now: { prose }, underway: { what: 'walk 30 20', step: 1, of: 2 } }),
    ),
    knownIds: new Set(),
    actRequired: false,
    judge: (t) => ({
      verb: b(act(t) === null && !(t.action && 'freeform' in t.action)),
      param: b((t.plan ?? null) === null),
      speech: b(!turnSpeaks(t)),
      ids: idsOk(t, new Set()),
    }),
  }
}
const ALL_SCENES = [scene1(), scene2(), scene3(), scene4(), scene5(), scene6()]

// ------------------------------------------------------------------ runner
type CallRow = {
  scene: number
  ok: boolean
  valid: boolean
  acted: boolean
  score: number
  axis: Axis | null
  verb: string | null
  paramKeys: number
  errorKind: 'none' | '429' | 'timeout' | 'decode' | 'http' | 'other'
  error: string | null
  latencyMs: number
  servedProvider: string | null
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  finishReason: string | null
  sample?: { thought: string; speech?: string | null; action: unknown }
}
type Summary = {
  id: string
  model: string
  provider: string
  transport: string
  quant: string
  calls: number
  scenesRun: number
  dropped: boolean
  valid: number
  actRequiredCalls: number
  actRequiredActed: number
  meanScore: number
  meanParamKeys: number
  axisMeans: Axis & Record<string, number>
  perScene: Record<number, { calls: number; valid: number; mean: number }>
  http429: number
  timeouts: number
  decodeFails: number
  otherErrors: number
  p50Ms: number
  p95Ms: number
  costUsd: number
  costPerCallUsd: number
  costPer1kTurnsUsd: number
  servedProviders: string[]
  errors: string[]
  verbs: Record<string, number>
  samples: { scene: number; sample: CallRow['sample'] }[]
}

function classify(err: unknown): { errorKind: CallRow['errorKind']; error: string } {
  const e = err as { statusCode?: number; name?: string; message?: string; responseBody?: string }
  const status = typeof e.statusCode === 'number' ? e.statusCode : null
  const text = `${e.name ?? ''}: ${e.message ?? String(err)} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`
    .replace(/\s+/g, ' ')
    .slice(0, 400)
  if (status === 429 || /\b429\b|rate[ _-]?limit|too many requests/i.test(text)) return { errorKind: '429', error: text }
  if (e.name === 'AI_NoObjectGeneratedError') return { errorKind: 'decode', error: text }
  if (/tool transport:/.test(text)) return { errorKind: 'decode', error: text }
  if (/abort|timeout|timed out/i.test(text)) return { errorKind: 'timeout', error: text }
  if (status !== null) return { errorKind: 'http', error: text }
  return { errorKind: 'other', error: text }
}
const q = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!
}

const db = openAgentDb(DB_PATH)
migrateLlmTables(db)
const spent = (): number =>
  Number(db.prepare('SELECT COALESCE(SUM(COALESCE(reported_cost_usd, estimated_cost_usd)),0) FROM llm_calls').pluck().get())
let stop = false

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? '' })

async function runCandidate(c: Candidate, scenes: Scene[]): Promise<Summary> {
  const model = openrouter(c.model, {
    usage: { include: true },
    extraBody: {
      models: [c.model],
      provider: { order: [c.slug], allow_fallbacks: false },
      ...(c.reasoning === undefined ? {} : { reasoning: c.reasoning }),
    },
  })
  const llm = new LlmClient({
    db,
    caller: 'turn',
    agentId: c.id,
    model,
    maxRetries: 0,
    requestTimeoutMs: TIMEOUT_MS,
    maxOutputTokens: c.maxOutputTokens,
    transport: c.transport,
    ...(c.toolChoice === undefined ? {} : { toolChoice: c.toolChoice }),
  })
  const schema = c.schema === 'strict' ? StrictTurn : TurnSchemaActionRequired
  const rows: CallRow[] = []
  let dropped = false
  for (const s of scenes) {
    if (stop) break
    const batch = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const t0 = performance.now()
        const row: CallRow = {
          scene: s.n,
          ok: false,
          valid: false,
          acted: false,
          score: 0,
          axis: null,
          verb: null,
          paramKeys: 0,
          errorKind: 'none',
          error: null,
          latencyMs: 0,
          servedProvider: null,
          costUsd: null,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          finishReason: null,
        }
        const before = Number(db.prepare('SELECT COALESCE(MAX(id),0) FROM llm_calls').pluck().get())
        try {
          const { value } = await llm.object({ system: s.prompt.system, messages: s.prompt.messages, schema })
          row.ok = true
          const live = TurnSchemaActionRequired.safeParse(c.schema === 'strict' ? fromStrict(value) : value)
          if (!live.success) {
            row.errorKind = 'decode'
            row.error = `off live schema: ${z.prettifyError(live.error).slice(0, 200)}`
          } else {
            row.valid = true
            const turn = live.data
            const a = act(turn)
            row.acted = a !== null
            row.verb = turn.action && 'freeform' in turn.action ? 'freeform' : (turn.action?.verb ?? null)
            row.paramKeys = a === null ? 0 : Object.keys(a.params).length
            row.axis = s.judge(turn)
            row.score = (row.axis.verb + row.axis.param + row.axis.speech + row.axis.ids) / 4
            if (i === 0) row.sample = { thought: turn.thought.slice(0, 200), speech: turn.speech, action: turn.action }
          }
        } catch (err) {
          Object.assign(row, classify(err))
        }
        row.latencyMs = performance.now() - t0
        return { row, before }
      }),
    )
    // Ledger rows for this candidate landed since `before`; match by agent_id, oldest first.
    const minBefore = Math.min(...batch.map((x) => x.before))
    const ledger = db
      .prepare(
        'SELECT provider, reported_cost_usd, input_tokens, output_tokens, reasoning_tokens, finish_reason, latency_ms FROM llm_calls WHERE id > ? AND agent_id = ? ORDER BY id',
      )
      .all(minBefore, c.id) as {
      provider: string | null
      reported_cost_usd: number | null
      input_tokens: number
      output_tokens: number
      reasoning_tokens: number
      finish_reason: string | null
      latency_ms: number
    }[]
    // Attribution by nearest latency is not exact under concurrency, so per-call cost is only
    // summed; the served-provider set and token totals are what the summary reads.
    batch.forEach(({ row }, i) => {
      const l = ledger[i]
      if (!l) return
      row.servedProvider = l.provider
      row.costUsd = l.reported_cost_usd
      row.inputTokens = l.input_tokens
      row.outputTokens = l.output_tokens
      row.reasoningTokens = l.reasoning_tokens
      row.finishReason = l.finish_reason
    })
    rows.push(...batch.map((x) => x.row))
    const sc = rows.filter((r) => r.scene === s.n)
    console.log(
      `[${c.id}] scene ${s.n}: valid ${sc.filter((r) => r.valid).length}/${sc.length} mean ${(
        sc.reduce((a, r) => a + r.score, 0) / sc.length
      ).toFixed(2)} 429=${sc.filter((r) => r.errorKind === '429').length} p50=${Math.round(q(sc.map((r) => r.latencyMs), 0.5))}ms spent=$${spent().toFixed(3)}`,
    )
    if (spent() > CAP_USD) {
      stop = true
      console.error(`STOP: $${spent().toFixed(4)} past the $${CAP_USD} cap`)
    }
    const done = new Set(rows.map((r) => r.scene)).size
    if (done === 2) {
      const validRate = rows.filter((r) => r.valid).length / rows.length
      const mean = rows.reduce((a, r) => a + r.score, 0) / rows.length
      if (validRate < 0.5 || mean < 0.3) {
        dropped = true
        console.log(`[${c.id}] DROPPED after 2 scenes: valid ${(validRate * 100).toFixed(0)}% mean ${mean.toFixed(2)}`)
        break
      }
    }
  }
  return summarize(c, rows, dropped)
}

function summarize(c: Candidate, rows: CallRow[], dropped: boolean): Summary {
  const answered = rows.filter((r) => r.ok)
  const scored = rows.filter((r) => r.axis !== null)
  const mean = (pick: (a: Axis) => number): number =>
    rows.length === 0 ? 0 : rows.reduce((a, r) => a + (r.axis ? pick(r.axis) : 0), 0) / rows.length
  const perScene: Summary['perScene'] = {}
  for (const n of new Set(rows.map((r) => r.scene))) {
    const sc = rows.filter((r) => r.scene === n)
    perScene[n] = { calls: sc.length, valid: sc.filter((r) => r.valid).length, mean: sc.reduce((a, r) => a + r.score, 0) / sc.length }
  }
  const verbs: Record<string, number> = {}
  for (const r of rows) if (r.verb) verbs[r.verb] = (verbs[r.verb] ?? 0) + 1
  const cost = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0)
  const billed = rows.filter((r) => (r.costUsd ?? 0) > 0).length
  const need = rows.filter((r) => ALL_SCENES.find((s) => s.n === r.scene)?.actRequired)
  return {
    id: c.id,
    model: c.model,
    provider: c.provider,
    transport: c.transport + (c.toolChoice ? `/${c.toolChoice}` : '') + (c.schema === 'strict' ? '/strict' : ''),
    quant: c.quant,
    calls: rows.length,
    scenesRun: Object.keys(perScene).length,
    dropped,
    valid: rows.filter((r) => r.valid).length,
    actRequiredCalls: need.length,
    actRequiredActed: need.filter((r) => r.acted).length,
    meanScore: rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.score, 0) / rows.length,
    meanParamKeys: scored.filter((r) => r.acted).length === 0 ? 0 : scored.filter((r) => r.acted).reduce((a, r) => a + r.paramKeys, 0) / scored.filter((r) => r.acted).length,
    axisMeans: { verb: mean((a) => a.verb), param: mean((a) => a.param), speech: mean((a) => a.speech), ids: mean((a) => a.ids) } as Summary['axisMeans'],
    perScene,
    http429: rows.filter((r) => r.errorKind === '429').length,
    timeouts: rows.filter((r) => r.errorKind === 'timeout').length,
    decodeFails: rows.filter((r) => r.errorKind === 'decode').length,
    otherErrors: rows.filter((r) => r.errorKind === 'http' || r.errorKind === 'other').length,
    p50Ms: Math.round(q(answered.map((r) => r.latencyMs), 0.5)),
    p95Ms: Math.round(q(answered.map((r) => r.latencyMs), 0.95)),
    costUsd: cost,
    costPerCallUsd: billed === 0 ? 0 : cost / billed,
    costPer1kTurnsUsd: billed === 0 ? 0 : (cost / billed) * 1000,
    servedProviders: [...new Set(rows.map((r) => r.servedProvider).filter((p): p is string => !!p))],
    errors: [...new Set(rows.map((r) => r.error).filter((e): e is string => !!e))].slice(0, 3),
    verbs,
    samples: rows.filter((r) => r.sample).map((r) => ({ scene: r.scene, sample: r.sample })),
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set (run with node --env-file=<repo>/.env)')
    process.exit(2)
  }
  const models = list('models')
  const providers = list('providers')
  const sceneNs = list('scenes').map(Number)
  const scenes = sceneNs.length === 0 ? ALL_SCENES : ALL_SCENES.filter((s) => sceneNs.includes(s.n))
  const picked = CANDIDATES.filter(
    (c) => (models.length === 0 || models.includes(c.model)) && (providers.length === 0 || providers.includes(c.slug) || providers.includes(c.id)),
  )
  console.log(`[bakeoff2] ${picked.length} candidates x ${scenes.length} scenes x ${N} calls, ${WAVES} candidates at a time, cap $${CAP_USD}`)
  for (const s of scenes) console.log(`  scene ${s.n}: ${s.name} (~${s.prompt.estTokens} tok)`)
  if (args.has('dry')) {
    for (const s of scenes) console.log(`\n=== S${s.n}\n${s.prompt.messages.map((m) => m.content).join('\n---\n')}`)
    process.exit(0)
  }
  const summaries: Summary[] = []
  const samples: Record<string, CallRow['sample'][]> = {}
  const queue = [...picked]
  await Promise.all(
    Array.from({ length: WAVES }, async () => {
      for (let c = queue.shift(); c !== undefined && !stop; c = queue.shift()) {
        const s = await runCandidate(c, scenes)
        summaries.push(s)
      }
    }),
  )
  void samples
  const total = spent()
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), n: N, totalCostUsd: total, summaries }, null, 2))
  summaries.sort((a, b) => b.meanScore - a.meanScore || b.valid / b.calls - a.valid / a.calls || a.p50Ms - b.p50Ms)
  console.log('\n| candidate | transport | quant | scenes | mean score | verb | param | speech | ids | keys/act | valid | act (where required) | 429 | timeout | decode | p50 ms | p95 ms | $/call | $/1k turns | served |')
  console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const s of summaries) {
    const pc = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`)
    console.log(
      `| ${s.id}${s.dropped ? ' (dropped)' : ''} | ${s.transport} | ${s.quant} | ${s.scenesRun} | ${s.meanScore.toFixed(2)} | ${s.axisMeans.verb.toFixed(2)} | ${s.axisMeans.param.toFixed(2)} | ${s.axisMeans.speech.toFixed(2)} | ${s.axisMeans.ids.toFixed(2)} | ${s.meanParamKeys.toFixed(2)} | ${pc(s.valid, s.calls)} | ${pc(s.actRequiredActed, s.actRequiredCalls)} | ${pc(s.http429, s.calls)} | ${s.timeouts} | ${s.decodeFails} | ${s.p50Ms} | ${s.p95Ms} | ${s.costPerCallUsd.toFixed(5)} | ${s.costPer1kTurnsUsd.toFixed(2)} | ${s.servedProviders.join(',') || '-'} |`,
    )
  }
  console.log('\nper-scene mean score (valid/calls):')
  for (const s of summaries)
    console.log(
      `  ${s.id}: ` +
        Object.entries(s.perScene)
          .map(([n, v]) => `S${n} ${v.mean.toFixed(2)} (${v.valid}/${v.calls})`)
          .join('  ') +
        `  verbs ${JSON.stringify(s.verbs)}`,
    )
  for (const s of summaries) for (const e of s.errors) console.log(`  ${s.id} err: ${e.slice(0, 300)}`)
  console.log(`\nTOTAL this run $${total.toFixed(4)} (OpenRouter-reported usage.cost; failed calls at ceiling estimate). Written to ${OUT_PATH}`)
  db.close()
}

main().catch((err: unknown) => {
  console.error('bakeoff2 crashed:', err)
  process.exit(1)
})
