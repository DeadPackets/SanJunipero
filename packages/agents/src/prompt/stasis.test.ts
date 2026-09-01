import { describe, expect, it } from 'vitest'
import { scanForDirective } from '@sj/shared'
import { stasisLine, stillnessAt, type Stillness } from './prose.js'

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
      'You have been in this same spot for an hour; nothing has come of it.',
    )
  })

  it('names the words only when there were words', () => {
    expect(stasisLine(stand({ sinceTick: 100, spoke: true }), 160)).toBe(
      'You have been in this same spot for an hour, saying much the same things; nothing has come of it.',
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
