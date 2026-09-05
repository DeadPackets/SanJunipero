// The two prompts a scene makes: one line by the mouth that holds the floor, and one closing
// account of the whole thing. The system prefix is the ordinary turn's, byte for byte, so a
// scene line lands on the cache the mind's own turns keep warm.
import { z } from 'zod'
import { dayPhaseFromTick, sanitizeSpokenText, simTimeFromTick, type RosterEntry } from '@sj/shared'
import type { CallBill, LlmClient } from '@sj/llm'
import type { PersonalityDoc } from '../personality.js'
import { assemblePrompt, type IdentityCore } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { TIE_PHRASE, type Tie } from '../memory/ties.js'
import { askPhrase } from './invitations.js'
import {
  SceneTurnSchema,
  TIE_KINDS,
  type Scene,
  type SceneAsk,
  type SceneClose,
  type SceneCloseAsk,
  type SceneLine,
  type SceneLlm,
  type TieDelta,
} from './scene.js'

/** What one mind is, for the length of a scene. Read through functions because sleep rewrites
 *  the personality and a birth or a death rewrites the cast. */
export type SceneVoice = {
  identity: IdentityCore
  personality: () => { doc: PersonalityDoc; autobiography: string[] }
  roster?: () => readonly RosterEntry[]
  /** The town's own names for its habits, from the same seam the ordinary turn reads. */
  customs?: () => readonly string[]
  /** What stands at the edge of the known valley. One more block of the shared prefix: without
   *  it the scene line and the ordinary turn stop being the same bytes at customs. */
  frontier?: () => readonly string[]
  /** Everyone alive in the valley. A closed roll: the mind may name nobody else. */
  livingCast: () => readonly { id: string; name: string }[]
  /** The mind's strongest want, in its own words. Nothing at all until wants exist. */
  want?: () => string | null
}

// How far back a mind reads before answering. Six lines is three exchanges for a pair: long
// enough to see the shape of the talk, short enough that the last thing said is still the
// loudest. At twelve it is half a round, which reads as people talking past each other.
const THREAD_LINES_SHOWN = 6
/** Twelve is where the window stops earning its tokens: past it the block outgrows the system
 *  prompt the cache is keeping warm, and the last thing said stops being the loudest. */
const THREAD_LINES_MAX = 12

/** A whole round of talk, floored at the pair's six lines and capped at twelve — the shape
 *  `lineCapFor` has, over the same cast. */
export function threadLinesFor(talkers: number): number {
  return Math.min(THREAD_LINES_MAX, Math.max(THREAD_LINES_SHOWN, talkers))
}

// v1 measured: the median spoken line was 92 characters, which is 16 words. A persona carrying
// no card of its own speaks at the town's median.
const DEFAULT_SCENE_WORDS = 16

/** A scene line is capped at the persona's TYPICAL length, never its burst. The floor is handed
 *  on after every line, so nobody in a scene holds it long enough to earn a burst. */
export function sceneWordCap(voice: IdentityCore['voiceCard']): number {
  return voice.wordBudget?.typical ?? DEFAULT_SCENE_WORDS
}

// CAPABILITIES tells every prompt to name an act. A scene line is not an act, and this is the
// one place that has to say so.
export const SCENE_ANSWER = `This moment is not an act; it is your turn to speak, and your hands can wait.

Leave your speech empty when you have nothing left to add, and the talk ends there. Say that you leave when you walk off mid-word. Put in "to" the one name you are speaking to, out of the people named at the end of this, and leave it empty to speak to whoever is listening. Name your move: press to push your point, give_way to let them have it, deflect to turn it aside, tease to needle them, none for plain talk. Your thought is the one line nobody else hears, and a breath of it is enough.

To ask the one you speak to, put court, propose or lie_with in "ask"; else leave it empty. Asked such a thing yourself, put accept or refuse in "answer".`

