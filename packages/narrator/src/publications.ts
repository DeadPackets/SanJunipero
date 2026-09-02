import type Database from 'better-sqlite3'
import { FORBIDDEN_FRAMING, MINUTES_PER_DAY, SOMEONE, type SimEvent, verbPhrase } from '@sj/shared'
import { applyFootnotes, publishClean } from './chronicle.js'
import type { NarratorStore } from './store.js'
import type {
  ChapterRow,
  HeatScores,
  Milestone,
  NarratorLlm,
  PublicRecord,
  PublicationRow,
  SceneSegment,
} from './types.js'

// Deterministic composition over the day's already-verified chapter, with no second LLM call.
// `scenes` is index-aligned with `heats` and supplies the top-heat scene's cast.
export function renderNewspaper(
  day: number,
  chapter: ChapterRow,
  heats: HeatScores[],
  milestones: Milestone[],
  scenes?: SceneSegment[],
  nameOf: (id: string) => string = () => SOMEONE,
): { headline: string; body: string; citations: number[] } {
  const parts: string[] = [chapter.text]

  const marks = milestones.filter((m) => m.day === day)
  if (marks.length > 0) {
    parts.push(['Marks of the day:', ...marks.map((m) => `- ${m.label}`)].join('\n'))
  }

  if (scenes !== undefined && scenes.length > 0 && heats.length > 0) {
    let top = 0
    heats.forEach((h, i) => {
      if (h.total > (heats[top]?.total ?? 0)) top = i
    })
    const cast = scenes[top]?.cast ?? []
    if (cast.length > 0) parts.push(`Seen in the thick of it: ${cast.map(nameOf).join(', ')}.`)
  }

  return { headline: chapter.title, body: parts.join('\n\n'), citations: chapter.citations }
}

export function timelapseCaptions(
  chapters: ChapterRow[],
  intervalDays = 1,
): { day: number; caption: string }[] {
  return [...chapters]
    .sort((a, b) => a.day - b.day)
    .filter((_c, i) => i % intervalDays === 0)
    .map((c) => ({ day: c.day, caption: `Day ${c.day}: ${c.title}` }))
}

// The public-record boundary: `structure_completed` and `crop_harvested` carry no person, so
// building is attributed via `structure_planned.builderId` and harvests via `action_completed`.
// `agent_moved` is out: one row per tile crossed is a life told as footsteps.
export const PUBLIC_EVENT_TYPES = [
  'agent_spoke',
  'action_completed',
  'structure_planned',
  'agent_died',
  'agent_injured',
  'agent_recovered',
  'skill_gained',
  'agent_slept',
  'agent_woke',
  'agent_collapsed',
] as const

/** A biography is one prompt: a long life is read from its most recent lines. */
export const PUBLIC_RECORD_LIMIT = 400

type P = Record<string, unknown>

const strOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

export function publicRecordText(ev: SimEvent): string {
  const p = (ev.payload ?? {}) as P
  switch (ev.type) {
    case 'agent_spoke':
      return `was heard to say: "${strOr(p.text, '')}"`
    case 'action_completed':
      return `was seen to ${verbPhrase(strOr(p.verb, 'act'))}`
    case 'structure_planned':
      return 'laid out plans for a structure'
    case 'agent_died':
      return `died of ${strOr(p.cause, 'unknown causes')}`
    case 'agent_injured':
      return 'was seen wounded'
    case 'agent_recovered':
      return 'was seen back on their feet'
    case 'skill_gained':
      return `grew skilled at ${strOr(p.skill, 'a craft')}`
    case 'agent_slept':
      return 'was seen retiring to sleep'
    case 'agent_woke':
      return 'was seen rising'
    case 'agent_collapsed':
      return 'collapsed in public view'
    default:
      return 'was seen'
  }
}

// Reads ONLY the events table — never memories/journal/ledgers. Private thoughts
// are structurally invisible to a biography.
export function collectPublicRecord(
  world: Database.Database,
  agentId: string,
  throughDay: number,
): PublicRecord[] {
  const maxTick = (throughDay + 1) * MINUTES_PER_DAY - 1
  const rows = world
    .prepare(
      `SELECT seq, tick, type, payload FROM events
       WHERE tick <= ? AND type IN (${PUBLIC_EVENT_TYPES.map(() => '?').join(',')})
         AND coalesce(json_extract(payload, '$.agentId'), json_extract(payload, '$.builderId')) = ?
       ORDER BY seq DESC LIMIT ?`,
    )
    .all(maxTick, ...PUBLIC_EVENT_TYPES, agentId, PUBLIC_RECORD_LIMIT) as {
    seq: number
    tick: number
    type: string
    payload: string
  }[]
  return rows.reverse().map((r) => ({
    eventSeq: r.seq,
    day: Math.floor(r.tick / MINUTES_PER_DAY),
    text: publicRecordText({
      seq: r.seq,
      tick: r.tick,
      type: r.type,
      payload: JSON.parse(r.payload) as P,
    }),
  }))
}

const framingViolated = (bio: { title: string; body: string }): boolean =>
  FORBIDDEN_FRAMING.test(bio.title) || FORBIDDEN_FRAMING.test(bio.body)

export async function writeBiography(deps: {
  store: NarratorStore
  llm: NarratorLlm
  world: Database.Database
  agentId: string
  name: string
  throughDay: number
  alert?: (d: string) => void
}): Promise<PublicationRow> {
  const record = collectPublicRecord(deps.world, deps.agentId, deps.throughDay)
  let title = deps.name
  let body = 'Nothing is known of them yet.'
  if (record.length > 0) {
    // Asked twice at most: the roster bans world words a true record can force, so one refused
    // draft is a sampling accident and two is the answer.
    let bio = await deps.llm.biography(deps.agentId, deps.name, record)
    if (framingViolated(bio)) bio = await deps.llm.biography(deps.agentId, deps.name, record)
    if (framingViolated(bio)) {
      deps.alert?.(
        `framing_violation: biography of ${deps.agentId} broke the human framing law — not persisted`,
      )
      throw new Error(`framing_violation: biography of ${deps.agentId} rejected`)
    }
    const seen = applyFootnotes(bio.body, [], new Set(record.map((r) => r.eventSeq)))
    if (seen.dangling.length > 0)
      deps.alert?.(
        `dangling_citation: biography of ${deps.agentId} cited unknown ledger numbers ${seen.dangling.join(', ')}`,
      )
    title = bio.title
    body = publishClean(deps, `biography of ${deps.agentId}`, seen.text)
  }
  const id = deps.store.insertPublication({
    day: deps.throughDay,
    kind: 'biography',
    title,
    body,
    citations: null,
    subjectId: deps.agentId,
  })
  return {
    id,
    day: deps.throughDay,
    kind: 'biography',
    title,
    body,
    citations: null,
    subjectId: deps.agentId,
  }
}
