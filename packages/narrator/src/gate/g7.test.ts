import { beforeAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { openDb } from '@sj/engine'
import { EVENTFUL_DAY } from '../fixtures/eventfulDay.js'
import { renderChapter } from '../chronicle.js'
import { rankScenesForDirector } from '../heat.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import { narrateDay, narrateWeek, renderDigest } from '../narrate.js'
import { renderNewspaper, timelapseCaptions, writeBiography } from '../publications.js'
import { migrateNarratorTables } from '../schema.js'
import { NarratorStore } from '../store.js'
import type { ChapterRow, HeatScores, Milestone, NarratorLlm, SceneSegment } from '../types.js'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

// The scripted NarratorLlm (no OpenRouter): summarizeChapter cites one dangling
// 9999 so the render-layer hallucination guard is exercised at the gate.
const gateLlm = (chapterCitations: number[]): NarratorLlm =>
  ({
    summarizeChapter: vi.fn(async () => ({
      title: 'The Quarrel at the Wall',
      text: 'Omar and Yusuf traded hard words at the wall, and by evening a first gift changed hands.',
      citations: chapterCitations,
    })),
    summarizeEra: vi.fn(async () => ({
      title: 'The First Days',
      text: 'A week that opened with quarrels and closed with a gift.',
      citations: [],
    })),
    newspaperCopy: vi.fn(),
    biography: vi.fn(async () => ({
      title: 'Omar of the Wall',
      body: 'Omar was heard at the wall by midday and seen to give before nightfall.',
    })),
  }) as unknown as NarratorLlm

describe('GATE G7 — recorded eventful day replays to a verified chronicle', () => {
  const store = memStore()
  const alert = vi.fn()
  const seqs = new Set(EVENTFUL_DAY.map((e) => e.seq))
  let chapter: ChapterRow
  let heat: HeatScores[]
  let milestones: Milestone[]
  let scenes: Array<SceneSegment & { id: number }>

  beforeAll(async () => {
    const out = await narrateDay({
      store,
      llm: gateLlm([4, 9, 10, 9999]),
      events: EVENTFUL_DAY,
      rulebookCount: 0,
      privateCounts: { thoughts: 2, journals: 1 },
      alert,
    })
    chapter = out.chapter
    heat = out.heat
    milestones = out.milestones
    scenes = store.scenesForDay(0)
  })

  it('1. chapters resolve: every persisted citation is a real event seq; 9999 stripped with one alert', () => {
    expect(chapter.citations.length).toBeGreaterThan(0)
    expect(chapter.citations.every((c) => seqs.has(c))).toBe(true)
    expect(chapter.citations).not.toContain(9999)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(String(alert.mock.calls[0]![0])).toContain('9999')
    const persisted = store.chaptersForDay(0)
    expect(persisted.length).toBe(1)
    expect(persisted[0]!.citations).toEqual(chapter.citations)
  })

  it('2. director follows the argument over the idle', () => {
    expect(scenes.length).toBe(3)
    const idleIdx = scenes.findIndex((s) => s.eventIds.includes(1))
    const argueIdx = scenes.findIndex((s) => s.eventIds.includes(4))
    const tradeIdx = scenes.findIndex((s) => s.eventIds.includes(10))
    const ranking = rankScenesForDirector(scenes, heat)
    expect(ranking[0]!.sceneIndex).toBe(argueIdx)
    expect(ranking[0]!.sceneIndex).not.toBe(idleIdx)
    expect(heat[argueIdx]!.total).toBeGreaterThan(heat[idleIdx]!.total)
    expect(heat[argueIdx]!.total).toBeGreaterThan(heat[tradeIdx]!.total)
    expect(heat[tradeIdx]!.total).toBeGreaterThan(heat[idleIdx]!.total)
  })

  it('3. firsts: first_speech and first_trade in the milestone ledger, each citing a real seq', () => {
    const ledger = store.milestones()
    const speech = ledger.find((m) => m.kind === 'first_speech')
    const trade = ledger.find((m) => m.kind === 'first_trade')
    expect(speech).toBeDefined()
    expect(trade).toBeDefined()
    expect(seqs.has(speech!.eventSeq)).toBe(true)
    expect(seqs.has(trade!.eventSeq)).toBe(true)
    expect(milestones.map((m) => m.kind)).toContain('first_speech')
  })

  it('4. digest for a 3-day absence: while-you-were-away headline, exactly 3 day bullets', async () => {
    for (const day of [1, 2, 3]) {
      const scene: SceneSegment = {
        day,
        startTick: day * 1440,
        endTick: day * 1440 + 1,
        eventIds: [100 + day],
        cast: ['omar'],
        location: null,
      }
      const llm = {
        ...gateLlm([100 + day]),
        summarizeChapter: vi.fn(async () => ({
          title: `The Quiet Work of Day ${day}`,
          text: 'The settlement kept its small routines.',
          citations: [100 + day],
        })),
      } as unknown as NarratorLlm
      await renderChapter({ store, llm, day, scenes: [scene] })
    }
    const digest = renderDigest(0, 3, store.chaptersInRange(1, 3))
    expect(digest.headline).toMatch(/while you were away/i)
    const bullets = digest.body.split('\n').filter((l) => l.startsWith('- '))
    expect(bullets.length).toBe(3)
  })

  it('5. framing: every persisted chapter/era/newspaper/biography/caption string is framing-free', async () => {
    await narrateWeek({ store, llm: gateLlm([]), days: [chapter], validEventIds: EVENTFUL_DAY.map((e) => e.seq) })

    const paper = renderNewspaper(0, chapter, heat, milestones, scenes)
    store.insertPublication({ day: 0, kind: 'newspaper', title: paper.headline, body: paper.body, citations: paper.citations })

    const world = openDb(':memory:')
    const ins = world.prepare('INSERT INTO events (seq, tick, type, payload) VALUES (?, ?, ?, ?)')
    for (const e of EVENTFUL_DAY) ins.run(e.seq, e.tick, e.type, JSON.stringify(e.payload))
    await writeBiography({ store, llm: gateLlm([]), world, agentId: 'omar', name: 'Omar', throughDay: 0 })

    for (const c of timelapseCaptions(store.chaptersInRange(0, 3))) {
      store.insertPublication({ day: c.day, kind: 'timelapse_caption', title: `Day ${c.day}`, body: c.caption, citations: [] })
    }

    const strings: string[] = []
    for (const c of store.chaptersInRange(0, 3)) strings.push(c.title, c.text)
    for (const e of store.eras()) strings.push(e.title, e.text)
    for (const p of store.publications()) strings.push(p.title, p.body)
    expect(store.eras().length).toBeGreaterThan(0)
    expect(store.publications('newspaper').length).toBe(1)
    expect(store.publications('biography').length).toBe(1)
    expect(store.publications('timelapse_caption').length).toBe(4)
    expect(strings.length).toBeGreaterThan(0)
    for (const s of strings) expect(s).not.toMatch(FORBIDDEN_FRAMING)
  })
})
