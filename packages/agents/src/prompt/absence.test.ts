import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, scanForDirective } from '@sj/shared'
import { absenceLine, type Company } from './prose.js'

const DAY = MINUTES_PER_DAY
const NOW = 10 * DAY

// Three words heard is `acquaintances`, which is the first band that is not `strangers`.
const warm = (over: Partial<Company> & { name: string }): Company => ({
  lastSeenTick: NOW - DAY,
  warmth: 3,
  ...over,
})

describe('★ the person a mind has not seen', () => {
  it('says nothing while they are still about', () => {
    expect(absenceLine([warm({ name: 'Omar', lastSeenTick: NOW - DAY + 1 })], NOW)).toBe('')
  })

  it('says nothing about somebody this mind never really talked to', () => {
    expect(absenceLine([warm({ name: 'Omar', warmth: 2 })], NOW)).toBe('')
  })

  it('names them on the day, and the tie is read at the parting rather than at now', () => {
    expect(absenceLine([warm({ name: 'Omar' })], NOW)).toBe(
      'You have not seen Omar since yesterday.',
    )
    // A whole week apart: the warmth they parted on is what still counts.
    expect(absenceLine([warm({ name: 'Omar', lastSeenTick: NOW - 7 * DAY })], NOW)).toBe(
      'You have not seen Omar for 7 days.',
    )
  })

  it('★ is one line at most, and it is the one gone longest', () => {
    const line = absenceLine(
      [
        warm({ name: 'Nadia', lastSeenTick: NOW - 2 * DAY }),
        warm({ name: 'Omar', lastSeenTick: NOW - 5 * DAY }),
        warm({ name: 'Salma', lastSeenTick: NOW - 3 * DAY, warmth: 40 }),
      ],
      NOW,
    )
    expect(line.split('\n')).toHaveLength(1)
    expect(line).toBe('You have not seen Omar for 5 days.')
  })

  it('breaks a tie on warmth, then on the name', () => {
    const pair = [warm({ name: 'Nadia', warmth: 4 }), warm({ name: 'Omar', warmth: 9 })]
    expect(absenceLine(pair, NOW)).toContain('Omar')
    expect(absenceLine([warm({ name: 'Nadia' }), warm({ name: 'Omar' })], NOW)).toContain('Nadia')
  })

  it('★ hands over no remedy', () => {
    expect(scanForDirective(absenceLine([warm({ name: 'Omar' })], NOW))).toEqual([])
  })
})
