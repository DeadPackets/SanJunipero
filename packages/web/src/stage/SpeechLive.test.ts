import { describe, expect, it } from 'vitest'
import {
  SPEECH_LIVE_CAP,
  SPEECH_LIVE_MS,
  enqueue,
  nextLine,
  speechLine,
  type Utterance,
} from './SpeechLive.js'

const u = (name: string, text: string): Utterance => ({ name, text })

describe('every utterance is spoken, bubble or no bubble', () => {
  it('says who said it and what they said', () => {
    expect(speechLine(u('Amara', 'the iron sings today'))).toBe('Amara: the iron sings today')
  })

  it('holds a line back until the throttle has passed', () => {
    const q = [u('Amara', 'one'), u('Yusuf', 'two')]
    expect(nextLine(q, 1000, 1000 + SPEECH_LIVE_MS - 1)).toBeNull()
    expect(nextLine(q, 1000, 1000 + SPEECH_LIVE_MS)?.line).toBe('Amara: one')
  })

  it('takes one line off the front and leaves the rest waiting', () => {
    const q = [u('Amara', 'one'), u('Yusuf', 'two')]
    const due = nextLine(q, 0, SPEECH_LIVE_MS)
    expect(due?.rest).toEqual([u('Yusuf', 'two')])
    expect(q, 'the queue handed in is not written into').toHaveLength(2)
  })

  it('says nothing when nobody has spoken', () => {
    expect(nextLine([], 0, 10_000)).toBeNull()
  })

  it('drains a burst in order, one line per beat', () => {
    let q: Utterance[] = [u('A', 'one'), u('B', 'two'), u('C', 'three')]
    const said: string[] = []
    for (let t = 0; q.length > 0; t += SPEECH_LIVE_MS) {
      const due = nextLine(q, t - SPEECH_LIVE_MS, t)
      if (due === null) break
      said.push(due.line)
      q = due.rest
    }
    expect(said).toEqual(['A: one', 'B: two', 'C: three'])
  })
})

// A talkative market can out-talk 800 ms for the rest of the day. A reader minutes behind the
// town is being read a different town.
describe('the queue drops the oldest rather than falling behind forever', () => {
  it('never grows past the cap', () => {
    let q: Utterance[] = []
    for (let i = 0; i < SPEECH_LIVE_CAP * 3; i++) q = enqueue(q, u('A', String(i)))
    expect(q).toHaveLength(SPEECH_LIVE_CAP)
  })

  it('keeps the newest, which is what the town is doing now', () => {
    let q: Utterance[] = []
    for (let i = 0; i < SPEECH_LIVE_CAP + 2; i++) q = enqueue(q, u('A', String(i)))
    expect(q[q.length - 1]!.text).toBe(String(SPEECH_LIVE_CAP + 1))
    expect(q[0]!.text).toBe('2')
  })
})
