import { describe, it, expect } from 'vitest'
import type { WorldState } from '@sj/engine'
import { GAMIFICATION_BAN } from '../ui/townStats.js'
import {
  LANDMARK_LABEL_PX, LANDMARK_SHOW_BELOW_SCALE, SILHOUETTE_RANK, TOWN_KINDS,
  landmarkAlpha, landmarksOf,
} from './landmarks.js'

type S = { id: string; kind: string; x: number; y: number; w: number; h: number; stage: string }

const stand = (id: string, kind: string, x: number, y: number, w = 1, h = 1): S =>
  ({ id, kind, x, y, w, h, stage: 'complete' })

// The Task-59 town, in world coordinates at the showcase anchor {x:0,y:9}.
const TOWN: S[] = [
  stand('structure_hut_14_13', 'hut', 14, 13, 2, 2),
  stand('structure_hut_18_13', 'hut', 18, 13, 2, 2),
  stand('structure_hut_22_13', 'hut', 22, 13, 2, 2),
  stand('structure_hut_19_16', 'hut', 19, 16, 2, 2),
  stand('structure_hut_23_16', 'hut', 23, 16, 2, 2),
  stand('structure_storehouse_13_21', 'storehouse', 13, 21, 2, 2),
  stand('structure_shed_18_26', 'shed', 18, 26),
  stand('structure_shed_27_30', 'shed', 27, 30),
  stand('structure_well_17_21', 'well', 17, 21),
  stand('structure_fire_pit_17_25', 'fire_pit', 17, 25),
  stand('structure_wagon_5_25', 'wagon', 5, 25, 1, 2),
]

const worldOf = (list: S[]): WorldState =>
  ({ structures: Object.fromEntries(list.map((s) => [s.id, s])) }) as unknown as WorldState

const town = landmarksOf(worldOf(TOWN))

describe('landmarksOf', () => {
  it('names the fire pit as the single centre of the town', () => {
    const first = town.filter((l) => l.rank === 1)
    expect(first).toHaveLength(1)
    expect(first[0]!.name).toBe('the fire pit')
    expect(first[0]!.x).toBe(17)
    expect(first[0]!.y).toBe(25)
  })

  it('anchors every district that has a building, and no district that does not', () => {
    const second = town.filter((l) => l.rank === 2)
    expect(second.map((l) => l.name).sort())
      .toEqual(['the fields', 'the houses', 'the landing', 'the square'])
    const noFarm = landmarksOf(worldOf(TOWN.filter((s) => s.kind !== 'shed')))
    expect(noFarm.some((l) => l.name === 'the fields')).toBe(false)
  })

  it('points out the notable single buildings', () => {
    const third = town.filter((l) => l.rank === 3).map((l) => l.name).sort()
    expect(third).toEqual(['the storehouse', 'the well'])
  })

  it('says nothing about an empty world', () => {
    expect(landmarksOf(worldOf([]))).toEqual([])
  })

  it('ignores a building that is not finished', () => {
    const half = TOWN.map((s) => s.kind === 'fire_pit' ? { ...s, stage: 'construction' } : s)
    expect(landmarksOf(worldOf(half)).some((l) => l.rank === 1)).toBe(false)
  })

  it('is deterministic and sorted by rank then id', () => {
    expect(landmarksOf(worldOf(TOWN))).toEqual(town)
    expect(landmarksOf(worldOf([...TOWN].reverse()))).toEqual(town)
    const order = town.map((l) => `${l.rank}|${l.id}`)
    expect(order).toEqual([...order].sort())
  })

  it('speaks like a person — no machine vocabulary and no game vocabulary', () => {
    for (const l of town) {
      expect(l.name, l.id).not.toMatch(GAMIFICATION_BAN)
      expect(l.name, l.id).not.toContain('structure_')
      expect(l.name, l.id).not.toContain('_')
      expect(l.name, l.id).toMatch(/^[a-z ]+$/)
    }
  })
})

describe('landmarkAlpha', () => {
  it('is a map legend at the widest view and gone on the way in', () => {
    expect(landmarkAlpha(0.5)).toBe(1)
    expect(landmarkAlpha(LANDMARK_SHOW_BELOW_SCALE)).toBe(0)
    expect(landmarkAlpha(4)).toBe(0)
  })

  it('never rises as you zoom in', () => {
    let prev = Infinity
    for (let s = 0.5; s <= 4; s += 0.05) {
      const a = landmarkAlpha(s)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      prev = a
    }
  })
})

describe('SILHOUETTE_RANK', () => {
  it('covers every kind the town can stand', () => {
    for (const k of TOWN_KINDS) expect(SILHOUETTE_RANK[k], k).toBeTypeOf('number')
    expect(new Set(TOWN_KINDS).size).toBe(TOWN_KINDS.length)
  })

  it('reads a public building heavier than a dwelling', () => {
    expect(SILHOUETTE_RANK['fire_pit']).toBeLessThan(SILHOUETTE_RANK['hut'])
    expect(SILHOUETTE_RANK['storehouse']).toBeLessThan(SILHOUETTE_RANK['hut'])
    expect(SILHOUETTE_RANK['well']).toBeLessThan(SILHOUETTE_RANK['hut'])
  })
})

describe('the label type floor', () => {
  it('never draws a label below the 12px chrome floor', () => {
    expect(LANDMARK_LABEL_PX).toBeGreaterThanOrEqual(12)
  })
})
