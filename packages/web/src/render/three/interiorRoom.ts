import { isBeddedKind, isHearthKind, roomCapacity, type SimConfig } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  Color,
  NoColorSpace,
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
import { woodMaps } from './structures.js'

export function buildInteriorRoom(s: Structure, config: SimConfig) {
  const group = new Group()
  const profile = ['house', 'cottage', 'cabin', 'farmhouse'].includes(s.kind)
    ? PERSONAL_HOMES[s.owner ?? '']
    : undefined
  const w = Math.max(6, s.w * 2.6),
    d = Math.max(6, s.h * 2.6)
  const detail = profile?.detail
  const readingRoom = detail === 'quiet' || detail === 'tailor'
  const wallHeight = 2.8
  const beds: Vector3[] = []
  const bedrolls: Group[] = []
  const obstacles: { x: number; z: number; w: number; d: number }[] = []
  const material = (color: number) => new MeshStandardMaterial({ color, roughness: 0.94 })
  const wood = material(0x977450),
    darkWood = material(0x65503c)
  const wall = material(profile?.wall ?? 0xf6e8d5),
    trim = material(profile?.trim ?? 0x82917b)
  const wallMaps = woodMaps(profile?.plaster)
  wall.map = wallMaps.color
  wall.bumpMap = wallMaps.height
  wall.bumpScale = profile?.plaster ? 0.018 : 0.035
  const grain = woodMaps(false)
  for (const timber of [wood, darkWood]) {
    timber.map = grain.color
    timber.bumpMap = grain.height
    timber.bumpScale = 0.018
  }
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
      m.userData.baseColorTint = profile?.wall ?? 0xf6e8d5
      const pos = mesh.geometry.attributes.position!,
        normal = mesh.geometry.attributes.normal!,
        uv = mesh.geometry.attributes.uv!
      for (let i = 0; i < pos.count; i++)
        uv.setXY(
          i,
          (Math.abs(normal.getX(i)) > 0.5 ? pos.getZ(i) + z : pos.getX(i) + x) / 2,
          (pos.getY(i) + y) / 2,
        )
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
  const seed = [...s.id].reduce((v, c) => (v * 31 + c.charCodeAt(0)) >>> 0, 7)
  const noise = (n: number) => {
    const v = Math.sin(n * 127.1 + seed) * 43758.5453
    return v - Math.floor(v)
  }
  ctx.fillStyle = stone ? '#7f8278' : '#6d5139'
  ctx.fillRect(0, 0, 256, 256)
  const floorTone = new Color(
    profile?.detail === 'quiet' ? 0x98775c : profile?.detail === 'smith' ? 0x86735a : 0xb79267,
  )
  for (let row = 0; row < 8; row++) {
    const y = row * 32
    for (let col = -1; col < 4; col++) {
      const x = col * 96 + (row % 2) * 48,
        n = row * 9 + col + 1
      const tone = stone ? new Color(0xaaa48e) : floorTone.clone()
      ctx.fillStyle = '#' + tone.multiplyScalar(0.85 + noise(n) * 0.27).getHexString()
      ctx.fillRect(x + 1, y + 1, 94, 30)
      ctx.fillStyle = stone ? '#d2c9ab44' : '#f5d4a755'
      ctx.fillRect(x + 2, y + 1, 92, 1)
      if (!stone) {
        for (let line = 0; line < 12; line++) {
          ctx.fillStyle = line % 2 ? '#5c452b22' : '#f7d6a526'
          ctx.fillRect(
            x + 3 + noise(n * 17 + line) * 55,
            y + 3 + line * 2,
            12 + noise(n * 13 + line) * 25,
            1,
          )
        }
        ctx.fillStyle = '#493b2966'
        for (const dx of [5, 89]) for (const dy of [5, 26]) ctx.fillRect(x + dx, y + dy, 1, 1)
      }
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(w / 3, d / 3)
  texture.magFilter = NearestFilter
  const floorBump = texture.clone()
  floorBump.colorSpace = NoColorSpace
  const floor = new MeshStandardMaterial({
    map: texture,
    bumpMap: floorBump,
    bumpScale: 0.018,
    roughness: 0.97,
  })
  const weave = document.createElement('canvas')
  weave.width = weave.height = 128
  const loom = weave.getContext('2d')!
  loom.fillStyle = '#d9c9af'
  loom.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 128; y += 2)
    for (let x = 0; x < 128; x += 2) {
      loom.fillStyle = (x + y) % 4 ? '#f6ead644' : '#80746622'
      loom.fillRect(x, y, 1, 2)
    }
  const fabric = new CanvasTexture(weave)
  fabric.colorSpace = SRGBColorSpace
  fabric.magFilter = NearestFilter
  const cloth = (color: number) => new MeshStandardMaterial({ color, map: fabric, roughness: 1 })
  linen.map = fabric
  const blanket = cloth(profile?.trim ?? 0x82917b)
  const curtain = cloth(detail === 'tailor' || detail === 'quiet' ? profile!.trim : 0xece2c9)
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
          curtain,
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
  if (s.kind === 'farmhouse' || s.kind === 'cabin' || profile?.detail === 'workshop') {
    for (const x of [-w * 0.26, w * 0.15]) {
      box(x, 1.42, -d / 2 + 0.11, 0.18, 2.8, 0.18, darkWood)
      const brace = box(x + 0.28, 2.52, -d / 2 + 0.16, 0.13, 0.8, 0.15, wood)
      brace.rotation.z = -Math.PI / 4
    }
  }
  const capacity = isBeddedKind(config, s.kind) ? roomCapacity(s) : 0
  const personal = s.kind === 'house'
  const bedCount = personal ? Math.min(1, capacity) : capacity
  const columns = Math.max(1, Math.floor((w * 0.48) / 1.5))
  for (let i = 0; i < bedCount; i++) {
    const x = -w / 2 + (personal ? 1.25 : 0.95) + (i % columns) * 1.55
    const rows = Math.ceil(bedCount / columns)
    const z =
      personal && readingRoom
        ? d * 0.19
        : rows === 1
          ? -d * 0.2
          : -d / 2 + 1.4 + Math.floor(i / columns) * ((d - 2.8) / (rows - 1))
    box(x, 0.28, z, 1.22, 0.22, 2.1, wood)
    for (const dx of [-0.48, 0.48])
      for (const dz of [-0.85, 0.85]) box(x + dx, 0.22, z + dz, 0.12, 0.44, 0.12, darkWood)
    box(x, 0.65, z - 1.03, 1.28, 0.9, 0.12, wood)
    box(x, 0.45, z, 1.12, 0.22, 1.96, linen)
    box(x, 0.59, z - 0.62, 0.85, 0.15, 0.45, linen)
    box(x, 0.58, z + 0.24, 1.16, 0.12, 1.26, blanket)
    for (let stripe = -2; stripe <= 2; stripe++)
      box(x + stripe * 0.19, 0.644, z + 0.24, 0.025, 0.006, 1.24, linen)
    beds.push(new Vector3(x, 0.65, z + 0.2))
    obstacles.push({ x, z, w: 1.35, d: 2.2 })
  }
  if (personal) {
    for (let i = 1; i < capacity; i++) {
      const x = readingRoom
        ? i === 1
          ? -w * 0.17
          : w * (0.06 + (i - 2) * 0.21)
        : -w / 2 + 0.95 + ((i - 1) % 2) * 1.5
      const z = readingRoom
        ? i === 1
          ? -d * 0.19
          : d / 2 - 1.35
        : d / 2 - 1.35 - Math.floor((i - 1) / 2) * 2.25
      const roll = new Group()
      box(x, 0.13, z, 1.0, 0.15, 1.9, linen, roll)
      box(x, 0.24, z + 0.2, 1.03, 0.08, 1.32, blanket, roll)
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
      deskZ = readingRoom ? -d * 0.21 : d * 0.12
    box(deskX, 0.88, deskZ, 0.82, 0.13, 1.45, wood)
    for (const dz of [-0.6, 0.6]) box(deskX, 0.43, deskZ + dz, 0.55, 0.86, 0.1, darkWood)
    const plant = (x: number, y: number, z: number, size = 1) => {
      cylinder(x, y, z, 0.12 * size, 0.23 * size, material(0xa57758))
      for (let i = 0; i < 5; i++) {
        const leaf = new Mesh(
          new ConeGeometry(0.09 * size, 0.38 * size, 5),
          material(i % 2 ? 0x6a8251 : 0x91a766),
        )
        leaf.position.set(
          x + Math.sin(i * 2.4) * 0.1 * size,
          y + 0.23 * size,
          z + Math.cos(i * 2.4) * 0.1 * size,
        )
        leaf.rotation.z = Math.sin(i * 2.4) * 0.45
        group.add(leaf)
      }
    }
    const book = (x: number, y: number, z: number, color: number, upright = false) => {
      const cover = material(color)
      box(x, y, z, upright ? 0.22 : 0.4, upright ? 0.44 : 0.07, 0.3, cover)
      box(
        x + 0.01,
        y + (upright ? 0 : 0.035),
        z + 0.013,
        upright ? 0.2 : 0.37,
        upright ? 0.39 : 0.018,
        0.28,
        linen,
      )
    }
    if (detail === 'forager' || detail === 'herbal') {
      for (let i = 0; i < 3; i++) plant(deskX, 1.06, deskZ + (i - 1) * 0.42)
      box(-w / 2 + 0.32, 1.8, deskZ, 0.5, 0.09, 1.6, wood)
      if (detail === 'herbal') {
        for (let i = 0; i < 6; i++) {
          const z = deskZ - 0.63 + i * 0.24
          cylinder(-w / 2 + 0.33, 1.97, z, 0.075, 0.26, material(i % 2 ? 0x7c9370 : 0x997557))
          cylinder(-w / 2 + 0.33, 2.12, z, 0.08, 0.045, darkWood)
          box(-w / 2 + 0.41, 1.98, z, 0.013, 0.09, 0.085, linen)
        }
        book(deskX + 0.3, 1.0, deskZ, 0x6c8069)
      } else {
        for (let i = 0; i < 3; i++) plant(-w / 2 + 0.33, 1.98, deskZ + (i - 1) * 0.55, 0.8)
        const basket = cylinder(-w / 2 + 0.6, 0.31, deskZ + 1.3, 0.32, 0.54, wood)
        for (const y of [0.14, 0.28, 0.42])
          cylinder(basket.position.x, y, basket.position.z, 0.325, 0.025, darkWood)
        obstacles.push({ x: basket.position.x, z: basket.position.z, w: 0.7, d: 0.7 })
      }
    } else if (detail === 'workshop' || detail === 'smith') {
      box(deskX, 1.03, deskZ, 0.3, 0.12, 0.65, metal)
      box(deskX, 1.15, deskZ, 0.17, 0.12, 0.25, metal)
      box(-w / 2 + 0.2, 1.78, deskZ, 0.1, 0.9, 1.6, detail === 'smith' ? darkWood : trim)
      for (let i = 0; i < 4; i++) {
        const z = deskZ - 0.54 + i * 0.36
        box(-w / 2 + 0.29, 1.8, z, 0.06, 0.44, 0.06, wood)
        box(-w / 2 + 0.3, 1.98, z, 0.13, 0.11, 0.24, metal)
      }
      if (detail === 'workshop') {
        for (let i = 0; i < 3; i++)
          box(deskX, 0.16 + i * 0.13, deskZ, 0.48, 0.1, 1.25, i % 2 ? darkWood : wood)
      } else {
        const anvil = new Mesh(new ConeGeometry(0.18, 0.35, 4), metal)
        anvil.rotation.x = -Math.PI / 2
        anvil.position.set(deskX, 1.12, deskZ + 0.48)
        anvil.castShadow = true
        group.add(anvil)
      }
    } else if (detail === 'tailor') {
      const thread = [cloth(0xb28274), cloth(0x6e8d83), cloth(0xd1b27c)]
      for (let i = 0; i < 3; i++) {
        cylinder(deskX, 1.07, deskZ - 0.5 + i * 0.25, 0.085, 0.25, thread[i]!)
        cylinder(deskX, 1.22, deskZ - 0.5 + i * 0.25, 0.11, 0.04, wood)
      }
      for (const z of [-0.64, 0.64]) box(-w / 2 + 0.2, 1.83, deskZ + z, 0.13, 1.1, 0.1, wood)
      for (const y of [1.28, 2.36]) box(-w / 2 + 0.2, y, deskZ, 0.13, 0.1, 1.4, wood)
      for (let i = 0; i < 18; i++)
        box(-w / 2 + 0.22, 1.81, deskZ - 0.58 + i * 0.068, 0.02, 0.98, 0.012, linen)
      for (let i = 0; i < 9; i++)
        box(-w / 2 + 0.24, 1.32 + i * 0.045, deskZ, 0.025, 0.04, 1.18, thread[Math.floor(i / 3)]!)
      for (let i = 0; i < 3; i++) box(deskX, 0.2 + i * 0.12, deskZ, 0.6, 0.1, 0.8, thread[i]!)
    } else if (detail === 'quiet') {
      for (const y of [1.55, 2.13]) {
        box(-w / 2 + 0.26, y, deskZ, 0.45, 0.07, 1.55, wood)
        for (let i = 0; i < 5; i++)
          book(
            -w / 2 + 0.3,
            y + 0.25,
            deskZ - 0.55 + i * 0.25,
            [0x7b7286, 0xa07d68, 0x6e8578][i % 3]!,
            true,
          )
      }
      book(deskX, 1.0, deskZ, 0x887b91)
      box(deskX + 0.95, 0.5, deskZ, 0.65, 0.3, 0.68, blanket)
      box(deskX + 1.25, 0.9, deskZ, 0.15, 0.72, 0.75, blanket)
      for (const z of [-0.32, 0.32]) box(deskX + 0.95, 0.24, deskZ + z, 0.58, 0.43, 0.08, darkWood)
      obstacles.push({ x: deskX + 1, z: deskZ, w: 0.85, d: 0.85 })
    } else if (detail === 'storage') {
      box(-w / 2 + 0.26, 1.77, deskZ, 0.46, 0.88, 1.55, wood)
      for (let i = 0; i < 3; i++) {
        const z = deskZ + (i - 1) * 0.49
        box(-w / 2 + 0.51, 1.77, z, 0.05, 0.73, 0.44, trim)
        box(-w / 2 + 0.55, 1.77, z + 0.12, 0.045, 0.035, 0.035, metal)
      }
      book(deskX, 1.0, deskZ, 0x929876)
      box(deskX, 1.055, deskZ, 0.02, 0.02, 0.4, darkWood)
    } else {
      book(deskX, 1.0, deskZ, 0x82917b)
    }
    obstacles.push({ x: deskX, z: deskZ, w: 1, d: 1.65 })
  }
  const table = new Vector3(
    w * 0.23,
    0,
    d * (readingRoom ? -0.05 : detail === 'forager' ? 0.27 : 0.18),
  )
  const tableWidth = s.kind === 'farmhouse' ? 2.25 : 1.55
  if (!stone) {
    const rug = cloth(profile?.roof ?? 0x9e7060)
    box(table.x, 0.045, table.z, 2.95, 0.035, 2.6, rug)
    for (const z of [-1.16, 1.16]) box(table.x, 0.065, table.z + z, 2.75, 0.008, 0.07, linen)
    for (const x of [-1.35, 1.35]) box(table.x + x, 0.065, table.z, 0.07, 0.008, 2.32, linen)
    for (let i = -4; i <= 4; i++)
      for (const z of [-1.03, 1.03]) {
        const stitch = box(table.x + i * 0.25, 0.071, table.z + z, 0.1, 0.009, 0.1, blanket)
        stitch.rotation.y = Math.PI / 4
      }
    for (let i = -8; i <= 8; i++)
      for (const z of [-1.34, 1.34])
        box(table.x + i * 0.16, 0.05, table.z + z, 0.03, 0.015, 0.13, linen)
  }
  box(table.x, 0.91, table.z, tableWidth, 0.14, 1.0, wood)
  for (const x of [-tableWidth / 2 + 0.15, tableWidth / 2 - 0.15])
    for (const z of [-0.34, 0.34]) box(table.x + x, 0.45, table.z + z, 0.11, 0.9, 0.11, darkWood)
  obstacles.push({ x: table.x, z: table.z, w: tableWidth + 0.15, d: 1.15 })
  for (const dz of stone ? [] : [-0.92, 0.92]) {
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
    for (let row = 0; row < 5; row++) {
      const y = 1.58 + row * 0.19
      box(hearth.x, y, hearth.z + 0.207, 1.19, 0.016, 0.012, darkWood)
      for (const x of row % 2 ? [-0.32, 0.32] : [0])
        box(hearth.x + x, y + 0.095, hearth.z + 0.208, 0.012, 0.18, 0.012, darkWood)
    }
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
    if (!profile) {
      box(-w / 2 + 0.14, 1.92, d * 0.15, 0.13, 0.67, 0.82, darkWood)
      box(-w / 2 + 0.22, 1.92, d * 0.15, 0.03, 0.52, 0.67, linen)
      box(-w / 2 + 0.245, 1.9, d * 0.15, 0.015, 0.3, 0.46, trim)
    }
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
