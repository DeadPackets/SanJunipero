import { MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine'
import { renderChapter, renderEra } from './chronicle.js'
import { detectFirsts } from './firsts.js'
import { detectTier2 } from './milestones/tier2.js'
import { detectSemanticFirsts, type SemanticPassDeps, type TranscriptRecord } from './semanticFirsts.js'
import { scoreHeat } from './heat.js'
import { detectInstitutions } from './institutions.js'
import { segmentScenes } from './segment.js'
import type { NarratorStore } from './store.js'
import type {
  ChapterRow,
  DetectConfig,
  EraRow,
  HeatScores,
  Milestone,
  NarratorLlm,
  SceneSegment,
  SegmentConfig,
  TimelineMarker,
} from './types.js'

export const MARKER_HEAT_THRESHOLD = 6

export function timelineMarkers(deps: {
  milestones: Milestone[]
  scenes: SceneSegment[]
  heats: HeatScores[]
}): TimelineMarker[] {
  const markers: TimelineMarker[] = deps.milestones.map((m) => ({
    day: m.day,
    tick: m.tick,
    label: m.label,
    sceneIndex: deps.scenes.findIndex((s) => s.eventIds.includes(m.eventSeq)),
  }))
  deps.scenes.forEach((s, i) => {
    const heat = deps.heats[i]
    if (heat !== undefined && heat.total >= MARKER_HEAT_THRESHOLD) {
      markers.push({ day: s.day, tick: s.startTick, label: 'a scene of high drama', sceneIndex: i })
    }
  })
  return markers
}

export function renderDigest(
  lastSeenDay: number,
  currentDay: number,
  chapters: ChapterRow[],
): { headline: string; body: string } {
  const missed = chapters
    .filter((c) => c.day > lastSeenDay && c.day <= currentDay)
    .sort((a, b) => a.day - b.day)
  const days = currentDay - lastSeenDay
  return {
    headline: `While you were away — ${days} day${days === 1 ? '' : 's'} passed in San Junipero`,
    body: missed.map((c) => `- Day ${c.day}: ${c.title}`).join('\n'),
  }
}

// The incremental one-day job: segment -> score -> firsts -> institutions (week
// boundaries only) -> chapter. Idempotent per day (chapters.day is UNIQUE).
export async function narrateDay(deps: {
  store: NarratorStore
  llm: NarratorLlm
  events: SimEvent[]
  rulebookCount: number
  privateCounts: { thoughts: number; journals: number }
  segmentCfg?: SegmentConfig
  detectCfg?: DetectConfig
  alert?: (d: string) => void
  // Tier 2 reads relationships, so it runs only where a world is in reach. Absent, the day
  // gets its engine firsts and nothing is claimed about anybody's partnership.
  world?: { config: SimConfig; state?: WorldState }
  // The tier-2.5 pass, run after the chapter is written. Absent, the night has no semantic
  // firsts and costs nothing — the detector is never called speculatively.
  semantic?: Omit<SemanticPassDeps, 'store' | 'day' | 'records'> & { records: TranscriptRecord[] }
}): Promise<{ chapter: ChapterRow; heat: HeatScores[]; milestones: Milestone[] }> {
  const { store, events } = deps
  if (events.length === 0) throw new Error('narrateDay requires at least one event')
  const day = Math.floor(events[0]!.tick / MINUTES_PER_DAY)

  const existing = store.chaptersForDay(day)
  if (existing.length > 0) {
    return {
      chapter: existing[0]!,
      heat: store.heatsForDay(day).map((h) => h.s),
      milestones: store.milestones(),
    }
  }

  const scenes = segmentScenes(events, deps.segmentCfg)
  const seenKinds = store.milestoneKinds()
  const tier1 = detectFirsts(events, { seenKinds, rulebookCount: deps.rulebookCount })
  const tier2 = deps.world === undefined
    ? []
    : detectTier2(events, {
        seenKinds: new Set([...seenKinds, ...tier1.map((m) => m.kind)]),
        config: deps.world.config,
        state: deps.world.state,
      })
  const milestones = [...tier1, ...tier2]
  const privateThoughts = deps.privateCounts.thoughts + deps.privateCounts.journals

  // F3 ruling (novelty priors): priors count each type's occurrences in EARLIER
  // scenes of this day, and every type present in the scored scene is seeded at
  // its running count (0 when never seen) — so a brand-new type scores full
  // novelty 1/(1+0), never a permanent 0. Prior days are not re-read: stored
  // scenes carry event ids, not types, so the day is the novelty horizon.
  const running: Record<string, number> = {}
  const heats = scenes.map((scene) => {
    const inScene = new Set(scene.eventIds)
    const evs = events.filter((e) => inScene.has(e.seq))
    const priorTypeCounts: Record<string, number> = {}
    for (const e of evs) priorTypeCounts[e.type] = running[e.type] ?? 0
    const heat = scoreHeat(
      scene,
      {
        priorTypeCounts,
        firstsInScene: milestones.filter((m) => inScene.has(m.eventSeq)).length,
        privateThoughts,
        publicSpeech: evs.filter((e) => e.type === 'agent_spoke').length,
      },
      events,
    )
    for (const e of evs) running[e.type] = (running[e.type] ?? 0) + 1
    return heat
  })

  const typeCounts = (ids: number[]): Record<string, number> => {
    const idSet = new Set(ids)
    const counts: Record<string, number> = {}
    for (const e of events) if (idSet.has(e.seq)) counts[e.type] = (counts[e.type] ?? 0) + 1
    return counts
  }

  // renderChapter owns scene persistence; chapter.sceneIds (ordered as scenes) is
  // the single index -> store-id mapping point (T1-7 review ruling).
  const chapter = await renderChapter({ store, llm: deps.llm, day, scenes, typeCounts, alert: deps.alert })
  chapter.sceneIds.forEach((sceneId, i) => store.insertHeat(sceneId, heats[i]!))
  for (const m of milestones) store.insertMilestone(m)

  // After the chapters, as §20 requires: one batched pass over the day's words.
  if (deps.semantic !== undefined) {
    const semantic = await detectSemanticFirsts({ ...deps.semantic, store, day })
    for (const m of semantic) store.insertMilestone(m)
    milestones.push(...semantic)
  }

  if (day % 7 === 0) {
    for (const inst of detectInstitutions(scenes, events, deps.detectCfg)) {
      const { foundingSceneIndex, ...rest } = inst
      const foundingSceneId = chapter.sceneIds[foundingSceneIndex]
      if (foundingSceneIndex === -1 || foundingSceneId === undefined) {
        deps.alert?.(`unmapped_founding_scene: institution "${inst.name}" founded in a dropped scene — not persisted`)
        continue
      }
      store.insertInstitution({ ...rest, foundingSceneId })
    }
  }

  return { chapter, heat: heats, milestones }
}

export async function narrateWeek(deps: {
  store: NarratorStore
  llm: NarratorLlm
  days: ChapterRow[]
  validEventIds: number[]
  alert?: (d: string) => void
}): Promise<EraRow> {
  if (deps.days.length === 0) throw new Error('narrateWeek requires at least one chapter')
  const chapters = [...deps.days].sort((a, b) => a.day - b.day)
  return renderEra({
    store: deps.store,
    llm: deps.llm,
    startDay: chapters[0]!.day,
    endDay: chapters[chapters.length - 1]!.day,
    chapters,
    validEventIds: deps.validEventIds,
    alert: deps.alert,
  })
}
