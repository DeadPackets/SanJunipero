import { describe, expect, it } from 'vitest'
import { NARRATOR_TABLES, migrateNarratorTables, openNarratorDb } from './schema.js'
import { NarratorStore } from './store.js'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeatScores, Institution, Milestone, SceneSegment } from './types.js'

function memStore(): { db: Database.Database; store: NarratorStore } {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return { db, store: new NarratorStore(db) }
}

describe('migrateNarratorTables', () => {
  it('creates all seven observatory tables, idempotently', () => {
    const { db } = memStore()
    migrateNarratorTables(db) // second run must not throw
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    expect(NARRATOR_TABLES.every((t) => has.get(t) !== undefined)).toBe(true)
  })

  it('openNarratorDb creates narrator + llm tables on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-narrator-store-'))
    const db = openNarratorDb(join(dir, 'narrator.db'))
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
    for (const t of [...NARRATOR_TABLES, 'llm_calls', 'alerts']) expect(names).toContain(t)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('NarratorStore', () => {
  it('round-trips scenes with parsed eventIds/cast arrays', () => {
    const { store } = memStore()
    const scenes: SceneSegment[] = [
      {
        day: 1,
        startTick: 1440,
        endTick: 1450,
        eventIds: [4, 5, 6],
        cast: ['omar', 'yusuf'],
        location: '3,4',
      },
      { day: 1, startTick: 1500, endTick: 1520, eventIds: [7, 8], cast: ['nadia'], location: null },
    ]
    const ids = store.insertScenes(scenes)
    expect(ids).toHaveLength(2)
    const got = store.scenesForDay(1)
    expect(got).toHaveLength(2)
    expect(got[0]).toEqual({ id: ids[0], ...scenes[0] })
    expect(got[1]).toEqual({ id: ids[1], ...scenes[1] })
    expect(store.scenesForDay(2)).toEqual([])
  })

  it('round-trips heat scores by day', () => {
    const { store } = memStore()
    const [sceneId] = store.insertScenes([
      { day: 1, startTick: 1440, endTick: 1450, eventIds: [1, 2], cast: [], location: null },
    ])
    const s: HeatScores = {
      conflict: 1.5,
      novelty: 2,
      firsts: 3,
      stakes: 1,
      dramaticIrony: 0,
      total: 7.5,
    }
    store.insertHeat(sceneId!, s)
    const heats = store.heatsForDay(1)
    expect(heats).toHaveLength(1)
    expect(heats[0]!.sceneId).toBe(sceneId)
    expect(heats[0]!.s.total).toBe(7.5)
    expect(heats[0]!.s).toEqual(s)
  })

  it('milestones: kinds round-trip and duplicate kind throws', () => {
    const { store } = memStore()
    const m: Milestone = {
      kind: 'first_trade',
      tier: 1,
      domain: 'engine',
      label: 'the first trade',
      eventSeq: 9,
      day: 0,
      tick: 100,
      agentIds: ['omar'],
    }
    store.insertMilestone(m)
    expect(store.milestoneKinds()).toEqual(new Set(['first_trade']))
    expect(store.milestones()).toEqual([m])
    expect(() => {
      store.insertMilestone(m)
    }).toThrow()
  })

  it('institutions round-trip memberIds/sourceEventIds', () => {
    const { store } = memStore()
    const inst: Institution = {
      kind: 'group',
      name: 'omar & yusuf',
      description: 'seen together often',
      foundingSceneId: 1,
      memberIds: ['omar', 'yusuf'],
      sourceEventIds: [1, 2, 3],
    }
    const id = store.insertInstitution(inst)
    const got = store.institutions()
    expect(got).toEqual([{ id, ...inst }])
    expect(got[0]!.memberIds).toEqual(['omar', 'yusuf'])
  })

  it('chapters: insert, range query, day query', () => {
    const { store } = memStore()
    const id = store.insertChapter({
      day: 1,
      title: 'Day One',
      text: 'It began.',
      citations: [3, 7],
      sceneIds: [1],
    })
    const inRange = store.chaptersInRange(0, 2)
    expect(inRange).toHaveLength(1)
    expect(inRange[0]).toEqual({
      id,
      day: 1,
      title: 'Day One',
      text: 'It began.',
      citations: [3, 7],
      sceneIds: [1],
    })
    expect(store.chaptersForDay(0)).toEqual([])
    expect(store.chaptersForDay(1)).toHaveLength(1)
  })

  it('eras: chapterIds parse back', () => {
    const { store } = memStore()
    const id = store.insertEra({
      startDay: 0,
      endDay: 6,
      title: 'The First Week',
      text: 'Seven days.',
      citations: [1],
      chapterIds: [1, 2, 3],
    })
    const eras = store.eras()
    expect(eras).toEqual([
      {
        id,
        startDay: 0,
        endDay: 6,
        title: 'The First Week',
        text: 'Seven days.',
        citations: [1],
        chapterIds: [1, 2, 3],
      },
    ])
  })

  it('publications: null citations survive and kind filter works', () => {
    const { store } = memStore()
    store.insertPublication({
      day: 1,
      kind: 'newspaper',
      title: 'The Junipero Times',
      body: 'News.',
      citations: [3],
    })
    store.insertPublication({
      day: 1,
      kind: 'biography',
      title: 'Omar',
      body: 'A life.',
      citations: null,
    })
    const bios = store.publications('biography')
    expect(bios).toHaveLength(1)
    expect(bios[0]!.citations).toBeNull()
    expect(bios[0]!.kind).toBe('biography')
    const all = store.publications()
    expect(all).toHaveLength(2)
    expect(all[0]!.citations).toEqual([3])
  })
})
