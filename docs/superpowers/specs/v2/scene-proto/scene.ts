// THROWAWAY scene prototype. Nothing here is imported by the repo.
// Run: node --env-file=/home/ubuntu/workspace/SanJunipero/.env --import tsx scene.ts
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { openDb } from '/home/ubuntu/workspace/SanJunipero/packages/engine/src/db.js'
import { LlmClient, migrateLlmTables } from '/home/ubuntu/workspace/SanJunipero/packages/llm/src/index.js'
import { FOUNDER_MINDS } from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/live/founderMinds.js'
import {
  RULES_OF_BEING,
  SPEECH_RULES,
} from '/home/ubuntu/workspace/SanJunipero/packages/agents/src/prompt/rulesOfBeing.js'

const CAP_USD = Number(process.env.SJ_CAP ?? '2.40')
const OUT = process.env.SJ_OUT ?? '/tmp/scene-proto.json'
const MAX_LINES = 10

const byId = new Map(FOUNDER_MINDS.map((m) => [m.id, m]))
const mind = (id: string) => {
  const m = byId.get(id)
  if (m === undefined) throw new Error(`no mind ${id}`)
  return m
}

// Same field order as the live prompt's renderIdentity, so the voice card reaches the model
// exactly as it does in the world.
function renderIdentity(id: string): string {
  const m = mind(id).identity
  const v = m.voiceCard
  return [
    `Name: ${m.name}`,
    `Age: ${m.age}`,
    `Temperament: ${m.temperament}`,
    `Backstory: ${m.backstory}`,
    `Voice: ${v.register} — ${v.rhythm}`,
    `Tics: ${v.tics.join('; ')}`,
    `Never says: ${v.neverSays.join('; ')}`,
    `Example lines: ${v.exampleLines.join(' | ')}`,
    `You usually say about ${v.wordBudget?.typical} words at a time; when truly moved, up to ${v.wordBudget?.burst}.`,
  ].join('\n')
}

type Seed = {
  id: 'A' | 'B' | 'C'
  a: string
  b: string
  place: string
  time: string
  tension: string
  // 2-3 lines, what stands between them, as each of them holds it.
  relationship: string
  wants: Record<string, string>
}

const SEEDS: Seed[] = [
  {
    id: 'A',
    a: 'nadia',
    b: 'omar',
    place: 'the half-finished store, its south wall still open to the wind',
    time: 'mid-morning, third day of rain holding off',
    tension: 'Omar promised Nadia planks two days ago and has not brought them.',
    relationship: [
      'Nadia asked Omar for six planks on the day of the landslide and he said yes without looking up.',
      'Omar has been sitting with a sick child since and thinks anyone would understand that.',
      'Nadia has told two other people the planks are coming, which is the part that stings.',
    ].join('\n'),
    wants: {
      nadia: 'You want the planks today, and you want him to say a day out loud, not "soon".',
      omar: 'You want her to ask how the child is before she asks about wood.',
    },
  },
  {
    id: 'B',
    a: 'salma',
    b: 'yusuf',
    place: 'the fire outside the unfinished house, wood popping',
    time: 'dusk, the first cold evening',
    tension: 'Salma is sure Yusuf is sweet on Amara and has decided to find out.',
    relationship: [
      'Yusuf cut and carried the beams for Salma’s house and would not take anything for it.',
      'Salma has watched Yusuf go quiet twice this week, both times when Amara walked past.',
      'Neither of them has ever said a soft thing out loud to the other, and both know it.',
    ].join('\n'),
    wants: {
      salma: 'You want him to admit it, and you would rather die than ask straight out.',
      yusuf: 'You want the subject changed, and you want to stay by the fire anyway.',
    },
  },
  {
    id: 'C',
    a: 'amara',
    b: 'salma',
    place: 'the well, its rope hanging slack over a shallow bucket',
    time: 'first light, everyone else still asleep',
    tension: 'The well ran dry overnight and Amara wants a rule about who draws first.',
    relationship: [
      'Amara put the well where the well is and takes what happens to it personally.',
      'Salma fetches her own water at odd hours and does not want to be on anybody’s list.',
      'Amara has counted the buckets and knows who is drawing more than they carry back.',
    ].join('\n'),
    wants: {
      amara: 'You want an order agreed this morning, and you want Salma to agree to it first.',
      salma: 'You want to owe nobody a turn, and you do not want to say that outright.',
    },
  },
]

