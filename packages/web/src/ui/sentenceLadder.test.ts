import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import {
  LADDER_RECENT_TICKS,
  ladderLine,
  remember,
  type Ledger,
  type LadderSource,
} from './sentenceLadder.js'

const BEAT = 'Amara would not let it go and Salma walked off.'
const SUMMARY = 'They argued over the well until one of them left.'
const CHRONICLE = 'Salma and Amara fell out.'
const CHAPTER = 'The week the well ran thin'

const ledger = (): Ledger => new Map<string, number>()

describe('the sentence ladder', () => {
  // Each rung has to be reachable by a row that could really arrive, or the rung is decoration.
  it('reaches every rung in order as the one above it empties', () => {
    const full: LadderSource = {
      beat: BEAT,
      summary: SUMMARY,
      proseTick: 100,
      chronicle: CHRONICLE,
      chapter: CHAPTER,
      cast: ['Amara', 'Salma'],
      terms: ['quarrel', 'slight'],
    }
    const at = (src: LadderSource) => ladderLine(src, 100, ledger())
    expect(at(full)).toMatchObject({ rung: 'beat', text: BEAT })
    expect(at({ ...full, beat: undefined })).toMatchObject({ rung: 'summary', text: SUMMARY })
    expect(at({ ...full, beat: undefined, summary: undefined })).toMatchObject({
      rung: 'chronicle',
      text: CHRONICLE,
    })
    expect(at({ chapter: CHAPTER, chronicle: null })).toMatchObject({
      rung: 'chapter',
      text: CHAPTER,
    })
    expect(at({ cast: ['Amara', 'Salma'], terms: ['quarrel', 'slight'] })).toEqual({
      rung: 'why',
      text: 'Amara & Salma: falling out, a slight',
      ageTicks: 0,
      stale: false,
    })
  })

  // The fixed vocabulary is the camera's stated reason. A story never takes its title from it,
  // so a source with no cast and no terms says nothing at all rather than saying a phrase.
  it('says nothing when only a thread source is left', () => {
    expect(ladderLine({ beat: '  ', chronicle: null, chapter: null }, 10, ledger())).toBeNull()
  })

  it('drops a rung when the line above was said in the last twenty minutes', () => {
    const led = ledger()
    const src: LadderSource = { beat: BEAT, summary: SUMMARY }
    const first = ladderLine(src, 200, led)
    expect(first?.rung).toBe('beat')
    remember(led, first, 200)

    expect(ladderLine(src, 200 + LADDER_RECENT_TICKS - 1, led)?.rung).toBe('summary')
    // and once the window has passed the town's best line comes back
    expect(ladderLine(src, 200 + LADDER_RECENT_TICKS, led)?.rung).toBe('beat')
  })

  it('falls all the way through when every rung has already been said', () => {
    const led = ledger()
    const src: LadderSource = { beat: BEAT, summary: SUMMARY }
    remember(led, ladderLine(src, 10, led), 10)
    remember(led, ladderLine(src, 10, led), 10)
    expect(ladderLine(src, 10, led)).toBeNull()
  })

  // 22% of renders on a real log carry a line more than a sim-day old. Dropping it would hand
  // the biggest type on screen back to the 24 fixed phrases, so it is marked and kept.
  it('keeps a stale line and marks it', () => {
    const src: LadderSource = { beat: BEAT, proseTick: 10 }
    expect(ladderLine(src, 10 + MINUTES_PER_DAY, ledger())).toEqual({
      text: BEAT,
      rung: 'beat',
      ageTicks: MINUTES_PER_DAY,
      stale: true,
    })
    expect(ladderLine(src, 10 + MINUTES_PER_DAY - 1, ledger())?.stale).toBe(false)
  })

  it('ages only the town prose, and never below zero', () => {
    expect(ladderLine({ chapter: CHAPTER, proseTick: 10 }, 9999, ledger())?.ageTicks).toBe(0)
    // a scrub can stand the clock behind the tick the line was written on
    expect(ladderLine({ beat: BEAT, proseTick: 400 }, 10, ledger())?.ageTicks).toBe(0)
  })

  it('forgets what it can no longer block', () => {
    const led = ledger()
    remember(led, ladderLine({ beat: BEAT }, 1, led), 1)
    remember(
      led,
      ladderLine({ summary: SUMMARY }, 1 + LADDER_RECENT_TICKS, led),
      1 + LADDER_RECENT_TICKS,
    )
    expect([...led.keys()]).toEqual([SUMMARY])
  })
})