const CLOSE_REASON_PHRASE: Record<NonNullable<Scene['closeReason']>, string> = {
  ended: 'It ended because they had said what there was to say.',
  left: 'It ended because somebody walked away.',
  capped: 'It ended still running, with more in it than either of them said.',
  timeout: 'It ended in a silence neither of them filled.',
}

function castLaw(living: readonly { name: string }[]): string {
  if (living.length === 0) return ''
  return (
    `Everyone alive in the valley: ${living.map((p) => p.name).join(', ')}. There is nobody ` +
    'else. A name that is not among those has never lived here, and to say one aloud is to ' +
    'invent a neighbour.'
  )
}

function renderTies(ties: readonly Tie[], nameOf: (id: string) => string): string {
  if (ties.length === 0) return ''
  const rows = ties.map((t) => `${nameOf(t.personId)}, ${TIE_PHRASE[t.kind]}: ${t.text}`)
  return ['What already stands between you:', ...rows].join('\n')
}

function renderThread(
  thread: readonly SceneLine[],
  nameOf: (id: string) => string,
  selfId: string,
  lines: number,
): string {
  const shown = thread.slice(-lines)
  if (shown.length === 0) return ''
  const rows = shown.flatMap((l) => {
    const who = l.agentId === selfId ? 'You' : nameOf(l.agentId)
    if (l.presence !== undefined) {
      const verb = l.presence === 'joined' ? 'join' : 'leave'
      return [l.agentId === selfId ? `You ${verb}.` : `${who} ${verb}s.`]
    }
    const said = `${who}: "${sanitizeSpokenText(l.text)}"`
    return l.aside.length === 0 ? [said] : [said, `  (you were thinking: ${l.aside})`]
  })
  return ['What has been said, oldest first:', ...rows].join('\n')
}

// Both doors, said in one breath. Nothing here sends a mind to bed: the last one to leave a
// room is a person, and the mind already has `leave` for the other answer.
const SLEEP_WILL_KEEP =
  'Sleep will keep. Stay while the talk is worth it, and say that you leave when it is not.'

// The town's own words for a body running down, from the ordinary turn's ladder.
const TIREDNESS: readonly [number, string][] = [
  [30, 'Your eyes keep closing.'],
  [45, 'Weariness drags at your limbs.'],
]

/** The hour, in the register somebody outdoors would tell it. Only after dark, and only through
 *  the one phase derivation the codebase has. */
function hourSaid(tick: number): string {
  if (dayPhaseFromTick(tick) !== 'night') return ''
  const { hour } = simTimeFromTick(tick)
  if (hour >= 21) return 'It is late, and the town has gone quiet around you.'
  return hour < 3 ? 'It is past midnight.' : 'The night is nearly out.'
}

/** What a person knows at midnight without being told: the hour and their own weariness. The
 *  hour no longer ends a talk, so it is said to the mind instead and the mind answers it.
 *  Empty in daylight on a body with something left in it, which is most lines. */
function renderLateness(tick: number, energy: number): string {
  const parts = [hourSaid(tick), TIREDNESS.find(([at]) => energy < at)?.[1] ?? ''].filter(
    (p) => p.length > 0,
  )
  return parts.length === 0 ? '' : `${parts.join(' ')} ${SLEEP_WILL_KEEP}`
}

/** The one thing this line has to settle, said to the one who has to settle it. Empty for the
 *  asker and for everybody else, so an ordinary talk pays nothing for it. */
export function renderInvitation(
  invitation: Scene['invitation'],
  agentId: string,
  nameOf: (id: string) => string,
): string {
  if (invitation === undefined || invitation.to !== agentId) return ''
  return askPhrase(invitation.verb, nameOf(invitation.from))
}

/** Who is here and whose turn it is, in one block AFTER the thread. It sits last because it is
 *  the one part a join or a leave rewrites, and every byte above it stays cached. */
