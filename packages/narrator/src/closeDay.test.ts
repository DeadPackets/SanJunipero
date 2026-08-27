import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { closeDay } from './narrate.js'
import type { NarratorLlm } from './types.js'

const store = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

// The world db a biography reads: only `events`, because only `events` is public.
const worldDb = (evs: SimEvent[]): Database.Database => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
  const ins = db.prepare('INSERT INTO events (seq, tick, type, payload) VALUES (?, ?, ?, ?)')
  for (const e of evs) ins.run(e.seq, e.tick, e.type, JSON.stringify(e.payload))
  return db
}

const dayEvents = (day: number, from: number): SimEvent[] => {
  const t = day * MINUTES_PER_DAY
  return [
    { seq: from, tick: t + 10, type: 'agent_spoke', payload: { agentId: 'amara', text: 'Rain.' } },
    {
      seq: from + 1,
      tick: t + 11,
      type: 'agent_spoke',
      payload: { agentId: 'omar', text: 'Aye.' },
    },
    {
      seq: from + 2,
      tick: t + 60,
      type: 'action_completed',
      payload: { agentId: 'amara', verb: 'give', targetId: 'omar' },
    },
  ]
}

const llm = (): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({ title: 'Rain', text: 'It rained.', citations: [] })),
  summarizeEra: vi.fn(async () => ({
    title: 'The First Week',
    text: 'Seven days.',
    citations: [],
  })),
  newspaperCopy: vi.fn(),
  biography: vi.fn(async () => ({ title: 'Amara of the tally', body: 'She was seen counting.' })),
})

const CAST = [
  { id: 'amara', name: 'Amara' },
  { id: 'omar', name: 'Omar' },
]

describe('closeDay', () => {
  it('writes the chapter, the day paper, its caption and one biography', async () => {
    const s = store()
    const evs = dayEvents(0, 1)
    const model = llm()
    const chapter = await closeDay({
      store: s,
      llm: model,
      worldDb: worldDb(evs),
      events: evs,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      cast: CAST,
    })

    expect(chapter.day).toBe(0)
    expect(s.publications('newspaper')).toEqual([
      expect.objectContaining({ day: 0, title: 'Rain', kind: 'newspaper' }),
    ])
    expect(s.publications('timelapse_caption')[0]?.body).toBe('Day 0: Rain')
    // day 0 of a cast of two is the first of them, and the row says who it is about
    expect(s.publications('biography')[0]).toMatchObject({
      subjectId: 'amara',
      title: 'Amara of the tally',
    })
    expect(model.summarizeEra).not.toHaveBeenCalled()
  })

  it('is idempotent: a day closed twice publishes once', async () => {
    const s = store()
    const evs = dayEvents(0, 1)
    const model = llm()
    const args = {
      store: s,
      llm: model,
      worldDb: worldDb(evs),
      events: evs,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      cast: CAST,
    }
    await closeDay(args)
    await closeDay(args)
    expect(s.publications().length).toBe(3)
    expect(model.summarizeChapter).toHaveBeenCalledTimes(1)
  })

  it('renders the week on the seventh day and on no other', async () => {
    const s = store()
    const model = llm()
    for (let day = 0; day <= 6; day++) {
      const evs = dayEvents(day, day * 10 + 1)
      await closeDay({
        store: s,
        llm: model,
        worldDb: worldDb(evs),
        events: evs,
        rulebookCount: 0,
        privateCounts: { thoughts: 0, journals: 0 },
        cast: CAST,
      })
      expect(model.summarizeEra).toHaveBeenCalledTimes(day === 6 ? 1 : 0)
    }
    expect(s.eras()).toEqual([expect.objectContaining({ startDay: 0, endDay: 6 })])
  })

  it('keeps the day when a biography the framing law refuses cannot be written', async () => {
    const s = store()
    const evs = dayEvents(0, 1)
    const model = llm()
    // "prompt" is machinery, which no viewer-facing string may name: refused twice, then dropped.
    model.biography = vi.fn(async () => ({ title: 'Amara', body: 'She was the prompt of care.' }))
    const alert = vi.fn()
    const chapter = await closeDay({
      store: s,
      llm: model,
      worldDb: worldDb(evs),
      events: evs,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      cast: CAST,
      alert,
    })
    expect(chapter.title).toBe('Rain')
    expect(model.biography).toHaveBeenCalledTimes(2) // asked once, refused, asked again
    expect(s.publications('biography')).toEqual([])
    expect(s.publications('newspaper').length).toBe(1)
    expect(alert.mock.calls.flat().join(' ')).toContain('framing')
  })
})
