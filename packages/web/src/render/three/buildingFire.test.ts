import { assert, describe, expect, it } from 'vitest'
import { Box3, Group, Mesh, Vector3 } from 'three'
import { DEFAULT_CONFIG } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import { buildStructure } from './structures.js'
import { syncBuildingFire } from './buildingFire.js'
import { disposeGroup } from './dispose.js'

function building(overrides: Partial<Structure> = {}): Structure {
  return {
    id: 'burning-house',
    kind: 'house',
    x: 12,
    y: 18,
    w: 3,
    h: 3,
    hp: 50,
    maxHp: 50,
    flammable: true,
    stage: 'complete',
    progressTicks: 0,
    builtBy: null,
    burning: true,
    burnTicks: 1,
    ...overrides,
  }
}

describe('burning building geometry', () => {
  it.each([
    { kind: 'house', w: 3, h: 3 },
    { kind: 'farmhouse', w: 3, h: 5, facing: 'se' as const },
    { kind: 'house', w: 8, h: 6 },
  ])('keeps flames visible above the roof across $kind $w by $h', (fixture) => {
    const s = building(fixture)
    const group = buildStructure(s, DEFAULT_CONFIG)
    const roofTop = new Box3().setFromObject(group).max.y
    const fire = syncBuildingFire(group, s, 0)
    assert(fire)
    group.updateWorldMatrix(true, true)
    const flames = fire.children.filter((part) => part.name === 'flame')
    expect(flames.length).toBeGreaterThan(0)
    const bounds = new Box3()
    for (const flame of flames) bounds.union(new Box3().setFromObject(flame))
    const size = bounds.getSize(new Vector3())
    expect(bounds.max.y).toBeGreaterThan(roofTop + 0.6)
    expect(size.x).toBeGreaterThan(s.w * 0.55)
    expect(size.z).toBeGreaterThan(s.h * 0.55)
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(s.x + s.w / 2, 0)
    expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(s.y + s.h / 2, 0)
    const smoke = fire.children.filter((part) => part.name === 'smoke')
    expect(smoke.length).toBeGreaterThan(0)
    expect(Math.max(...smoke.map((part) => new Box3().setFromObject(part).max.y))).toBeGreaterThan(
      bounds.max.y,
    )
    expect(fire.children.length).toBeLessThanOrEqual(20)
    disposeGroup(group)
  })

  it('reuses the effect and freezes it when its animation clock stops', () => {
    const s = building()
    const group = buildStructure(s, DEFAULT_CONFIG)
    const fire = syncBuildingFire(group, s, 2)
    assert(fire)
    const poses = () => fire.children.map((part) => [...part.position, ...part.scale])
    const before = poses()
    expect(syncBuildingFire(group, s, 2)).toBe(fire)
    expect(poses()).toEqual(before)
    syncBuildingFire(group, s, 3)
    expect(poses()).not.toEqual(before)
    expect(group.children.filter((part) => part === fire)).toHaveLength(1)
    disposeGroup(group)
  })

  it('disposes extinguished flames and recreates them at the same roof height', () => {
    const s = building()
    const group = buildStructure(s, DEFAULT_CONFIG)
    const fire = syncBuildingFire(group, s, 0)
    assert(fire)
    const resources = new Set<unknown>()
    const disposed = new Set<unknown>()
    fire.traverse((part) => {
      if (!(part instanceof Mesh)) return
      const mesh = part as Mesh
      resources.add(mesh.geometry)
      mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry))
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        resources.add(material)
        material.addEventListener('dispose', () => disposed.add(material))
      }
    })
    s.burning = false
    expect(syncBuildingFire(group, s, 1) === undefined).toBe(true)
    expect(fire.parent).toBeNull()
    expect(disposed.size).toBe(resources.size)
    s.burning = true
    const relit = syncBuildingFire(group, s, 2)
    assert(relit)
    expect(relit).not.toBe(fire)
    const fresh = buildStructure(s, DEFAULT_CONFIG)
    const freshFire = syncBuildingFire(fresh, s, 2)
    assert(freshFire)
    group.updateWorldMatrix(true, true)
    fresh.updateWorldMatrix(true, true)
    expect(new Box3().setFromObject(relit).max.y).toBeCloseTo(
      new Box3().setFromObject(freshFire).max.y,
    )
    disposeGroup(fresh)
    disposeGroup(group)
  })

  it('leaves a normal fire pit and unburned building unchanged', () => {
    for (const kind of ['fire_pit', 'house']) {
      const s = building({ kind, burning: false })
      const group = buildStructure(s, DEFAULT_CONFIG)
      const previous = [...group.children]
      const fire = group.userData.fire as Group | undefined
      expect(syncBuildingFire(group, s, 0) === undefined).toBe(true)
      expect(group.children).toEqual(previous)
      expect(group.userData.fire).toBe(fire)
      if (fire) expect(fire.visible).toBe(false)
      disposeGroup(group)
    }
  })
})
