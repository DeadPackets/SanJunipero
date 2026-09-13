import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SimConfigSchema, makeCityTemplate } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import { buildStructure } from './structures.js'

const config = SimConfigSchema.parse({})
function structure(kind: string, overrides: Partial<Structure> = {}): Structure {
  const recipe = config.structures.recipes[kind]
  return {
    id: `test-${kind}`,
    kind,
    x: 12,
    y: 18,
    w: recipe?.w ?? 2,
    h: recipe?.h ?? 2,
    hp: 50,
    maxHp: 50,
    flammable: false,
    stage: 'complete',
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
    ...overrides,
  }
}
function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = []
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object as THREE.Mesh)
  })
  return result
}
function expectInside(group: THREE.Group, s: Structure): void {
  const bounds = new THREE.Box3().setFromObject(group)
  expect(bounds.min.x).toBeGreaterThanOrEqual(s.x - 0.00001)
  expect(bounds.max.x).toBeLessThanOrEqual(s.x + s.w + 0.00001)
  expect(bounds.min.z).toBeGreaterThanOrEqual(s.y - 0.00001)
  expect(bounds.max.z).toBeLessThanOrEqual(s.y + s.h + 0.00001)
}

describe('town structure geometry', () => {
  it('draws every authored and buildable kind inside its state footprint', () => {
    const kinds = new Set([
      ...Object.keys(config.structures.recipes),
      ...makeCityTemplate().structures.map((s) => s.kind),
    ])
    for (const kind of kinds) {
      const s = structure(kind)
      const group = buildStructure(s, config)
      expect(meshes(group).length, kind).toBeGreaterThan(0)
      expect(group.userData.pick).toEqual({ kind: 'structure', id: s.id })
      expectInside(group, s)
    }
  })

  it('turns a non-square facade onto +x without swapping its occupied world dimensions', () => {
    const s = structure('farmhouse', { facing: 'se', w: 2, h: 4 })
    const group = buildStructure(s, config)
    expectInside(group, s)
    const door = group.getObjectByName('door') as THREE.Mesh
    const position = door.getWorldPosition(new THREE.Vector3())
    expect(position.x).toBeGreaterThan(s.x + s.w - 0.6)
    expect(position.z).toBeGreaterThan(s.y + 0.4)
    expect(position.z).toBeLessThan(s.y + s.h - 0.4)
  })

  it('fills the occupied plot without putting walls beyond it', () => {
    const s = structure('house')
    const group = buildStructure(s, config)
    group.updateMatrixWorld(true)
    const walls = group.getObjectByName('wall-shell') as THREE.Group
    const bounds = new THREE.Box3().setFromObject(walls)
    const size = bounds.getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThanOrEqual(s.w * 0.93)
    expect(size.z).toBeGreaterThanOrEqual(s.h * 0.93)
    expectInside(group, s)
  })

  it('scales the fire ring to its occupied ground', () => {
    for (const size of [1, 2]) {
      const s = structure('fire_pit', { w: size, h: size })
      const group = buildStructure(s, config)
      const bounds = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
      expect(bounds.x).toBeGreaterThan(size * 0.9)
      expect(bounds.z).toBeGreaterThan(size * 0.9)
      expectInside(group, s)
    }
  })

  it('uses construction framing instead of a finished roof or lit windows', () => {
    const s = structure('cottage', { stage: 'construction', facing: 'se', w: 2, h: 3 })
    const group = buildStructure(s, config)
    expect(group.getObjectByName('scaffolding')).toBeDefined()
    expect(group.userData.roofs).toHaveLength(0)
    expect(group.userData.windows).toHaveLength(0)
    expectInside(group, s)
  })

  it('leaves lamp glass and basket edges out of the shadow map', () => {
    const group = buildStructure(structure('lamp_post'), config)
    const lantern = group.getObjectByName('lantern') as THREE.Group
    expect(meshes(lantern).length).toBeGreaterThan(3)
    expect(meshes(lantern).every((mesh) => !mesh.castShadow)).toBe(true)
    const casters = meshes(group).filter((mesh) => mesh.castShadow)
    expect(casters.length).toBeGreaterThan(0)
    for (const mesh of casters) {
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
      expect(size.x).toBeLessThanOrEqual(0.221)
      expect(size.z).toBeLessThanOrEqual(0.221)
    }
    expect(group.userData.lightHeight).toBeGreaterThan(1)
    expect(
      (group.userData.windows as THREE.MeshStandardMaterial[]).every(
        (m: THREE.MeshStandardMaterial) => m.emissiveIntensity === 0,
      ),
    ).toBe(true)
  })

  it('owns mutable materials per structure and starts fire hidden', () => {
    const first = buildStructure(structure('house'), config)
    const second = buildStructure(structure('house'), config)
    const materials = new Set(
      meshes(first).flatMap((mesh) =>
        Array.isArray(mesh.material) ? mesh.material : [mesh.material],
      ),
    )
    expect(meshes(second).every((mesh) => !materials.has(mesh.material as THREE.Material))).toBe(
      true,
    )
    const fire = buildStructure(structure('fire_pit'), config)
    expect((fire.userData.fire as THREE.Group).visible).toBe(false)
    expect(fire.userData.lightHeight).toBeGreaterThan(0)
  })

  it('distinguishes building mass, roof detail and open structures', () => {
    const house = buildStructure(structure('house'), config)
    const farm = buildStructure(structure('farmhouse'), config)
    expect(new THREE.Box3().setFromObject(farm).max.y).toBeGreaterThan(
      new THREE.Box3().setFromObject(house).max.y,
    )
    expect(farm.getObjectByName('porch')).toBeDefined()
    const roofMaterial = (house.getObjectByName('roof-slope') as THREE.Mesh)
      .material as THREE.MeshStandardMaterial
    expect(roofMaterial.map).toBeInstanceOf(THREE.DataTexture)
    for (const kind of ['market', 'civic_market', 'civic_hall', 'unknown']) {
      const s = structure(kind)
      const group = buildStructure(s, config)
      expect(meshes(group).length).toBeGreaterThan(0)
      expectInside(group, s)
    }
  })
})
