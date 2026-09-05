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
  /** What the town has agreed and holds each other to. One more block of the shared prefix, so
   *  a rule reaches a scene line and an ordinary turn as the same bytes. */
  laws?: () => readonly string[]
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
const DEFAULT_SCENE_WORDS = 28

/** A scene line may run to the persona's burst: a cap at the typical length made every line an
 *  epigram. The typical length is said to the mind as guidance, the burst is the ceiling. */
export function sceneWordCap(voice: IdentityCore['voiceCard']): number {
  return voice.wordBudget?.burst ?? DEFAULT_SCENE_WORDS
}
export function sceneWordUsual(voice: IdentityCore['voiceCard']): number {
  return voice.wordBudget?.typical ?? Math.round(DEFAULT_SCENE_WORDS / 2)
}

// CAPABILITIES tells every prompt to name an act. A scene line is not an act, and this is the
// one place that has to say so.
export const SCENE_ANSWER = `Your turn to talk. Your hands are not doing anything right now, so this is not an act.

Leave speech empty when you have nothing to add, and the conversation ends there. Set leave to true if you walk off. Put the name of the person you are talking to in "to", picked from the people named at the end of this, or leave it empty to talk to whoever is listening.

move says what this line is doing. tell: bring up something new, like news, a plan, or a thing you noticed. ask: a real question you want the answer to. joke: make light of it, even if the moment is not light. agree: you are with them. shift: change the subject. press: push your point. give_way: let them have it. deflect: dodge. tease: needle them. none: plain talk.

To ask the person you are talking to for something, put court, propose or lie_with in "ask"; otherwise leave it empty. If you were asked such a thing, put accept or refuse in "answer".

thought is one short line nobody else hears.`

