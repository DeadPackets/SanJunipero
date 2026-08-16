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

export type Milestone = { kind: string; label: string; eventSeq: number; day: number; tick: number }
export type FirstCtx = { seenKinds: Set<string>; rulebookCount: number }

export type Institution = {
  kind: 'group' | 'rule' | 'role'
  name: string
  description: string
  foundingSceneId: number
  memberIds: string[]
  sourceEventIds: number[]
}
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

export type TimelineMarker = { day: number; tick: number; label: string; sceneId: number }

export type PublicationRow = {
  id: number
  day: number
  kind: 'newspaper' | 'biography' | 'timelapse_caption' | 'share_card'
  title: string
  body: string
  citations: number[] | null
}
