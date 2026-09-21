import { expect, it } from 'vitest'
import { personHit } from './personHit.js'
it('keeps a 44px screen target even for a small resident', () => {
  expect(personHit([{ id: 'a', x: 50, y: 40, footY: 50 }], 70, 45)).toBe('a')
  expect(personHit([{ id: 'a', x: 50, y: 40, footY: 50 }], 80, 45)).toBeNull()
})
it('chooses the nearest resident with a stable tie-break in a crowd', () => {
  const people = [
    { id: 'b', x: 60, y: 10, footY: 50 },
    { id: 'a', x: 40, y: 10, footY: 50 },
  ]
  expect(personHit(people, 43, 30)).toBe('a')
  expect(personHit(people, 58, 30)).toBe('b')
  expect(personHit(people, 50, 30)).toBe('a')
  expect(personHit(people.reverse(), 50, 30)).toBe('a')
})
