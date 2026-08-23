import type { QuotedName } from '@sj/agents'
import type { SimEvent } from '@sj/shared'
export type SceneSegment = {
  day: number
  startTick: number
  endTick: number
  eventIds: number[]
  cast: string[]
  location: string | null
}
export type SegmentConfig = { silenceTicks: number; maxTicks: number; minEvents: number }

export type HeatScores = {
  conflict: number
  novelty: number
  firsts: number
  stakes: number
  dramaticIrony: number
  total: number
}
export type HeatCtx = {
  priorTypeCounts: Record<string, number>
  firstsInScene: number
  privateThoughts: number
  publicSpeech: number
}

// Tiers: 1 engine firsts, 2 pattern firsts, 2.5 semantic firsts, 3 reserved. Stored as TEXT
// so 2.5 is representable (POST-REVIEW USER RULING 3).
export type MilestoneTier = 1 | 2 | 2.5 | 3

export type MilestoneRow = {
  kind: string
  tier: MilestoneTier
  domain: string
  label: string
  eventSeq: number
  day: number
  tick: number
  agentIds: string[]
  constructId?: string
  // Present only when the town named the thing itself, kept verbatim (G9).
  nameProvenance?: QuotedName
}
// One registry, one type: C7's ledger grew columns, it did not gain a rival.
export type Milestone = MilestoneRow

export type FirstCtx = {
  seenKinds: Set<string>
  rulebookCount: number
  // What kind of thing a completed structure is. Injected, because a house may have been
  // planned on a day this pass never sees; the detector falls back to its own stream.
  structureKind?: (id: string) => string | undefined
  // Souls alive as the pass runs. The detector counts spawns, births and deaths onto it.
  population?: number
}

export type MilestoneDef = {
  kind: string
  label: string
  tier: MilestoneTier
  domain: string
  match(ev: SimEvent, ctx: FirstCtx): boolean
  agentIds?(ev: SimEvent): string[]
}

export type Institution = {
  kind: 'group' | 'rule' | 'role'
  name: string
  description: string
  foundingSceneId: number
  memberIds: string[]
  sourceEventIds: number[]
}
// detectInstitutions output: foundingSceneIndex is an INDEX into the scenes array
// (or -1 when the founding event sits in a dropped scene). The caller maps it to a
// store id via insertScenes' returned ids before persisting — never persist -1.
export type DetectedInstitution = Omit<Institution, 'foundingSceneId'> & { foundingSceneIndex: number }
export type DetectConfig = {
  groupMinCoScenes: number
  groupMinMembers: number
  roleMinActions: number
  ruleMinAgents: number
  ruleMinActions: number
}

export type ChapterSummary = { title: string; text: string; citations: number[] }
export type EraSummary = { title: string; text: string; citations: number[] }
export type SceneDigest = {
  eventIds: number[]
  cast: string[]
  location: string | null
  typeCounts: Record<string, number>
}
export type ChapterDigest = { day: number; title: string; text: string; citations: number[] }

export type PublicRecord = { eventSeq: number; tick: number; day: number; text: string }

export type NarratorLlm = {
  summarizeChapter(scenes: SceneDigest[]): Promise<ChapterSummary>
  summarizeEra(chapters: ChapterDigest[]): Promise<EraSummary>
  newspaperCopy(day: number, highlights: string[]): Promise<{ headline: string; body: string; citations: number[] }>
  biography(agentId: string, name: string, record: PublicRecord[]): Promise<{ title: string; body: string }>
}

export type ChapterRow = {
  id: number
  day: number
  title: string
  text: string
  citations: number[]
  sceneIds: number[]
}
export type EraRow = {
  id: number
  startDay: number
  endDay: number
  title: string
  text: string
  citations: number[]
  chapterIds: number[]
}

// sceneIndex is an index into the scenes array handed to timelineMarkers (-1 when
// no surviving scene contains the milestone's event) — not a store id.
export type TimelineMarker = { day: number; tick: number; label: string; sceneIndex: number }

export type PublicationRow = {
  id: number
  day: number
  kind: 'newspaper' | 'biography' | 'timelapse_caption' | 'share_card'
  title: string
  body: string
  citations: number[] | null
}
