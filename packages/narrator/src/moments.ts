import { SOMEONE, type SimEvent, sanitizeSpokenText } from '@sj/shared'
import { publicRecordText } from './publications.js'
import { eventAgentIds } from './segment.js'
import type { Moment } from './types.js'

export const SCENE_MOMENT_CAP = 10
export const DAY_MOMENT_CAP = 60

const SUMMARY_MAX_CHARS = 200
const LINE_MIN_CHARS = 30
const LINE_MAX_CHARS = 180
const LINES_PER_SPEAKER = 2

// What became of somebody or of the ground under them. The first four already have their words
// in the public record; the last two carry no person at all, so they are told without one.
const OUTCOME_TYPES = [
  'agent_died',
  'agent_injured',
  'agent_collapsed',
  'agent_recovered',
  'structure_completed',
  'crop_harvested',
] as const
const OUTCOME_WITHOUT_PERSON: Record<string, string> = {
  structure_completed: 'A building was finished.',
  crop_harvested: 'A crop was brought in.',
}

// Work worth a line. Walking, doors, carrying, eating and sleeping are the day's breathing:
// they are what made the paper read "the places held movement, speech, and rest".
const WORTH_TELLING = new Set([
  'fish',
  'chop',
  'forage',
  'harvest',
  'cook',
  'build',
  'plant',
  'mend',
  'carve',
  'teach',
])

type P = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const payloadOf = (ev: SimEvent): P => (ev.payload ?? {}) as P
const bySeq = (moments: Moment[]): Moment[] => [...moments].sort((a, b) => a.n - b.n)

/** The scene's moments in priority order, so a day trim drops the least of them first. */
function rankMoments(evs: SimEvent[], nameOf: (id: string) => string, cap: number): Moment[] {
  const out: Moment[] = []
  const room = (): boolean => out.length < cap
  const push = (n: number, text: string): void => {
    out.push({ n, text })
  }

  for (const ev of evs) {
    if (!room()) return out
    if (ev.type !== 'scene_closed') continue
    const summary = str(payloadOf(ev).summary).trim()
    if (summary !== '') push(ev.seq, summary.slice(0, SUMMARY_MAX_CHARS))
  }

  for (const ev of evs) {
    if (!room()) return out
    if (!(OUTCOME_TYPES as readonly string[]).includes(ev.type)) continue
    const plain = OUTCOME_WITHOUT_PERSON[ev.type]
    if (plain !== undefined) {
      push(ev.seq, plain)
      continue
    }
    const id = str(payloadOf(ev).agentId)
    if (id !== '') push(ev.seq, `${nameOf(id)} ${publicRecordText(ev)}.`)
  }

  const present = new Set<string>()
  for (const ev of evs)
    for (const id of eventAgentIds(ev)) {
      const name = nameOf(id)
      if (name !== SOMEONE) present.add(name)
    }
  const said: { seq: number; speaker: string; name: string; line: string; keen: boolean }[] = []
  for (const ev of evs) {
    if (ev.type !== 'agent_spoke' && ev.type !== 'scene_line') continue
    const p = payloadOf(ev)
    const speaker = str(p.agentId)
    if (speaker === '') continue
    const line = sanitizeSpokenText(str(p.text))
    if (line.length < LINE_MIN_CHARS || line.length > LINE_MAX_CHARS) continue
    const name = nameOf(speaker)
    const keen = /[?!]/u.test(line) || [...present].some((o) => o !== name && line.includes(o))
    said.push({ seq: ev.seq, speaker, name, line, keen })
  }
  const spoken = new Map<string, number>()
  for (const s of [...said.filter((x) => x.keen), ...said.filter((x) => !x.keen)]) {
    if (!room()) return out
    const already = spoken.get(s.speaker) ?? 0
    if (already >= LINES_PER_SPEAKER) continue
    spoken.set(s.speaker, already + 1)
    push(s.seq, `${s.name} said: "${s.line}"`)
  }

  const verbs = new Set<string>()
  for (const ev of evs) {
    if (!room()) return out
    if (ev.type !== 'action_completed') continue
    const p = payloadOf(ev)
    const verb = str(p.verb)
    const id = str(p.agentId)
    if (id === '' || !WORTH_TELLING.has(verb) || verbs.has(verb)) continue
    verbs.add(verb)
    push(ev.seq, `${nameOf(id)} ${publicRecordText(ev)}.`)
  }

  return out
}

export function pickMoments(
  evs: SimEvent[],
  nameOf: (id: string) => string,
  cap = SCENE_MOMENT_CAP,
): Moment[] {
  return bySeq(rankMoments(evs, nameOf, cap))
}

/** The day's moments, scene by scene. Over the day cap the coolest scene is emptied before a
 *  warmer one loses anything, and within a scene the last-ranked moment goes first. */
export function pickDayMoments(
  scenes: { events: SimEvent[]; heat: number }[],
  nameOf: (id: string) => string,
  dayCap = DAY_MOMENT_CAP,
): Moment[][] {
  const picked = scenes.map((s) => rankMoments(s.events, nameOf, SCENE_MOMENT_CAP))
  let total = picked.reduce((n, m) => n + m.length, 0)
  const coolestFirst = scenes
    .map((_s, i) => i)
    .sort((a, b) => scenes[a]!.heat - scenes[b]!.heat || a - b)
  for (const i of coolestFirst) {
    while (total > dayCap && picked[i]!.length > 0) {
      picked[i]!.pop()
      total -= 1
    }
  }
  return picked.map(bySeq)
}
