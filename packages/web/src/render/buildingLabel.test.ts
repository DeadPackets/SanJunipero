// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import { buildingLabel, createBuildingLabel } from './buildingLabel.js'

const house = {
  id: 'house',
  kind: 'house',
  name: 'Omar’s house',
  stage: 'complete',
  owner: 'omar',
  progressTicks: 0,
} as Structure

describe('approved building labels', () => {
  it('distinguishes public buildings from private ones without repeating ownership', () => {
    expect(buildingLabel(house, DEFAULT_CONFIG)).toEqual({
      name: 'Omar’s house',
      kind: 'private',
      icon: 2,
      detail: '',
    })
    const { owner: _owner, ...publicHouse } = house
    expect(buildingLabel(publicHouse, DEFAULT_CONFIG)).toMatchObject({ kind: 'public', icon: 11 })
  })
  it('uses real construction duration and caps progress', () => {
    const construction = {
      ...house,
      stage: 'construction' as const,
      progressTicks: DEFAULT_CONFIG.structures.recipes.house!.durationTicks / 2,
    }
    expect(buildingLabel(construction, DEFAULT_CONFIG)).toMatchObject({
      kind: 'construction',
      icon: 5,
      detail: 'Under construction · 50%',
    })
    expect(buildingLabel({ ...construction, progressTicks: 1e9 }, DEFAULT_CONFIG).detail).toBe(
      'Under construction · 100%',
    )
  })
  it('clears the hover label and treats names as text', () => {
    const root = document.createElement('div')
    const label = createBuildingLabel(root)
    label.show({ ...house, name: '<img src=x>' }, DEFAULT_CONFIG, 100, 100, 390, 844)
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe('<img src=x>')
    label.hide()
    expect(root.querySelector<HTMLElement>('.building-hover-label')?.hidden).toBe(true)
    label.destroy()
    expect(root.childElementCount).toBe(0)
  })
})