const TurnSchema = z.object({
  line: z.string(),
  aside: z.string(),
  move: z.enum(['continue', 'leave', 'escalate']),
})
const StatusTurnSchema = z.object({
  line: z.string(),
  aside: z.string(),
  status: z.enum(['press', 'give way', 'deflect', 'tease']),
  move: z.enum(['continue', 'leave', 'escalate']),
})
const DirectorSchema = z.object({
  stakes: z.string(),
  wantA: z.string(),
  wantB: z.string(),
  endingBeat: z.string(),
  caption: z.string(),
})

type Line = {
  speaker: string
  line: string
  aside: string
  status?: string
  move: string
}

type Register = 'plain' | 'wants' | 'director' | 'invention'

const EXIT_RULE: Record<Register, string> = {
  plain: 'Leave when you have nothing more worth saying. Otherwise stay and answer.',
  wants: 'The scene ends when one of you has won the point, or when it boils over. Leave then, not before.',
  director: 'Leave when you have nothing more worth saying. Otherwise stay and answer.',
  invention:
    'The scene ends once the two of you have settled what the thing is and what it is called. Leave then.',
}

// Register 4: the first mouth must put something new into the world, and the second must handle
// it rather than agree with it. Neither is told an arbiter is listening.
const INVENTION_OPENER = `Nobody has done this before and there is no rule for it yet. Put something NEW into the world:
a custom, a rule, a device, a game, a name for a place, a way of settling something. Say it as if you had
just thought of it. Give it a name if it wants one. Do not ask permission.`
const INVENTION_ANSWER = `What was just said is new. It is not law until someone agrees to it. Take it apart,
bend it to what you want, or name what it costs you. Do not simply agree.`

const ARBITER_SYSTEM = `You are the settling voice of a valley: the memory that decides what a town keeps.
Two people have just made something up between them. You did not hear their reasons, only their words.
Rule on it. Uphold it as they said it, refuse it, or amend it into the smallest version that could hold.
Write the law as one plain sentence a person could repeat from memory, in their own words, never yours.
Give it the name they gave it if they gave it one, or a short one they would recognise.
Also write one caption for whoever is watching from outside: plain, one line, no adjectives piled up.`

const ArbiterSchema = z.object({
  ruling: z.enum(['upheld', 'refused', 'amended']),
  name: z.string(),
  law: z.string(),
  why: z.string(),
  caption: z.string(),
})

function systemFor(id: string, register: Register): string {
  const head = [RULES_OF_BEING, renderIdentity(id), SPEECH_RULES]
  if (register === 'wants') {
    head.push(
      [
        'Every exchange has a shape under the words. On your turn you take one of four:',
        'press (you push your want at them), give way (you let them have it, for now),',
        'deflect (you send the talk sideways rather than answer), tease (you needle them, lightly or not).',
        'Name which one you took. Your aside is what you felt, not what you plan.',
      ].join('\n'),
    )
  }
  return head.join('\n\n---\n\n')
}

