import { describe, expect, it } from 'vitest'
import { scanForDirective } from '@sj/shared'
import { quietMeadowPacket } from '../testutil/fixtures.js'
import {
  bedtimeLine,
  repeatedActLine,
  silentTurnsLine,
  stasisLine,
  stillnessAt,
  type Stillness,
  wordToTheAirLine,
} from './prose.js'

const stand = (over: Partial<Stillness> = {}): Stillness => ({
  x: 10,
  y: 10,
  sinceTick: 0,
  spoke: false,
  ...over,
})

describe('how long a body has been standing in the same spot', () => {
  it('a fresh anchor starts the count where the feet are', () => {
    expect(stillnessAt(null, 10, 10, 400)).toEqual({ x: 10, y: 10, sinceTick: 400, spoke: false })
  })

  it('two tiles either way is the same spot, and the count carries on', () => {
    const was = stand({ sinceTick: 100, spoke: true })
    expect(stillnessAt(was, 12, 8, 160)).toBe(was)
    expect(stillnessAt(was, 8, 12, 160)).toBe(was)
  })

  it('a third tile is a walk that went somewhere, and the count starts again', () => {
    const was = stand({ sinceTick: 100, spoke: true })
    expect(stillnessAt(was, 13, 10, 160)).toEqual({ x: 13, y: 10, sinceTick: 160, spoke: false })
    expect(stillnessAt(was, 10, 7, 160)).toEqual({ x: 10, y: 7, sinceTick: 160, spoke: false })
  })
})

describe('★ the line an hour of standing still earns', () => {
  it('says nothing at all under the hour', () => {
    expect(stasisLine(null, 10_000)).toBe('')
    expect(stasisLine(stand({ sinceTick: 100 }), 159)).toBe('')
  })

  it('lands on the sixtieth tick and names the hour', () => {
    expect(stasisLine(stand({ sinceTick: 100 }), 160)).toBe(
      'You have been in this same spot for an hour. Nothing has come of it.',
    )
  })

  it('names the words only when there were words', () => {
    expect(stasisLine(stand({ sinceTick: 100, spoke: true }), 160)).toBe(
      'You have been in this same spot for an hour, saying much the same things. Nothing has come of it.',
    )
  })

  it('escalates once at three hours and no further', () => {
    expect(stasisLine(stand({ sinceTick: 100 }), 279)).toContain('for an hour')
    expect(stasisLine(stand({ sinceTick: 100 }), 280)).toContain('for half the morning')
    expect(stasisLine(stand({ sinceTick: 100 }), 2_000)).toContain('for half the morning')
  })

  // A fact about where the body has been. What to do about it is the mind's to work out.
  it('★ hands over no remedy', () => {
    const line = stasisLine(stand({ sinceTick: 0, spoke: true }), 300)
    expect(scanForDirective(line)).toEqual([])
    expect(line).not.toMatch(/\byou (should|must|could|might)\b/i)
  })
})

describe('bedtimeLine', () => {
  const at = (hour: number, asleep = false) => ({
    ...quietMeadowPacket,
    time: { ...quietMeadowPacket.time, hour, isNight: hour >= 20 || hour < 6 },
    self: { ...quietMeadowPacket.self, asleep },
  })

  it('★ says the body is up past its hour, and names no clock for it to read out', () => {
    expect(bedtimeLine(at(21), 22, 6)).toBe('')
    expect(bedtimeLine(at(22), 22, 6)).toBe('You are usually in bed by about now.')
    expect(bedtimeLine(at(23), 22, 6)).toBe('You are past your usual hour for bed.')
    expect(bedtimeLine(at(2), 22, 6)).toBe(
      'You are hours past the time you usually turn in, and your body knows it.',
    )
    expect(bedtimeLine(at(2, true), 22, 6)).toBe('')
    expect(bedtimeLine(at(14), 22, 6)).toBe('')
    for (const hour of [22, 23, 0, 2]) expect(bedtimeLine(at(hour), 22, 6)).not.toMatch(/\d/)
  })

  it('★ no bed hour in the cast is handed a clock reading to say out loud', () => {
    // r38: Farida and Halim both turn in at 21:00, were both handed "It is past 21:00", and both
    // said "it is past nine" that night. The line says how the body feels, and names no number.
    for (const bed of [20, 21, 22, 23, 24]) {
      for (const hour of [20, 21, 22, 23, 0, 1, 2, 3, 4, 5]) {
        expect(bedtimeLine(at(hour), bed, 6)).not.toMatch(/\d/)
      }
    }
    expect(bedtimeLine(at(1), 24, 9)).toBe('You are past your usual hour for bed.')
  })
})

// r35: Leyla "let him answer" for four boredom turns in a row, three hours at one call each.
describe('★ turns that ended in a wait', () => {
  it('says nothing after one wait, and speaks after two', () => {
    expect(silentTurnsLine(0)).toBe('')
    expect(silentTurnsLine(1)).toBe('')
    expect(silentTurnsLine(2)).toBe(
      'Twice now you have chosen to wait, and nothing came of it. Nobody can see you waiting.',
    )
    expect(silentTurnsLine(4)).toMatch(/^Again and again now you have chosen to wait/)
  })
  it('carries no directive and no semicolon', () => {
    expect(scanForDirective(silentTurnsLine(3))).toEqual([])
    expect(silentTurnsLine(3)).not.toContain(';')
  })
})

// r35: Kamal carried out "scratch record into wood" eleven times in a day, "nearly done" each time.
describe('★ a minted routine done again and again', () => {
  it('is named from the third time, with the count as a word', () => {
    expect(repeatedActLine(null)).toBe('')
    expect(repeatedActLine({ name: 'scratch record into wood', n: 2 })).toBe('')
    expect(repeatedActLine({ name: 'scratch record into wood', n: 3 })).toBe(
      'You have carried out "scratch record into wood" three times today already.',
    )
    expect(repeatedActLine({ name: 'scratch record into wood', n: 11 })).toBe(
      'You have carried out "scratch record into wood" 11 times today already.',
    )
    expect(scanForDirective(repeatedActLine({ name: 'lay hearth wood', n: 4 }))).toEqual([])
  })
})

// r36: a question asked beside somebody, with nobody's name on it, opened no talk, and the asker
// waited four hours for an answer that had no way to come.
describe('★ a word that opened no talk', () => {
  it('says whether nobody heard it or nobody took it up', () => {
    expect(wordToTheAirLine(null)).toBe('')
    expect(wordToTheAirLine({ heardBy: 0 })).toBe(
      'What you last said, nobody was near enough to hear.',
    )
    expect(wordToTheAirLine({ heardBy: 2 })).toBe(
      "What you last said went to the air, and nobody took it up. A word with somebody's name on it gets an answer.",
    )
    expect(scanForDirective(wordToTheAirLine({ heardBy: 2 }))).toEqual([])
  })
})
