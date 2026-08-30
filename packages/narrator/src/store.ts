import Database from 'better-sqlite3'
import { insertAlert } from '@sj/llm'
import type { SemanticCandidateRow, SemanticFirstRow } from './semanticFirsts.js'
import type {
  ChapterRow,
  EraRow,
  HeatScores,
  Institution,
  Milestone,
  PublicationRow,
  SceneSegment,
} from './types.js'

const arr = (a: number[] | string[]): string => JSON.stringify(a)
const parseArr = <T>(s: string): T[] => JSON.parse(s) as T[]

export class NarratorStore {
  constructor(private db: Database.Database) {}

  /** The observatory's own alert row. `openNarratorDb` migrates the llm tables, so it is here. */
  insertAlert(kind: string, detail: string): void {
    insertAlert(this.db, { agentId: null, kind, detail })
  }

  insertScenes(scenes: SceneSegment[]): number[] {
    const stmt = this.db.prepare(
      `INSERT INTO scenes (day, start_tick, end_tick, event_ids, "cast", location) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const run = this.db.transaction((ss: SceneSegment[]) =>
      ss.map(
        (s) =>
          stmt.run(s.day, s.startTick, s.endTick, arr(s.eventIds), arr(s.cast), s.location)
            .lastInsertRowid as number,
      ),
    )
    return run(scenes)
  }

  scenesForDay(day: number): (SceneSegment & { id: number })[] {
    const rows = this.db
      .prepare(
        `SELECT id, day, start_tick, end_tick, event_ids, "cast", location FROM scenes WHERE day = ? ORDER BY id`,
      )
      .all(day) as {
      id: number
      day: number
      start_tick: number
      end_tick: number
      event_ids: string
      cast: string
      location: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      startTick: r.start_tick,
      endTick: r.end_tick,
      eventIds: parseArr<number>(r.event_ids),
      cast: parseArr<string>(r.cast),
      location: r.location,
    }))
  }

  insertHeat(sceneId: number, s: HeatScores): void {
    this.db
      .prepare(
        `INSERT INTO heat_scores (scene_id, conflict, novelty, firsts, stakes, dramatic_irony, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sceneId, s.conflict, s.novelty, s.firsts, s.stakes, s.dramaticIrony, s.total)
  }

  heatsForDay(day: number): { sceneId: number; s: HeatScores }[] {
    const rows = this.db
      .prepare(
        `SELECT h.scene_id, h.conflict, h.novelty, h.firsts, h.stakes, h.dramatic_irony, h.total
         FROM heat_scores h JOIN scenes s ON s.id = h.scene_id WHERE s.day = ? ORDER BY h.id`,
      )
      .all(day) as {
      scene_id: number
      conflict: number
      novelty: number
      firsts: number
      stakes: number
      dramatic_irony: number
      total: number
    }[]
    return rows.map((r) => ({
      sceneId: r.scene_id,
      s: {
        conflict: r.conflict,
        novelty: r.novelty,
        firsts: r.firsts,
        stakes: r.stakes,
        dramaticIrony: r.dramatic_irony,
        total: r.total,
      },
    }))
  }

  insertMilestone(m: Milestone): void {
    this.db
      .prepare(
        `INSERT INTO milestones (kind, label, event_seq, day, tick, tier, domain, agent_ids, construct_id, name_provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.kind,
        m.label,
        m.eventSeq,
        m.day,
        m.tick,
        String(m.tier),
        m.domain,
        arr(m.agentIds),
        m.constructId ?? null,
        m.nameProvenance === undefined ? null : JSON.stringify(m.nameProvenance),
      )
  }

  milestoneKinds(): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT kind FROM milestones').all() as {
      kind: string
    }[]
    return new Set(rows.map((r) => r.kind))
  }

  milestones(): Milestone[] {
    const rows = this.db
      .prepare(
        `SELECT kind, label, event_seq, day, tick, tier, domain, agent_ids, construct_id, name_provenance
         FROM milestones ORDER BY id`,
      )
      .all() as {
      kind: string
      label: string
      event_seq: number
      day: number
      tick: number
      tier: string
      domain: string
      agent_ids: string
      construct_id: string | null
      name_provenance: string | null
    }[]
    return rows.map((r) => ({
      kind: r.kind,
      tier: Number(r.tier) as Milestone['tier'],
      domain: r.domain,
      label: r.label,
      eventSeq: r.event_seq,
      day: r.day,
      tick: r.tick,
      agentIds: parseArr<string>(r.agent_ids),
      ...(r.construct_id === null ? {} : { constructId: r.construct_id }),
      ...(r.name_provenance === null
        ? {}
        : {
            nameProvenance: JSON.parse(r.name_provenance) as NonNullable<
              Milestone['nameProvenance']
            >,
          }),
    }))
  }

  insertSemanticFirst(r: SemanticFirstRow): void {
    this.db
      .prepare(
        `INSERT INTO semantic_first_detected
        (concept_kind, agent_id, day, source_kind, event_seq, memory_ref, quote, quote2, provenance2, confidence, rationale)
       VALUES (@conceptKind, @agentId, @day, @sourceKind, @eventSeq, @memoryRef, @quote, @quote2, @provenance2, @confidence, @rationale)`,
      )
      .run(r)
  }

  semanticFirsts(): SemanticFirstRow[] {
    const rows = this.db
      .prepare(
        `SELECT concept_kind, agent_id, day, source_kind, event_seq, memory_ref, quote, quote2, provenance2, confidence, rationale
       FROM semantic_first_detected ORDER BY id`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      conceptKind: r.concept_kind as string,
      agentId: r.agent_id as string,
      day: r.day as number,
      sourceKind: r.source_kind as string,
      eventSeq: r.event_seq as number | null,
      memoryRef: r.memory_ref as string | null,
      quote: r.quote as string,
      quote2: r.quote2 as string | null,
      provenance2: r.provenance2 as string | null,
      confidence: r.confidence as number,
      rationale: r.rationale as string,
    }))
  }

  semanticFirstKinds(): Set<string> {
    const rows = this.db.prepare('SELECT concept_kind FROM semantic_first_detected').all() as {
      concept_kind: string
    }[]
    return new Set(rows.map((r) => r.concept_kind))
  }

  insertSemanticCandidate(c: SemanticCandidateRow): void {
    this.db
      .prepare(
        `INSERT INTO semantic_candidates (concept_kind, agent_id, day, source_kind, quote, confidence, rationale, reason)
       VALUES (@conceptKind, @agentId, @day, @sourceKind, @quote, @confidence, @rationale, @reason)`,
      )
      .run(c)
  }

  semanticCandidates(): SemanticCandidateRow[] {
    const rows = this.db
      .prepare(
        'SELECT concept_kind, agent_id, day, source_kind, quote, confidence, rationale, reason FROM semantic_candidates ORDER BY id',
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      conceptKind: r.concept_kind as string,
      agentId: r.agent_id as string,
      day: r.day as number,
      sourceKind: r.source_kind as string,
      quote: r.quote as string,
      confidence: r.confidence as number,
      rationale: r.rationale as string,
      reason: r.reason as string,
    }))
  }

  insertInstitution(i: Institution): number {
    return this.db
      .prepare(
        `INSERT INTO institutions (kind, name, description, founding_scene_id, member_ids, source_event_ids)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        i.kind,
        i.name,
        i.description,
        i.foundingSceneId,
        arr(i.memberIds),
        arr(i.sourceEventIds),
      ).lastInsertRowid as number
  }

  institutions(): (Institution & { id: number })[] {
    const rows = this.db
      .prepare(
        'SELECT id, kind, name, description, founding_scene_id, member_ids, source_event_ids FROM institutions ORDER BY id',
      )
      .all() as {
      id: number
      kind: Institution['kind']
      name: string
      description: string
      founding_scene_id: number
      member_ids: string
      source_event_ids: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      description: r.description,
      foundingSceneId: r.founding_scene_id,
      memberIds: parseArr<string>(r.member_ids),
      sourceEventIds: parseArr<number>(r.source_event_ids),
    }))
  }

  insertChapter(c: {
    day: number
    title: string
    text: string
    citations: number[]
    sceneIds: number[]
  }): number {
    return this.db
      .prepare(
        'INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)',
      )
      .run(c.day, c.title, c.text, arr(c.citations), arr(c.sceneIds)).lastInsertRowid as number
  }

  private chapterRows(rows: unknown[]): ChapterRow[] {
    return (
      rows as {
        id: number
        day: number
        title: string
        text: string
        citations: string
        scene_ids: string
      }[]
    ).map((r) => ({
      id: r.id,
      day: r.day,
      title: r.title,
      text: r.text,
      citations: parseArr<number>(r.citations),
      sceneIds: parseArr<number>(r.scene_ids),
    }))
  }

  chaptersForDay(day: number): ChapterRow[] {
    return this.chapterRows(
      this.db
        .prepare(
          'SELECT id, day, title, text, citations, scene_ids FROM chapters WHERE day = ? ORDER BY id',
        )
        .all(day),
    )
  }

  chaptersInRange(fromDay: number, toDay: number): ChapterRow[] {
    return this.chapterRows(
      this.db
        .prepare(
          'SELECT id, day, title, text, citations, scene_ids FROM chapters WHERE day BETWEEN ? AND ? ORDER BY day',
        )
        .all(fromDay, toDay),
    )
  }

  insertEra(e: {
    startDay: number
    endDay: number
    title: string
    text: string
    citations: number[]
    chapterIds: number[]
  }): number {
    return this.db
      .prepare(
        'INSERT INTO eras (start_day, end_day, title, text, citations, chapter_ids) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(e.startDay, e.endDay, e.title, e.text, arr(e.citations), arr(e.chapterIds))
      .lastInsertRowid as number
  }

  eras(): EraRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, start_day, end_day, title, text, citations, chapter_ids FROM eras ORDER BY id',
      )
      .all() as {
      id: number
      start_day: number
      end_day: number
      title: string
      text: string
      citations: string
      chapter_ids: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      startDay: r.start_day,
      endDay: r.end_day,
      title: r.title,
      text: r.text,
      citations: parseArr<number>(r.citations),
      chapterIds: parseArr<number>(r.chapter_ids),
    }))
  }

  insertPublication(p: {
    day: number
    kind: PublicationRow['kind']
    title: string
    body: string
    citations: number[] | null
    subjectId?: string | null
  }): number {
    return this.db
      .prepare(
        'INSERT INTO publications (day, kind, title, body, citations, subject_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        p.day,
        p.kind,
        p.title,
        p.body,
        p.citations === null ? null : arr(p.citations),
        p.subjectId ?? null,
      ).lastInsertRowid as number
  }

  publications(kind?: PublicationRow['kind']): PublicationRow[] {
    const rows = (
      kind === undefined
        ? this.db
            .prepare(
              'SELECT id, day, kind, title, body, citations, subject_id FROM publications ORDER BY id',
            )
            .all()
        : this.db
            .prepare(
              'SELECT id, day, kind, title, body, citations, subject_id FROM publications WHERE kind = ? ORDER BY id',
            )
            .all(kind)
    ) as {
      id: number
      day: number
      kind: PublicationRow['kind']
      title: string
      body: string
      citations: string | null
      subject_id: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      kind: r.kind,
      title: r.title,
      body: r.body,
      citations: r.citations === null ? null : parseArr<number>(r.citations),
      subjectId: r.subject_id,
    }))
  }
}
