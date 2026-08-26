import type Database from 'better-sqlite3'
import { FORBIDDEN_FRAMING, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
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
    if (cast.length > 0) parts.push(`Seen in the thick of it: ${cast.join(', ')}.`)
  }

  return { headline: chapter.title, body: parts.join('\n\n'), citations: chapter.citations }
}

export function timelapseCaptions(
  chapters: ChapterRow[],
  intervalDays = 1,
): Array<{ day: number; caption: string }> {
  return [...chapters]
    .sort((a, b) => a.day - b.day)
    .filter((_c, i) => i % intervalDays === 0)
    .map((c) => ({ day: c.day, caption: `Day ${c.day}: ${c.title}` }))
}

// The public-record boundary: `structure_completed` and `crop_harvested` carry no person, so
// building is attributed via `structure_planned.builderId` and harvests via `action_completed`.
export const PUBLIC_EVENT_TYPES = [
  'agent_spoke',
  'action_completed',
  'structure_planned',
  'agent_died',
  'agent_injured',
  'agent_recovered',
  'skill_gained',
  'agent_moved',
  'agent_slept',
  'agent_woke',
  'agent_collapsed',
] as const

type P = Record<string, unknown>

const publicAgentOf = (type: string, p: P): string | null => {
  if (type === 'agent_moved') return typeof p.id === 'string' ? p.id : null
  if (type === 'structure_planned') return typeof p.builderId === 'string' ? p.builderId : null
  return typeof p.agentId === 'string' ? p.agentId : null
}

export function publicRecordText(ev: SimEvent): string {
  const p = (ev.payload ?? {}) as P
  switch (ev.type) {
    case 'agent_spoke':
      return `was heard to say: "${String(p.text ?? '')}"`
    case 'action_completed':
      return `was seen to ${String(p.verb ?? 'act')}`
    case 'structure_planned':
      return 'laid out plans for a structure'
    case 'agent_died':
      return `died of ${String(p.cause ?? 'unknown causes')}`
    case 'agent_injured':
      return 'was seen wounded'
    case 'agent_recovered':
      return 'was seen back on their feet'
    case 'skill_gained':
      return `grew skilled at ${String(p.skill ?? 'a craft')}`
    case 'agent_moved':
      return 'was seen about the settlement'
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
       WHERE tick <= ? AND type IN (${PUBLIC_EVENT_TYPES.map(() => '?').join(',')}) ORDER BY seq`,
    )
    .all(maxTick, ...PUBLIC_EVENT_TYPES) as Array<{
    seq: number
    tick: number
    type: string
    payload: string
  }>
  const out: PublicRecord[] = []
  for (const r of rows) {
    const payload = JSON.parse(r.payload) as P
    if (publicAgentOf(r.type, payload) !== agentId) continue
    out.push({
      eventSeq: r.seq,
      tick: r.tick,
      day: Math.floor(r.tick / MINUTES_PER_DAY),
      text: publicRecordText({ seq: r.seq, tick: r.tick, type: r.type, payload }),
    })
  }
  return out
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
    // Asked twice at most. The roster bans world words a true record can force — a town whose
    // first tool is a tier-1 milestone makes `tool` the honest draft — so one refused draft is
    // a sampling accident, and two is the answer.
    let bio = await deps.llm.biography(deps.agentId, deps.name, record)
    if (framingViolated(bio)) bio = await deps.llm.biography(deps.agentId, deps.name, record)
    if (framingViolated(bio)) {
      deps.alert?.(
        `framing_violation: biography of ${deps.agentId} broke the human framing law — not persisted`,
      )
      throw new Error(`framing_violation: biography of ${deps.agentId} rejected`)
    }
    title = bio.title
    body = bio.body
  }
  const id = deps.store.insertPublication({
    day: deps.throughDay,
    kind: 'biography',
    title,
    body,
    citations: null,
  })
  return { id, day: deps.throughDay, kind: 'biography', title, body, citations: null }
}
