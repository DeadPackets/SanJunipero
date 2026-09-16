import { isBeddedKind, isHearthKind, roomCapacity, type SimConfig } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { PERSONAL_HOMES } from './personalHomes.js'

export function buildInteriorRoom(s: Structure, config: SimConfig) {
  const group = new Group()
  const profile = PERSONAL_HOMES[s.owner ?? '']
  const w = Math.max(6, s.w * 2.6),
    d = Math.max(6, s.h * 2.6)
  const wallHeight = 2.8
  const beds: Vector3[] = []
  const bedrolls: Group[] = []
  const obstacles: { x: number; z: number; w: number; d: number }[] = []
  const material = (color: number) => new MeshStandardMaterial({ color, roughness: 0.94 })
  const wood = material(0x977450),
    darkWood = material(0x65503c)
  const wall = material(profile?.wall ?? 0xdfd6bd),
    trim = material(profile?.trim ?? 0x82917b)
  const linen = material(0xeee4cd),
    metal = material(0x3f4441)
  const box = (
    x: number,
    y: number,
    z: number,
    a: number,
    b: number,
    c: number,
    m: MeshStandardMaterial,
    parent = group,
  ) => {
    const mesh = new Mesh(new BoxGeometry(a, b, c), m)
    mesh.position.set(x, y, z)
    if (m === wall) {
      mesh.userData.materialSlot = 'interior-wall'
      m.userData.baseColorTint = profile?.wall ?? 0xdfd6bd
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const cylinder = (
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    m: MeshStandardMaterial,
    parent = group,
  ) => {
    const mesh = new Mesh(new CylinderGeometry(r * 0.88, r, h, 10), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const stone = s.kind === 'storehouse' || s.kind === 'shed'
  ctx.fillStyle = stone ? '#a39d89' : '#a38260'
  ctx.fillRect(0, 0, 256, 256)
  for (let row = 0; row < 8; row++) {
    const y = row * 32
    ctx.fillStyle = stone
      ? ['#aaa590', '#9d9c88', '#b6af99'][row % 3]!
      : ['#b3946d', '#a98762', '#ba9974', '#ae8c66'][row % 4]!
    ctx.fillRect(0, y + 1, 256, 30)
    ctx.fillStyle = stone ? '#888572' : '#806243'
    ctx.fillRect((row * 79) % 256, y, 2, 32)
    if (!stone)
      for (let line = 0; line < 8; line++) {
        ctx.fillStyle = line % 2 ? '#b99570' : '#9e7c57'
        ctx.fillRect((row * 31 + line * 53) % 200, y + 3 + line * 3, 28 + ((line * 11) % 64), 1)
      }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(w / 3, d / 3)
  texture.magFilter = NearestFilter
  const floor = new MeshStandardMaterial({ map: texture, roughness: 1 })
  box(0, -0.16, 0, w + 0.24, 0.3, d + 0.24, darkWood)
  box(0, 0, 0, w, 0.055, d, floor).userData.materialSlot = 'interior-floor'
  box(-w / 2, wallHeight / 2, 0, 0.16, wallHeight, d, wall)
  box(-w / 2 + 0.09, 0.4, 0, 0.09, 0.8, d, trim)
  box(-w / 2 + 0.13, 0.83, 0, 0.13, 0.08, d, wood)
  box(-w / 2 + 0.14, 0.09, 0, 0.14, 0.16, d, darkWood)
  for (let z = -d / 2; z < d / 2; z += 0.48) box(-w / 2 + 0.145, 0.43, z, 0.04, 0.72, 0.025, wood)
  const windowXs = [-w * 0.18, w * 0.3]
  const glass = new MeshStandardMaterial({
    color: 0x9dac9b,
    emissive: 0xb1c7b4,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
  })
  let edge = -w / 2
  for (const x of windowXs) {
    const start = x - 0.58,
      end = x + 0.58
    box((edge + start) / 2, wallHeight / 2, -d / 2, start - edge, wallHeight, 0.16, wall)
    box(x, 0.52, -d / 2, 1.16, 1.04, 0.16, wall)
    box(x, 2.57, -d / 2, 1.16, 0.46, 0.16, wall)
    for (const dx of [-0.62, 0.62]) box(x + dx, 1.7, -d / 2 + 0.04, 0.12, 1.4, 0.22, wood)
    for (const y of [1.04, 2.36]) box(x, y, -d / 2 + 0.04, 1.36, 0.12, 0.22, wood)
    box(x, 1.7, -d / 2, 1.12, 1.24, 0.025, glass).castShadow = false
    box(x, 1.7, -d / 2 + 0.08, 0.055, 1.2, 0.08, linen)
    box(x, 1.7, -d / 2 + 0.08, 1.16, 0.055, 0.08, linen)
    box(x, 1.0, -d / 2 + 0.18, 1.48, 0.09, 0.45, wood)
    for (const dx of [-0.77, 0.77]) {
      for (let fold = 0; fold < 4; fold++)
        box(
          x + dx + fold * 0.055,
          1.79,
          -d / 2 + 0.13,
          0.065,
          1.32,
          0.1 + (fold % 2) * 0.055,
          linen,
        )
    }
    edge = end
  }
  box((edge + w / 2) / 2, wallHeight / 2, -d / 2, w / 2 - edge, wallHeight, 0.16, wall)
  box(0, 0.4, -d / 2 + 0.09, w, 0.8, 0.09, trim)
  box(0, 0.83, -d / 2 + 0.13, w, 0.08, 0.13, wood)
  box(0, 0.09, -d / 2 + 0.14, w, 0.16, 0.14, darkWood)
  for (let x = -w / 2; x < w / 2; x += 0.48) box(x, 0.43, -d / 2 + 0.145, 0.025, 0.72, 0.04, wood)
  box(0, wallHeight, -d / 2, w + 0.2, 0.12, 0.24, darkWood)
  box(-w / 2, wallHeight, 0, 0.24, 0.12, d + 0.2, darkWood)
  for (const z of [-d / 2, d / 2])
    box(-w / 2 + 0.05, wallHeight / 2, z, 0.2, wallHeight, 0.18, wood)
  const capacity = isBeddedKind(config, s.kind) ? roomCapacity(s) : 0
  const personal = s.kind === 'house'
  const bedCount = personal ? Math.min(1, capacity) : capacity
  const columns = Math.max(1, Math.floor((w * 0.48) / 1.5))
  for (let i = 0; i < bedCount; i++) {
    const x = -w / 2 + (personal ? 1.25 : 0.95) + (i % columns) * 1.55
    const rows = Math.ceil(bedCount / columns)
    const z =
      rows === 1 ? -d * 0.2 : -d / 2 + 1.4 + Math.floor(i / columns) * ((d - 2.8) / (rows - 1))
    box(x, 0.28, z, 1.22, 0.22, 2.1, wood)
    for (const dx of [-0.48, 0.48])
      for (const dz of [-0.85, 0.85]) box(x + dx, 0.22, z + dz, 0.12, 0.44, 0.12, darkWood)
    box(x, 0.65, z - 1.03, 1.28, 0.9, 0.12, wood)
    box(x, 0.45, z, 1.12, 0.22, 1.96, linen)
    box(x, 0.59, z - 0.62, 0.85, 0.15, 0.45, linen)
    box(x, 0.58, z + 0.24, 1.16, 0.12, 1.26, trim)
    for (let stripe = -2; stripe <= 2; stripe++)
      box(x + stripe * 0.19, 0.644, z + 0.24, 0.025, 0.006, 1.24, linen)
    beds.push(new Vector3(x, 0.65, z + 0.2))
    obstacles.push({ x, z, w: 1.35, d: 2.2 })
  }
  if (personal) {
    for (let i = 1; i < capacity; i++) {
      const x = -w / 2 + 0.95 + ((i - 1) % 2) * 1.5
      const z = d / 2 - 1.35 - Math.floor((i - 1) / 2) * 2.25
      const roll = new Group()
      box(x, 0.13, z, 1.0, 0.15, 1.9, linen, roll)
      box(x, 0.24, z + 0.2, 1.03, 0.08, 1.32, trim, roll)
      box(x, 0.25, z - 0.63, 0.75, 0.13, 0.38, linen, roll)
      roll.visible = false
      group.add(roll)
      bedrolls.push(roll)
      beds.push(new Vector3(x, 0.3, z))
    }
    const x = -w / 2 + 0.45,
      z = -d / 2 + 0.6
    box(x, 0.55, z, 0.65, 1.1, 0.72, wood)
    for (const y of [0.25, 0.6, 0.95]) {
      box(x + 0.34, y, z, 0.03, 0.26, 0.62, trim)
      cylinder(x + 0.38, y, z, 0.045, 0.05, metal).rotation.z = Math.PI / 2
    }
    obstacles.push({ x, z, w: 0.8, d: 0.9 })
    const deskX = -w / 2 + 0.5,
      deskZ = d * 0.12
    box(deskX, 0.88, deskZ, 0.82, 0.13, 1.45, wood)
    for (const dz of [-0.6, 0.6]) box(deskX, 0.43, deskZ + dz, 0.55, 0.86, 0.1, darkWood)
    if (profile?.detail === 'forager' || profile?.detail === 'herbal') {
      for (let i = 0; i < 3; i++) {
        cylinder(deskX, 1.02, deskZ + (i - 1) * 0.4, 0.12, 0.24, material(0xa57758))
        const leaves = new Mesh(new ConeGeometry(0.18, 0.35, 5), material(0x7d905b))
        leaves.position.set(deskX, 1.25, deskZ + (i - 1) * 0.4)
        group.add(leaves)
      }
    } else if (profile?.detail === 'workshop' || profile?.detail === 'smith') {
      box(deskX, 1.03, deskZ, 0.3, 0.12, 0.65, metal)
      box(deskX, 1.15, deskZ, 0.17, 0.12, 0.25, metal)
    } else {
      box(deskX, 0.99, deskZ, 0.45, 0.045, 0.6, linen)
      box(deskX, 1.025, deskZ, 0.018, 0.025, 0.58, trim)
    }
    obstacles.push({ x: deskX, z: deskZ, w: 1, d: 1.65 })
  }
  const table = new Vector3(w * 0.23, 0, d * 0.18)
  if (!stone) {
    const rug = material(profile?.roof ?? 0x9e7060)
    box(table.x, 0.045, table.z, 2.95, 0.035, 2.6, rug)
    for (const z of [-1.16, 1.16]) box(table.x, 0.065, table.z + z, 2.75, 0.008, 0.07, linen)
    for (const x of [-1.35, 1.35]) box(table.x + x, 0.065, table.z, 0.07, 0.008, 2.32, linen)
  }
  box(table.x, 0.91, table.z, 1.55, 0.14, 1.0, wood)
  for (const x of [-0.62, 0.62])
    for (const z of [-0.34, 0.34]) box(table.x + x, 0.45, table.z + z, 0.11, 0.9, 0.11, darkWood)
  obstacles.push({ x: table.x, z: table.z, w: 1.7, d: 1.15 })
  for (const dz of [-0.92, 0.92]) {
    box(table.x, 0.47, table.z + dz, 1.3, 0.1, 0.38, wood)
    for (const dx of [-0.48, 0.48]) box(table.x + dx, 0.23, table.z + dz, 0.1, 0.46, 0.27, darkWood)
    obstacles.push({ x: table.x, z: table.z + dz, w: 1.4, d: 0.48 })
  }
  const storage = new Vector3(w / 2 - 0.95, 0, -d / 2 + 0.5)
  for (const y of [0.16, 0.78, 1.4, 2.02]) box(storage.x, y, storage.z, 1.4, 0.1, 0.62, wood)
  for (const x of [-0.7, 0.7]) box(storage.x + x, 1.08, storage.z, 0.09, 2.15, 0.65, darkWood)
  box(storage.x, 1.08, storage.z - 0.3, 1.4, 2.15, 0.05, trim)
  obstacles.push({ x: storage.x, z: storage.z, w: 1.7, d: 0.8 })
  if (stone)
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + 0.75,
        z = -d / 2 + 1.2 + i * 1.7
      box(x, 0.36, z, 1.05, 0.72, 0.95, wood)
      for (const y of [0.12, 0.6]) box(x, y, z + 0.49, 1.1, 0.09, 0.04, darkWood)
      obstacles.push({ x, z, w: 1.2, d: 1.1 })
    }
  const hearth = new Vector3(w * 0.03, 0, -d / 2 + 0.52)
  const flames = new Group()
  if (isHearthKind(config, s.kind)) {
    const masonry = material(0x8b8676)
    box(hearth.x, 0.065, hearth.z + 0.3, 1.75, 0.1, 1.35, masonry)
    for (const dx of [-0.61, 0.61]) box(hearth.x + dx, 0.7, hearth.z, 0.28, 1.35, 0.75, masonry)
    box(hearth.x, 1.44, hearth.z, 1.65, 0.15, 0.9, wood)
    box(hearth.x, 2.02, hearth.z - 0.1, 1.2, 1.0, 0.6, masonry)
    box(hearth.x, 0.61, hearth.z - 0.33, 0.95, 1.12, 0.06, metal)
    for (let i = 0; i < 3; i++) {
      const log = cylinder(hearth.x + (i - 1) * 0.2, 0.2, hearth.z + 0.17, 0.1, 0.65, darkWood)
      log.rotation.z = Math.PI / 2
    }
    flames.position.copy(hearth).add(new Vector3(0, 0.4, 0.2))
    for (let i = 0; i < 5; i++) {
      const mesh = new Mesh(
        new ConeGeometry(0.09, 0.35 + (i % 2) * 0.16, 5),
        new MeshStandardMaterial({
          color: 0xf4c16c,
          emissive: 0xf29943,
          emissiveIntensity: 1.3,
          roughness: 1,
        }),
      )
      mesh.position.set((i - 2) * 0.12, 0.04, Math.sin(i) * 0.06)
      flames.add(mesh)
    }
    group.add(flames)
    obstacles.push({ x: hearth.x, z: hearth.z, w: 1.9, d: 1.45 })
  }
  if (!stone) {
    const pot = cylinder(windowXs[0]! + 0.34, 1.16, -d / 2 + 0.22, 0.12, 0.26, material(0xad7f62))
    for (let i = 0; i < 5; i++) {
      const leaf = new Mesh(new ConeGeometry(0.1, 0.4, 5), material(0x68794c))
      leaf.position
        .copy(pot.position)
        .add(new Vector3(Math.sin(i * 2) * 0.12, 0.22, Math.cos(i * 2) * 0.1))
      leaf.rotation.z = Math.sin(i) * 0.35
      group.add(leaf)
    }
    box(-w / 2 + 0.14, 1.92, d * 0.15, 0.13, 0.67, 0.82, darkWood)
    box(-w / 2 + 0.22, 1.92, d * 0.15, 0.03, 0.52, 0.67, linen)
    box(-w / 2 + 0.245, 1.9, d * 0.15, 0.015, 0.3, 0.46, trim)
  }
  const stored = new Group()
  group.add(stored)
  const entry = new Vector3(
    s.facing === 'se' ? w / 2 - 0.45 : 0,
    0,
    s.facing === 'se' ? 0 : d / 2 - 0.45,
  )
  box(
    entry.x,
    0.04,
    entry.z,
    s.facing === 'se' ? 0.65 : 1.2,
    0.04,
    s.facing === 'se' ? 1.2 : 0.65,
    linen,
  )
  return {
    group,
    w,
    d,
    beds,
    bedrolls,
    table,
    storage,
    stored,
    hearth,
    flames,
    glass,
    entry,
    obstacles,
  }
}