function userFor(opts: {
  seed: Seed
  register: Register
  speaker: string
  other: string
  want: string
  tension: string
  recent: Line[]
  escalated: boolean
}): string {
  const { seed, register, speaker, other, want, tension, recent, escalated } = opts
  const otherName = mind(other).identity.name
  const parts = [
    `Where you are: ${seed.place}.`,
    `When: ${seed.time}.`,
    `${otherName} is standing with you. Nobody else is near.`,
    `What stands between you:\n${seed.relationship}`,
    `What is in the air right now: ${tension}`,
    `What you want out of this, and have not said: ${want}`,
  ]
  if (recent.length === 0) {
    parts.push('Nothing has been said yet. You speak first.')
  } else {
    parts.push(
      `The last words, oldest first:\n${recent
        .slice(-6)
        .map((l) => `${mind(l.speaker).identity.name}: ${l.line}`)
        .join('\n')}`,
    )
  }
  if (escalated) parts.push('That last one landed hard.')
  if (register === 'invention') parts.push(recent.length === 0 ? INVENTION_OPENER : INVENTION_ANSWER)
  parts.push(EXIT_RULE[register])
  parts.push(
    register === 'wants'
      ? 'Answer with: line (what you say aloud, out of your own mouth), aside (what you feel, eight words or fewer), status (press, give way, deflect or tease), move (continue, leave or escalate).'
      : 'Answer with: line (what you say aloud, out of your own mouth), aside (what passes through your mind, eight words or fewer), move (continue if the talk goes on, leave if you are done and walk away, escalate if you just raised it).',
  )
  return parts.join('\n\n')
}

const DIRECTOR_SYSTEM = `You set scenes for a village story. You never write dialogue and you never speak for anyone.
You are given two people, a place, a time and a knot between them. You decide what is actually at stake
this morning, what each of them privately wants out of the next five minutes, and one beat the scene should
land on before it ends. You also write one line of caption for whoever is watching from outside: plain, cold,
no adjectives piled up, the kind of line under a photograph.
Keep every field to one sentence. The two people never see any of this.`

function directorUser(seed: Seed): string {
  return [
    `The two: ${mind(seed.a).identity.name} (${mind(seed.a).identity.temperament}) and ${mind(seed.b).identity.name} (${mind(seed.b).identity.temperament}).`,
    `Where: ${seed.place}. When: ${seed.time}.`,
    `The knot:\n${seed.relationship}`,
    `In the air: ${seed.tension}`,
    'Give: stakes, wantA (for the first named), wantB (for the second), endingBeat, caption.',
  ].join('\n\n')
}

// --- model wiring ------------------------------------------------------------
const db = openDb(':memory:')
migrateLlmTables(db)

type Route = { label: string; client: LlmClient }

const glm: Route = { label: 'glm-5.3-flash (Wafer/DeepInfra)', client: new LlmClient({ db, caller: 'turn', budgetUsd: CAP_USD }) }

function viaOpenRouter(label: string, modelId: string, order: string[]): Route {
  const key = process.env.OPENROUTER_API_KEY
  const openrouter = createOpenRouter(key === undefined ? {} : { apiKey: key })
  const model = openrouter(modelId, {
    usage: { include: true },
    extraBody: { provider: { order, allow_fallbacks: true } },
  })
  return {
    label,
    client: new LlmClient({ db, caller: 'turn', budgetUsd: CAP_USD, model, maxOutputTokens: 900 }),
  }
}

let spent = 0

async function askTurn<T>(
  route: Route,
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const r = await route.client.object({ system, messages: [{ role: 'user', content: user }], schema })
    spent += r.usage.costUsd
    return r.value
  } catch {
    // json_schema is not universal; the same ask as plain JSON.
    const r = await route.client.text({
      system: `${system}\n\nAnswer with one JSON object and nothing else.`,
      messages: [{ role: 'user', content: user }],
    })
    spent += r.usage.costUsd
    const m = /\{[\s\S]*\}/.exec(r.text)
    if (m === null) throw new Error(`no json in: ${r.text.slice(0, 200)}`)
    return schema.parse(JSON.parse(m[0]))
  }
}

// --- the loop ----------------------------------------------------------------
type Scene = {
  seed: string
  register: Register
  model: string
  caption?: string
  stakes?: string
  endingBeat?: string
  lines: Line[]
  ms: number
  costUsd: number
  exit: string
  ruling?: z.infer<typeof ArbiterSchema>
}

