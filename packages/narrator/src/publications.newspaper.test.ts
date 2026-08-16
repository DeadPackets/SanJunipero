import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { renderNewspaper } from './publications.js'
import { FORBIDDEN_FRAMING } from './llm/framing.js'
import type { ChapterRow, HeatScores, Milestone, SceneSegment } from './types.js'

const chapter: ChapterRow = {
  id: 1, day: 1, title: 'The Argument by the Storehouse',
  text: 'Omar and Yusuf came to blows.', citations: [1, 3], sceneIds: [1, 2],
}
const heat = (total: number): HeatScores => ({ conflict: 0, novelty: 0, firsts: 0, stakes: 0, dramaticIrony: 0, total })
const heats = [heat(7.5), heat(1)]
const scenes: SceneSegment[] = [
  { day: 1, startTick: 1480, endTick: 1490, eventIds: [1, 2, 3], cast: ['omar', 'yusuf'], location: '3,4' },
  { day: 1, startTick: 1520, endTick: 1521, eventIds: [4, 5], cast: ['nadia'], location: null },
]
const milestones: Milestone[] = [
  { kind: 'first_speech', label: 'the first word spoken', eventSeq: 1, day: 1, tick: 1480 },
  { kind: 'first_trade', label: 'the first trade', eventSeq: 9, day: 2, tick: 2900 },
]

describe('renderNewspaper', () => {
  const paper = renderNewspaper(1, chapter, heats, milestones, scenes)

  it('composes headline, body, and citations from the day chapter', () => {
    expect(paper.headline).toBe('The Argument by the Storehouse')
    expect(paper.body).toContain('Omar and Yusuf came to blows.')
    expect(paper.body).toContain('the first word spoken')
    expect(paper.body).not.toContain('the first trade') // day 2 milestone excluded
    expect(paper.body).toContain('omar')
    expect(paper.body).toContain('yusuf')
    expect(paper.body).not.toContain('nadia') // only the top-heat scene's cast
    expect(paper.citations).toEqual([1, 3])
  })

  it('is framing-free', () => {
    expect(FORBIDDEN_FRAMING.test(paper.headline)).toBe(false)
    expect(FORBIDDEN_FRAMING.test(paper.body)).toBe(false)
  })

  it('persists as a newspaper publication', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    store.insertPublication({ day: 1, kind: 'newspaper', title: paper.headline, body: paper.body, citations: paper.citations })
    const rows = store.publications('newspaper')
    expect(rows.length).toBe(1)
    expect(rows[0]!.kind).toBe('newspaper')
    expect(rows[0]!.citations).toEqual([1, 3])
  })

  it('omits the cast line without scenes and the marks list without same-day milestones', () => {
    const bare = renderNewspaper(3, chapter, heats, milestones)
    expect(bare.body).toContain('Omar and Yusuf came to blows.')
    expect(bare.body).not.toContain('Marks of the day')
    expect(bare.body).not.toContain('nadia')
  })
})
