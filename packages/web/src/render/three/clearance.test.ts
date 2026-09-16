import { expect, it } from 'vitest'
import type { Structure } from '@sj/engine/state'
import { clearBody } from './clearance.js'

const house = { x: 5, y: 5, w: 2, h: 4, kind: 'house' } as Structure
it('keeps all lane centers unchanged and crowds outside solid walls', () => {
  for (let y = 5.5; y < 9; y++) {
    expect(clearBody(4.5, y, [house])).toEqual({ x: 4.5, y })
    expect(clearBody(7.5, y, [house])).toEqual({ x: 7.5, y })
    expect(clearBody(4.85, y, [house]).x).toBeCloseTo(4.52)
  }
  expect(clearBody(5.5, 9.5, [house])).toEqual({ x: 5.5, y: 9.5 })
  expect(clearBody(5.5, 6.5, [{ ...house, kind: 'bridge' }])).toEqual({ x: 5.5, y: 6.5 })
})

it('keeps bodies outside the extra ground occupied by a 3 × 3 house', () => {
  const wider = { ...house, w: 3, h: 3 }
  const body = clearBody(7.5, 6.5, [wider])
  expect(body.x).toBeCloseTo(8.48)
  expect(clearBody(6.5, 8.5, [wider])).toEqual({ x: 6.5, y: 8.5 })
})
