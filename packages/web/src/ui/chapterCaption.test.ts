import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { captionFor, chapterIndex, type Chapter } from './chapterCaption.js'
import { CUE_TYPES, bodiesOf, cueFor } from './stageCue.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const DAY: Chapter = {
  day: 2,
  title: 'The Wall',
  text: 'Omar raised the wall by the storehouse.\n\nBy evening the quarrel had gone quiet.',
  seen: [
    [1, 2],
    [4, 5],
  ],
}

// ★ A hundred views of one moment must not be a hundred LLM calls, and a caption that arrives
// 3–10 s late is a caption for the wrong minute. The narrator has already written the day.
describe('★ the caption is the narrator’s own voice, at zero calls', () => {
  it('★ maps every cited seq to the paragraph that cited it', () => {
    const index = chapterIndex([DAY])
    expect(index.get(1)).toBe('Omar raised the wall by the storehouse.')
    expect(index.get(2)).toBe('Omar raised the wall by the storehouse.')
    expect(index.get(4)).toBe('By evening the quarrel had gone quiet.')
    expect(index.get(3)).toBeUndefined()
  })

  it('★ captions a replayed run off the seqs it is actually walking', () => {
    const index = chapterIndex([DAY])
    expect(captionFor(index, [{ seq: 4 }])).toBe('By evening the quarrel had gone quiet.')
    expect(captionFor(index, [{ seq: 3 }, { seq: 1 }])).toBe(
      'Omar raised the wall by the storehouse.',
    )
    expect(captionFor(index, [{ seq: 99 }])).toBeNull()
    expect(captionFor(index, [])).toBeNull()
  })

  it('holds a seq to the first paragraph that claimed it, so a caption cannot flicker', () => {
    const twice: Chapter = { ...DAY, seen: [[1], [1]] }
    expect(chapterIndex([twice]).get(1)).toBe('Omar raised the wall by the storehouse.')
  })

  it('answers nothing at all for a day the narrator has not written', () => {
    expect(chapterIndex([]).size).toBe(0)
    expect(chapterIndex([{ day: 0, title: 'x', text: 'y' }]).size).toBe(0)
    expect(chapterIndex([{ day: 0, title: 'x', text: '', seen: [[1]] }]).size).toBe(0)
  })

  it('★ NO per-view narration, ever: it scales with viewers rather than with residents', () => {
    const scene = src('../stage/ReplayScene.tsx')
    expect(scene).not.toMatch(/generate|complete|llm|prompt/i)
    // the chapters are already on the wire for the Chapters tab; the replay reads the same feed
    expect(scene).toContain('useFeed(chaptersFeed)')
  })

  it('★ the footnotes that carry the mapping are never rendered to a reader', () => {
    const api = src('../../../gateway/src/narratorApi.ts')
    expect(api).toContain('stripFootnotes(p)')
    expect(api).toContain('footnoteSeqs(p)')
    expect(src('../paper/pages/Chronicle.tsx')).not.toContain('Seen:')
  })
})

// ★ Five kinds of moment a replay is most often OF said nothing at all while it played.
describe('★ the cue speaks for a death, a birth, a build, a night kept and an arrival', () => {
  it('★ prints all five, and every one off a chronicle line the town already had', () => {
    for (const t of ['agent_died', 'agent_born', 'structure_completed', 'co_slept'])
      expect(CUE_TYPES, t).toContain(t)
    expect(CUE_TYPES).toContain('agent_spawned')
  })

  const ev = (type: string, payload: unknown) => ({ seq: 1, tick: 5, type, payload })
  const state = {
    agents: { a1: { id: 'a1', name: 'Rahel' }, a2: { id: 'a2', name: 'Tomas' } },
    structures: { s1: { kind: 'house' } },
  } as unknown as Parameters<typeof cueFor>[1]

  it('says a death, a birth and a finished house in the town’s own words', () => {
    expect(cueFor(ev('agent_died', { agentId: 'a1', cause: 'hunger' }), state)?.text).toBe(
      'Rahel starved.',
    )
    expect(cueFor(ev('agent_born', { id: 'a2', name: 'Tomas', motherId: 'a1' }), state)?.text).toBe(
      'Tomas was born.',
    )
    expect(cueFor(ev('structure_completed', { id: 's1' }), state)?.text).toBe(
      'The house is finished.',
    )
  })

  it('★ says an arrival, which the chronicle leaves out — the founding is not news', () => {
    const spawn = ev('agent_spawned', { id: 'a9', name: 'Nadia', x: 1, y: 1, ageDays: 20 })
    expect(cueFor(spawn, state)?.text).toBe('Nadia came to the town.')
    expect(cueFor(ev('agent_spawned', { id: 'a9' }), state)).toBeNull()
  })

  it('★ the pixel rises off the right head: `id` is the person only where it IS one', () => {
    expect(bodiesOf(ev('agent_born', { id: 'a2', motherId: 'a1' }))).toEqual(['a2', 'a1'])
    expect(bodiesOf(ev('agent_spawned', { id: 'a9', name: 'Nadia' }))).toEqual(['a9'])
    // a finished building's `id` is the BUILDING, and no pixel may rise off it
    expect(bodiesOf(ev('structure_completed', { id: 's1' }))).toEqual([])
    expect(bodiesOf(ev('agent_died', { agentId: 'a1', byId: 'a2' }))).toEqual(['a1', 'a2'])
    expect(bodiesOf(ev('co_slept', { aId: 'a1', bId: 'a1' }))).toEqual(['a1'])
  })
})
