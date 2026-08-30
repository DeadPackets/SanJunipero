import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine'
import { publishClean, renderChapter, renderEra } from './chronicle.js'
import { renderNewspaper, timelapseCaptions, writeBiography } from './publications.js'
import { detectFirsts } from './firsts.js'
import { detectTier2 } from './milestones/tier2.js'
import { detectSemanticFirsts, type SemanticDeps } from './semanticFirsts.js'
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
  PublicationRow,
  SegmentConfig,
} from './types.js'

// A night whose chronicle would not render. The rest of the night is attached, because the
// render is not the only thing that happened and the caller has to be able to say so.
export class ChapterRenderError extends Error {
  constructor(
    readonly renderCause: unknown,
    readonly night: { semanticRan: boolean; milestones: Milestone[] },
  ) {
    super(renderCause instanceof Error ? renderCause.message : String(renderCause), {
      cause: renderCause,
    })
    this.name = 'ChapterRenderError'
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
  semantic?: SemanticDeps
}): Promise<{
  chapter: ChapterRow
  heat: HeatScores[]
  milestones: Milestone[]
  semanticRan: boolean
}> {
  const { store, events } = deps
  if (events.length === 0) throw new Error('narrateDay requires at least one event')
  const day = Math.floor(events[0]!.tick / MINUTES_PER_DAY)

  const existing = store.chaptersForDay(day)
  if (existing.length > 0) {
    return {
      chapter: existing[0]!,
      heat: store.heatsForDay(day).map((h) => h.s),
      milestones: store.milestones(),
      semanticRan: false,
    }
  }

  const scenes = segmentScenes(events, deps.segmentCfg)
  const seenKinds = store.milestoneKinds()
  // The world in reach answers what the day's own events cannot: `structure_completed` carries
  // no kind, and the day that finishes a house never saw the day that planned it.
  const structures = deps.world?.state?.structures
  const tier1 = detectFirsts(events, {
    seenKinds,
    rulebookCount: deps.rulebookCount,
    ...(structures === undefined ? {} : { structureKind: (id: string) => structures[id]?.kind }),
  })
  const tier2 =
    deps.world === undefined
      ? []
      : detectTier2(events, {
          seenKinds: new Set([...seenKinds, ...tier1.map((m) => m.kind)]),
          config: deps.world.config,
          state: deps.world.state,
        })
  const milestones = [...tier1, ...tier2]
  const privateThoughts = deps.privateCounts.thoughts + deps.privateCounts.journals

  // Priors count each type's occurrences in earlier scenes of THIS day only: stored scenes
  // carry event ids and not types, so the day is the novelty horizon.
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

  // renderChapter owns scene persistence; `chapter.sceneIds` is the one index -> store-id map.
  // Only what needs the chapter fails with it: heats go down with it, milestones do not.
  let chapter: ChapterRow | undefined
  let renderFailure: unknown
  try {
    chapter = await renderChapter({
      store,
      llm: deps.llm,
      day,
      scenes,
      typeCounts,
      alert: deps.alert,
    })
    chapter.sceneIds.forEach((sceneId, i) => {
      store.insertHeat(sceneId, heats[i]!)
    })
  } catch (err) {
    renderFailure = err
  }
  for (const m of milestones) store.insertMilestone(m)

  // After the chapters, as §20 requires: one batched pass over the day's words.
  let semanticRan = false
  if (deps.semantic !== undefined) {
    semanticRan = true
    const semantic = await detectSemanticFirsts({ ...deps.semantic, store, day })
    for (const m of semantic) store.insertMilestone(m)
    milestones.push(...semantic)
  }

  if (renderFailure !== undefined)
    throw new ChapterRenderError(renderFailure, { semanticRan, milestones })
  const rendered = chapter!

  if (day % 7 === 0) {
    for (const inst of detectInstitutions(scenes, events, deps.detectCfg)) {
      const { foundingSceneIndex, ...rest } = inst
      const foundingSceneId = rendered.sceneIds[foundingSceneIndex]
      if (foundingSceneIndex === -1 || foundingSceneId === undefined) {
        deps.alert?.(
          `unmapped_founding_scene: institution "${inst.name}" founded in a dropped scene — not persisted`,
        )
        continue
      }
      store.insertInstitution({ ...rest, foundingSceneId })
    }
  }

  return { chapter: rendered, heat: heats, milestones, semanticRan }
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

/** Which week `day` closes, or null on the other six. */
const weekClosedBy = (day: number): { startDay: number; endDay: number } | null =>
  day % 7 === 6 ? { startDay: day - 6, endDay: day } : null

const seqsBetweenDays = (world: Database.Database, from: number, to: number): number[] =>
  (
    world
      .prepare('SELECT seq FROM events WHERE tick >= ? AND tick <= ?')
      .all(from * MINUTES_PER_DAY, (to + 1) * MINUTES_PER_DAY - 1) as { seq: number }[]
  ).map((r) => r.seq)

/**
 * Everything the town publishes when a day closes: the chapter, that day's paper and its
 * caption, one townsperson's life so far, and on the seventh day the week's arc. Only the
 * chapter, the biography and the week cost a call; the paper and the caption are composed from
 * what is already written down. Idempotent per day, like `narrateDay` under it.
 */
export async function closeDay(deps: {
  store: NarratorStore
  llm: NarratorLlm
  /** The world db, for the public record a biography is allowed to read. */
  worldDb: Database.Database
  events: SimEvent[]
  rulebookCount: number
  privateCounts: { thoughts: number; journals: number }
  /** Written up one a night in turn, so a cast of five is five nights and then a deeper record. */
  cast: readonly { id: string; name: string }[]
  world?: { config: SimConfig; state?: WorldState }
  /** The tier-2.5 pass, passed straight through to `narrateDay`. Absent, the night has no
   *  semantic firsts and costs nothing. */
  semantic?: SemanticDeps
  alert?: (d: string) => void
}): Promise<ChapterRow> {
  const { store, llm, cast } = deps
  const { chapter, heat, milestones } = await narrateDay({
    store,
    llm,
    events: deps.events,
    rulebookCount: deps.rulebookCount,
    privateCounts: deps.privateCounts,
    ...(deps.world === undefined ? {} : { world: deps.world }),
    ...(deps.semantic === undefined ? {} : { semantic: deps.semantic }),
    ...(deps.alert === undefined ? {} : { alert: deps.alert }),
  })
  const day = chapter.day
  const published = store.publications()
  const alreadyOn = (kind: PublicationRow['kind']): boolean =>
    published.some((p) => p.kind === kind && p.day === day)

  if (!alreadyOn('newspaper')) {
    const paper = renderNewspaper(day, chapter, heat, milestones, store.scenesForDay(day))
    store.insertPublication({
      day,
      kind: 'newspaper',
      title: paper.headline,
      body: publishClean(deps, `newspaper for day ${day}`, paper.body),
      citations: paper.citations,
    })
    for (const c of timelapseCaptions([chapter]))
      store.insertPublication({
        day,
        kind: 'timelapse_caption',
        title: `Day ${c.day}`,
        body: publishClean(deps, `caption for day ${c.day}`, c.caption),
        citations: null,
      })
  }

  const subject = cast.length === 0 ? undefined : cast[day % cast.length]
  if (subject !== undefined && !alreadyOn('biography')) {
    try {
      await writeBiography({
        store,
        llm,
        world: deps.worldDb,
        agentId: subject.id,
        name: subject.name,
        throughDay: day,
        ...(deps.alert === undefined ? {} : { alert: deps.alert }),
      })
    } catch (err) {
      // A life the roster refused twice is not written down; the day still stands.
      deps.alert?.(`biography_skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const week = weekClosedBy(day)
  if (week !== null) {
    const days = store.chaptersInRange(week.startDay, week.endDay)
    if (days.length > 0)
      await narrateWeek({
        store,
        llm,
        days,
        validEventIds: seqsBetweenDays(deps.worldDb, week.startDay, week.endDay),
        ...(deps.alert === undefined ? {} : { alert: deps.alert }),
      })
  }
  return chapter
}