const CLOSE_REASON_PHRASE: Record<NonNullable<Scene['closeReason']>, string> = {
  ended: 'It ended because they had said what they had to say.',
  left: 'It ended because somebody walked away.',
  capped: 'It ended while it was still going. There was more to say.',
  timeout: 'It ended because nobody said anything more.',
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
  'Sleep can wait. Stay while the conversation is worth it, and leave when it is not.'

// The town's own words for a body running down, from the ordinary turn's ladder.
const TIREDNESS: readonly [number, string][] = [
  [30, 'Your eyes keep closing.'],
  [45, 'You are worn out.'],
]

/** The hour, in the register somebody outdoors would tell it. Only after dark, and only through
 *  the one phase derivation the codebase has. */
function hourSaid(tick: number): string {
  if (dayPhaseFromTick(tick) !== 'night') return ''
  const { hour } = simTimeFromTick(tick)
  if (hour >= 21) return 'It is late and the town has gone quiet.'
  return hour < 3 ? 'It is past midnight.' : 'It is nearly morning.'
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
function renderInvitation(
  invitation: Scene['invitation'],
  agentId: string,
  nameOf: (id: string) => string,
): string {
  if (invitation?.to !== agentId) return ''
  return askPhrase(invitation.verb, nameOf(invitation.from))
}

/** The one thing a talk with a face nobody here has seen before has to settle: who they are.
 *  Said to both sides — the walker is asked for their own account, and the town for its own. */
function renderTelling(scene: Scene, agentId: string, nameOf: (id: string) => string): string {
  const stranger = scene.stranger
  if (stranger === undefined) return ''
  if (stranger === agentId) {
    return (
      'Nobody here knows you yet. They will want to know where you came from and what you' +
      ' can do. Whatever you tell them now is what they will remember.'
    )
  }
  return (
    `${nameOf(stranger)} just came up the valley road and nobody here knows them. Ask what` +
    ' you want to know, and tell them what they should know about this place.'
  )
}

/** The one thing a talk that has turned into a vote has to settle, said to whoever has to
 *  settle it. The word for such a gathering is ours and not theirs, so it is never said: what
 *  the mind is told is that somebody put a rule to the room and everyone answers it. */
function renderProposal(scene: Scene, agentId: string, nameOf: (id: string) => string): string {
  const proposal = scene.proposal
  if (scene.kind !== 'council' || proposal === undefined) return ''
  if (proposal.proposedBy === agentId) {
    return (
      `You have proposed a rule to everyone here: "${proposal.lawText}" Hear them out. ` +
      'It passes if more are for it than against, and it means nothing if nobody answers.'
    )
  }
  return (
    `${nameOf(proposal.proposedBy)} has proposed a rule to everyone here: "${proposal.lawText}" ` +
    'Say where you stand in "stance": for, against, or unsure. The talk ends when ' +
    'everybody has answered.'
  )
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
  usual: number
}): string {
  // Name one mind rather than say "somebody": whoever has not spoken yet, else the only other.
  const them = opts.silent[0] ?? (opts.others.length === 1 ? opts.others[0]! : 'them')
  const spoke =
    opts.lastSpeaker === null || opts.lastSpeaker === them
      ? `${them} just spoke.`
      : `${opts.lastSpeaker} just spoke.`
  const ask = opts.wrapUp
    ? 'This has gone on a while. Say your last thing and let it end.'
    : `Say what you would actually say next, or say nothing and let it end. You do not have to answer what ${them} said; you can ask something, bring up your own thing, or change the subject.`
  return [
    opts.others.length === 0 ? '' : `Standing with you: ${opts.others.join(', ')}.`,
    opts.silent.length === 0 ? '' : `Not a word yet from ${opts.silent.join(', ')}.`,
    opts.audience.length === 0
      ? ''
      : `Within earshot and not in the talk: ${opts.audience.join(', ')}.`,
    `It is your turn. ${spoke} ${ask}`,
    `About ${opts.usual} words is normal for you; ${opts.words} at the very most. Do not repeat ${them}'s words back, and do not end on a comeback unless that is how you talk.`,
  ]
    .filter((p) => p.length > 0)
    .join('\n')
}

/** The one volatile block a scene turn sends, stable parts first so the cached prefix reaches
 *  as far into it as the provider will take it. The thread only ever grows at its end, so the
 *  roster is the one thing that must stand below it. */
/** The mind's own last lines, so a phrase it liked does not become its catchphrase. */
function renderRecent(recent: readonly string[]): string {
  if (recent.length === 0) return ''
  return [
    'Things you said lately. Do not say them again, and do not reuse their phrasing:',
    ...recent.map((l) => `- "${sanitizeSpokenText(l)}"`),
  ].join('\n')
}

export function sceneBlock(
  ask: SceneAsk,
  voice: Pick<SceneVoice, 'livingCast' | 'want'> & { words: number; usual: number },
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
    renderRecent(ask.recent),
    renderLateness(ask.tick, ask.energy),
    renderInvitation(ask.scene.invitation, ask.agentId, nameOf),
    renderTelling(ask.scene, ask.agentId, nameOf),
    renderProposal(ask.scene, ask.agentId, nameOf),
    renderFloor({
      lastSpeaker: spoken.length === 0 ? null : nameOf(spoken[spoken.length - 1]!.agentId),
      others: rest.map((p) => p.name),
      silent: rest.filter((p) => !heard.has(p.id)).map((p) => p.name),
      audience: ask.audience.map((p) => p.name),
      wrapUp: ask.wrapUp,
      words: voice.words,
      usual: voice.usual,
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
    ...(voice.laws === undefined ? {} : { laws: voice.laws() }),
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

const CLOSE_SYSTEM = `A conversation in the valley of San Junipero has just ended. Write down what happened in it, and what it left between the people who were in it.

The summary is two sentences at most, plain, naming people by name. It is what each of them will remember, so write what was said and what changed because of it, and nothing about how it reads.

Then the ties. A tie is one thing one person now holds about another: a promise, a debt, a slight, a grudge, an attraction, a secret, an alliance, or being family. Write one only where the talk itself made it or paid it off. Most conversations make none, and an invented tie is worse than a missing one. Mark a tie settled when the talk cleared something that was already owed.

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
  const usual = sceneWordUsual(voice.identity.voiceCard)
  return {
    async line(ask) {
      const system = sceneSystem(voice)
      const block = sceneBlock(ask, { ...voice, words, usual })
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
