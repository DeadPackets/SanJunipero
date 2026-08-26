import { describe, expect, it } from 'vitest'
import { timelapseCaptions } from './publications.js'
import type { ChapterRow } from './types.js'

const chapters: ChapterRow[] = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  id: day,
  day,
  title: `The Tale of Day ${day}`,
  text: 'x',
  citations: [day],
  sceneIds: [],
}))

describe('timelapseCaptions', () => {
  it('emits one caption per chapter by default', () => {
    const captions = timelapseCaptions(chapters)
    expect(captions.length).toBe(7)
    expect(captions[0]).toEqual({ day: 1, caption: 'Day 1: The Tale of Day 1' })
    expect(captions[6]).toEqual({ day: 7, caption: 'Day 7: The Tale of Day 7' })
  })

  it('emits every Nth chapter with intervalDays', () => {
    const captions = timelapseCaptions(chapters, 3)
    expect(captions.map((c) => c.day)).toEqual([1, 4, 7])
  })

  it('handles empty input', () => {
    expect(timelapseCaptions([])).toEqual([])
  })
})