function renderFloor(opts: {
  lastSpeaker: string | null
  others: readonly string[]
  silent: readonly string[]
  audience: readonly string[]
  wrapUp: boolean
  words: number
}): string {
  // Name one mind rather than say "somebody": whoever has not spoken yet, else the only other.
  const them = opts.silent[0] ?? (opts.others.length === 1 ? opts.others[0]! : 'them')
  const spoke =
    opts.lastSpeaker === null || opts.lastSpeaker === them
      ? `${them} just spoke.`
      : `${opts.lastSpeaker} just spoke.`
  const ask = opts.wrapUp
    ? 'This has run on. Say the last thing you have to say, and let it end.'
    : `Answer ${them}, or say nothing at all and let the talk end.`
  return [
    opts.others.length === 0 ? '' : `Standing with you: ${opts.others.join(', ')}.`,
    opts.silent.length === 0 ? '' : `Not a word yet from ${opts.silent.join(', ')}.`,
    opts.audience.length === 0
      ? ''
      : `Within earshot and not in the talk: ${opts.audience.join(', ')}.`,
    `It is your turn. ${spoke} ${ask}`,
    `No more than ${opts.words} words. One breath, then stop, and leave ${them} something to answer.`,
  ]
    .filter((p) => p.length > 0)
    .join('\n')
}

/** The one volatile block a scene turn sends, stable parts first so the cached prefix reaches
 *  as far into it as the provider will take it. The thread only ever grows at its end, so the
 *  roster is the one thing that must stand below it. */
export function sceneBlock(
  ask: SceneAsk,
  voice: Pick<SceneVoice, 'livingCast' | 'want'> & { words: number },
): string {
  const names = new Map<string, string>()
  for (const p of voice.livingCast()) names.set(p.id, p.name)
  for (const p of [...ask.cast, ...ask.audience]) names.set(p.id, p.name)
  const nameOf = (id: string): string => names.get(id) ?? id
  const spoken = ask.thread.filter((l) => l.presence === undefined)
  const heard = new Set(spoken.map((l) => l.agentId))
  const rest = ask.cast.filter((p) => p.id !== ask.agentId)
  const want = voice.want?.() ?? null
  const parts = [
    SCENE_ANSWER,
    castLaw(voice.livingCast()),
    renderTies(ask.ties, nameOf),
    want === null || want.length === 0 ? '' : `What you want most: ${want}`,
    renderThread(ask.thread, nameOf, ask.agentId, threadLinesFor(ask.cast.length)),
    renderLateness(ask.tick, ask.energy),
    renderInvitation(ask.scene.invitation, ask.agentId, nameOf),
    renderFloor({
      lastSpeaker: spoken.length === 0 ? null : nameOf(spoken[spoken.length - 1]!.agentId),
      others: rest.map((p) => p.name),
      silent: rest.filter((p) => !heard.has(p.id)).map((p) => p.name),
      audience: ask.audience.map((p) => p.name),
      wrapUp: ask.wrapUp,
      words: voice.words,
    }),
  ]
  return parts.filter((p) => p.length > 0).join('\n\n')
}

// The mind's own system prompt with every volatile block emptied: the same bytes its ordinary
// turns send, so both callers share one warm prefix on the same back end.
function sceneSystem(voice: SceneVoice): string {
  return assemblePrompt({
    rulesOfBeing: RULES_OF_BEING,
    ...(voice.roster === undefined ? {} : { roster: voice.roster() }),
    ...(voice.customs === undefined ? {} : { customs: voice.customs() }),
    ...(voice.frontier === undefined ? {} : { frontier: voice.frontier() }),
    identity: voice.identity,
    personality: voice.personality(),
    journal: [],
    scene: { ledgers: [], memories: [] },
    dayLog: [],
    recalled: null,
    now: { prose: '' },
    underway: null,
  }).system
}

