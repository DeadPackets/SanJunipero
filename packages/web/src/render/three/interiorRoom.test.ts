import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  SimConfigSchema,
  buildingAppearanceFor,
  buildingWindowMask,
  frontDoorFraction,
} from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import { buildInteriorRoom } from './interiorRoom.js'

const config = SimConfigSchema.parse({})

function structure(kind: string, overrides: Partial<Structure> = {}): Structure {
  return {
    id: `room-${kind}`,
    kind,
    x: 4,
    y: 7,
    w: 3,
    h: 3,
    hp: 50,
    maxHp: 50,
    flammable: true,
    stage: 'complete',
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
    facing: 'sw',
    ...overrides,
  }
}

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => undefined }),
    }),
  })
})

describe('interior appearance identity', () => {
  it('uses the same home, shop, and meeting recipes and window masks as the exterior', () => {
    for (const s of [
      structure('house', { owner: 'amara' }),
      structure('bakery'),
      structure('civic_hall'),
    ]) {
      const room = buildInteriorRoom(s, config)
      const recipe = buildingAppearanceFor(s.kind)
      const mask = buildingWindowMask(recipe, s.w, false)
      expect(room.appearance).toEqual(recipe)
      expect(room.group.userData.appearance).toEqual(recipe)
      expect(room.windowMask).toEqual(mask)
      expect(room.group.userData.windowMask).toEqual(mask)
      expect(room.entry.x).toBeCloseTo(-room.w / 2 + room.w * frontDoorFraction(s.w))
      expect(room.entry.z).toBeCloseTo(room.d / 2 - 0.45)
      expect(room.glass.emissiveIntensity).toBe(0.35)
    }
  })

  it('maps a turned entrance to the same physical door lane', () => {
    const s = structure('civic_hall', { facing: 'se', w: 3, h: 4 })
    const room = buildInteriorRoom(s, config)
    expect(room.entry.x).toBeCloseTo(room.w / 2 - 0.45)
    expect((room.entry.z + room.d / 2) / room.d).toBeCloseTo(frontDoorFraction(s.h))
    expect(room.windowMask).toEqual(buildingWindowMask(buildingAppearanceFor(s.kind), s.h, true))
  })

  it('retains the fallback identity while window lighting changes', () => {
    const room = buildInteriorRoom(structure('observatory'), config)
    expect(room.appearance.use).toBe('generic')
    room.glass.emissiveIntensity = 0
    expect(room.appearance.use).toBe('generic')
    room.glass.emissiveIntensity = 0.3
    expect(room.group.userData.windowMask).toEqual(room.windowMask)
  })
})