async function runScene(seed: Seed, register: Register, route: Route): Promise<Scene> {
  const started = Date.now()
  const before = spent
  let tension = seed.tension
  let wants = { ...seed.wants }
  let caption: string | undefined
  let stakes: string | undefined
  let endingBeat: string | undefined

  if (register === 'director') {
    const d = await askTurn(route, DIRECTOR_SYSTEM, directorUser(seed), DirectorSchema)
    stakes = d.stakes
    endingBeat = d.endingBeat
    caption = d.caption
    tension = d.stakes
    wants = { [seed.a]: d.wantA, [seed.b]: d.wantB }
  }

  const lines: Line[] = []
  let exit = 'ran out of lines'
  let escalated = false
  const cap = register === 'invention' ? 6 : MAX_LINES
  for (let i = 0; i < cap; i++) {
    const speaker = i % 2 === 0 ? seed.a : seed.b
    const other = i % 2 === 0 ? seed.b : seed.a
    const system = systemFor(speaker, register)
    const user = userFor({
      seed,
      register,
      speaker,
      other,
      want: wants[speaker] ?? '',
      tension,
      recent: lines,
      escalated,
    })
    const schema = register === 'wants' ? StatusTurnSchema : TurnSchema
    const t = (await askTurn(route, system, user, schema)) as z.infer<typeof StatusTurnSchema>
    lines.push({
      speaker,
      line: t.line.trim(),
      aside: t.aside.trim(),
      ...(t.status === undefined ? {} : { status: t.status }),
      move: t.move,
    })
    escalated = t.move === 'escalate'
    if (t.move === 'leave') {
      exit = `${mind(speaker).identity.name} walked`
      break
    }
  }
  let ruling: z.infer<typeof ArbiterSchema> | undefined
  if (register === 'invention') {
    ruling = await askTurn(
      route,
      ARBITER_SYSTEM,
      [
        `At ${seed.place}, ${seed.time}.`,
        `What was said:\n${lines.map((l) => `${mind(l.speaker).identity.name}: ${l.line}`).join('\n')}`,
        'Give: ruling, name, law, why, caption.',
      ].join('\n\n'),
      ArbiterSchema,
    )
    caption = ruling.caption
  }
  return {
    seed: seed.id,
    register,
    model: route.label,
    ...(caption === undefined ? {} : { caption }),
    ...(stakes === undefined ? {} : { stakes }),
    ...(endingBeat === undefined ? {} : { endingBeat }),
    lines,
    ms: Date.now() - started,
    costUsd: spent - before,
    exit,
    ...(ruling === undefined ? {} : { ruling }),
  }
}

const scenes: Scene[] = []
const registers: Register[] = (process.env.SJ_REGISTERS ?? 'plain,wants,director,invention').split(
  ',',
) as Register[]

const only = process.env.SJ_ONLY
const strongOnly = process.env.SJ_STRONG

async function main(): Promise<void> {
  if (strongOnly === undefined) {
    for (const register of registers) {
      for (const seed of SEEDS) {
        if (only !== undefined && only !== `${register}:${seed.id}`) continue
        const s = await runScene(seed, register, glm)
        scenes.push(s)
        console.log(`${register}/${seed.id} ${s.lines.length} lines ${(s.ms / 1000).toFixed(1)}s $${s.costUsd.toFixed(5)} — ${s.exit}`)
      }
    }
  } else {
    const [modelId, order, seedId, register] = strongOnly.split('|')
    const route = viaOpenRouter(modelId!, modelId!, (order ?? '').split(',').filter(Boolean))
    const seed = SEEDS.find((s) => s.id === seedId)!
    const s = await runScene(seed, register as Register, route)
    scenes.push(s)
    console.log(`${register}/${seed.id} ${modelId} ${s.lines.length} lines ${(s.ms / 1000).toFixed(1)}s $${s.costUsd.toFixed(5)} — ${s.exit}`)
  }
  writeFileSync(OUT, JSON.stringify({ scenes, totalCostUsd: spent }, null, 2))
  console.log(`total $${spent.toFixed(5)} -> ${OUT}`)
}

await main()