const CLOSE_SYSTEM = `A conversation in the valley of San Junipero has just ended. Set down what happened in it, and what it left standing between the people who were in it.

The summary is two sentences at most, plain, naming people by name. It is what each of them will carry away, so write what was said and what changed by it, and nothing about how it reads.

Then the ties. A tie is one thing one person now holds about another: a promise made, a debt owed, a slight taken, a grudge kept, an attraction felt, a secret held, an alliance struck, kin claimed. Write one only where the talk itself made it or paid it off. Most conversations make none, and an invented tie is worse than a missing one. Mark a tie settled when the talk squared something that was already owed.

Name nobody who was not in the conversation.`

const CloseAnswerSchema = z
  .object({
    summary: z.string(),
    ties: z.array(
      z
        .object({
          holder: z.string(),
          about: z.string(),
          kind: z.enum(TIE_KINDS),
          text: z.string(),
          settled: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()

// A close that named eight ties named them for a scene that made one. The cap is the scene's
// own line count, past which the answer is padding rather than a reading.
const MAX_TIES = 6

function closeMessage(ask: SceneCloseAsk): string {
  const names = new Map(ask.cast.map((p) => [p.id, p.name]))
  const nameOf = (id: string): string => names.get(id) ?? id
  const rows = ask.scene.thread.flatMap((l) => {
    const said = `${nameOf(l.agentId)}: "${sanitizeSpokenText(l.text)}"`
    return l.aside.length === 0
      ? [said]
      : [said, `  (${nameOf(l.agentId)} was thinking: ${l.aside})`]
  })
  const reason = ask.scene.closeReason
  return [
    `Who was there: ${ask.cast.map((p) => p.name).join(', ')}.`,
    rows.join('\n'),
    reason === undefined ? '' : CLOSE_REASON_PHRASE[reason],
  ]
    .filter((p) => p.length > 0)
    .join('\n\n')
}

/** Names back to ids, dropping anyone who was not there. A tie written about a person the scene
 *  never held is the one delta that could reach the database as an invented neighbour. */
function deltasFrom(
  answer: z.infer<typeof CloseAnswerSchema>,
  cast: readonly { id: string; name: string }[],
): TieDelta[] {
  const idOf = new Map<string, string>()
  for (const p of cast) {
    idOf.set(p.name.toLowerCase(), p.id)
    idOf.set(p.id.toLowerCase(), p.id)
  }
  const out: TieDelta[] = []
  for (const t of answer.ties.slice(0, MAX_TIES)) {
    const agentId = idOf.get(t.holder.trim().toLowerCase())
    const personId = idOf.get(t.about.trim().toLowerCase())
    if (agentId === undefined || personId === undefined || agentId === personId) continue
    if (t.text.trim().length === 0) continue
    out.push({
      agentId,
      personId,
      kind: t.kind,
      text: t.text.trim(),
      ...(t.settled ? { settled: true as const } : {}),
    })
  }
  return out
}

const estTokens = (text: string): number => Math.ceil(text.length / 4)

/** The mind's voice in a scene: one call per line by whoever holds the floor, and one call for
 *  the whole scene at the end. Neither catches its own throw — the coordinator already does. */
export function makeSceneLlm(client: LlmClient, voice: SceneVoice): SceneLlm {
  const closeClient = client.forCaller('scene.close')
  const words = sceneWordCap(voice.identity.voiceCard)
  return {
    async line(ask) {
      const system = sceneSystem(voice)
      const block = sceneBlock(ask, { ...voice, words })
      const bill: CallBill = {
        wakeReason: 'floor',
        blockTokens: { system: estTokens(system), scene: estTokens(block) },
      }
      const { value } = await client.object({
        system,
        messages: [{ role: 'user', content: block }],
        schema: SceneTurnSchema,
        bill,
      })
      return value
    },
    async close(ask): Promise<SceneClose> {
      const message = closeMessage(ask)
      const { value } = await closeClient.object({
        system: CLOSE_SYSTEM,
        messages: [{ role: 'user', content: message }],
        schema: CloseAnswerSchema,
        bill: { blockTokens: { scene: estTokens(message) } },
      })
      return { summary: value.summary.trim(), deltas: deltasFrom(value, ask.cast) }
    },
  }
}
