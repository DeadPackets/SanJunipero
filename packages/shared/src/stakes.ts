import { TICK_REAL_MS } from './time.js'
import type { SceneKind } from './protocol.js'

// What the camera is for. Scored for catastrophe alone a healthy town came out flat, so the
// table weighs what the town DECIDES and SAYS and leaves the weather and the harvest at zero.

/** Every reason the director can give for a shot. The keys are ours; `WHY_PHRASE` is the whole
 *  of what any of them is allowed to say out loud. */
export const STAKE_TERMS = [
  'talk',
  'quarrel',
  'council',
  'gathering',
  'telling',
  'invitation',
  'lexicon',
  'give_way',
  'slight',
  'promise_broken',
  'attraction',
  'partnership_strained',
  'agent_died',
  'agent_born',
  'agent_arrived',
  'agent_departed',
  'partnership_formed',
  'partnership_dissolved',
  'law_ratified',
  'law_broken',
  'law_repealed',
  'discovery_made',
  'co_slept_first',
  'invitation_refused_seen',
] as const
export type StakeTerm = (typeof STAKE_TERMS)[number]

/** The coordinator's 0-10, doubled. A scene is the one thing on the board that a camera can
 *  point at for minutes rather than for an instant, so it starts level with a birth. */
export const SCENE_STAKES_X = 2

/** What the runtime writes on a scene the moment it learns what kind of scene it is. Read by
 *  the coordinator for `Scene.stakes` and by the gateway for the base of its own score. */
export const STAKES_BY_KIND: Record<SceneKind, number> = {
  talk: 5,
  gathering: 6,
  telling: 6,
  quarrel: 7,
  council: 8,
  invitation: 8,
}

/** A rule being put to the room, on top of the stakes it already carries. */
export const COUNCIL_IN_SESSION = 6

/** The words people say when something is at stake. Seven, not a sentiment model: a list a
 *  reader can check by eye is a list the camera's answer can be argued with. */
export const LEXICON = ['love', 'hate', 'swear', 'sorry', 'never', 'promise', 'mine'] as const
export const LEXICON_HIT = 2
/** One line saying `never` six times is one line, not three. */
export const LEXICON_CAP_PER_LINE = 3

const LEXICON_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${LEXICON.join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
)

/** How many of the strong words this line spends, capped. */
export function lexiconHits(text: string): number {
  let hits = 0
  LEXICON_RE.lastIndex = 0
  while (hits < LEXICON_CAP_PER_LINE && LEXICON_RE.exec(text) !== null) hits += 1
  return hits
}

/** Somebody pressed three times and the other one let it go. The shape of a scene turning. */
export const GIVE_WAY_AFTER = 3
export const GIVE_WAY = 6

/** What passed between two people, off a scene's closing deltas and off a tie left to lapse. */
export const TIE_TERMS: Readonly<Record<string, number>> = {
  slight: 6,
  promise_broken: 6,
  attraction: 4,
  partnership_strained: 10,
}

/** What happened to a person, wherever they were standing. Keyed by TERM and not by event
 *  type: a first night under one roof and a refusal in front of people are both narrower than
 *  the event that carries them. */
export const BODY_TERMS: Readonly<Record<string, number>> = {
  agent_died: 20,
  agent_born: 18,
  agent_departed: 14,
  partnership_dissolved: 14,
  agent_arrived: 12,
  law_ratified: 12,
  partnership_formed: 12,
  discovery_made: 10,
  law_broken: 9,
  law_repealed: 9,
  co_slept_first: 8,
  invitation_refused_seen: 6,
}

/** The first of its kind the town has seen today — town-wide, so the second quarrel is not one.
 *  A weight and never a caption: "the first today" is a reason to look, not a thing that happened. */
export const FIRST_TODAY = 3

/** A death, a birth, a quarrel with a slight named. What the day's second act opens on and what
 *  the quiet beat is held for. */
export const PEAK_SCORE = 18

/** How much better a rival has to be to take the shot off whoever holds it. */
export const STICKY = 1.25

/** 90 s at the shipped tick: a death outranks a fresh talk for that long and then gives way. */
export const BODY_HALF_LIFE_TICKS = 45

/** A closed scene keeps its entry this long, so the shot holds through its summary. */
export const SUMMARY_HOLD_TICKS = 4

/** 20 s of held shot after a peak. In TICKS, so the whole scorer is a pure function of the log
 *  and the rehearsal script replays the same cuts. At double speed it is 10 s of wall clock. */
export const QUIET_BEAT_TICKS = Math.round(20_000 / TICK_REAL_MS)

/** Dusk. The day's close is the third act whatever else is happening. */
export const ACT_III_HOUR = 19

/** The whole vocabulary the camera's caption is built from. No topic — a topic is 240 characters
 *  somebody said — and no kind word, because half of those are the ops plane's own. */
export const WHY_PHRASE: Record<StakeTerm, string> = {
  talk: 'talking',
  quarrel: 'falling out',
  council: 'putting a rule to the room',
  gathering: 'gathered at dusk',
  telling: 'a telling',
  invitation: 'an ask standing',
  lexicon: 'strong words',
  give_way: 'one of them gave way',
  slight: 'a slight',
  promise_broken: 'a promise broken',
  attraction: 'something between them',
  partnership_strained: 'partners at odds',
  agent_died: 'a death',
  agent_born: 'a birth',
  agent_arrived: 'come up the valley road',
  agent_departed: 'gone down the valley road',
  partnership_formed: 'partners now',
  partnership_dissolved: 'a parting',
  law_ratified: 'the town agreed a rule',
  law_broken: 'caught breaking a rule',
  law_repealed: 'a rule let go',
  discovery_made: 'found the way of something new',
  co_slept_first: 'a first night under one roof',
  invitation_refused_seen: 'turned down in front of people',
}

/** How many names a caption carries before it stops naming people. */
export const WHY_NAMES_MAX = 3

/** The people in the shot, as a reader would say them. */
export function castWords(names: readonly string[]): string {
  const shown = names.slice(0, WHY_NAMES_MAX)
  if (shown.length <= 1) return shown[0] ?? ''
  return `${shown.slice(0, -1).join(', ')} & ${shown[shown.length - 1]!}`
}

/** The caption: who, then the two heaviest reasons the camera is on them. */
export function whyOf(names: string, top: readonly StakeTerm[]): string {
  const said = top.map((t) => WHY_PHRASE[t])
  if (said.length === 0) return names
  return `${names} — ${said.join(', ')}`
}
