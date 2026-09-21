import { expect, it } from 'vitest'
import { personHit, personHoverPosition } from './personHit.js'
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

it('keeps the hover target inside measured top, right, and bottom bands', () => {
  const viewport = { width: 600, height: 400 }
  const label = { width: 120, height: 36 }
  const safe = { top: 80, right: 200, bottom: 90 }
  expect(personHoverPosition({ x: 550, y: 20 }, viewport, label, safe)).toEqual({ x: 332, y: 88 })
  expect(personHoverPosition({ x: 200, y: 390 }, viewport, label, safe)).toEqual({ x: 200, y: 266 })
})

it('omits a hover target when the safe view cannot fit it', () => {
  expect(
    personHoverPosition(
      { x: 200, y: 200 },
      { width: 300, height: 200 },
      { width: 120, height: 36 },
      { top: 100, right: 200, bottom: 80 },
    ),
  ).toBeNull()
})
