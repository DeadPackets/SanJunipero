import * as THREE from 'three'
import type { Structure } from '@sj/engine/state'
import type { SimConfig } from '@sj/shared'
import { PERSONAL_HOMES } from './personalHomes'

const C = {
  cream: 0xf6e8d5,
  trim: 0xfff6e9,
  stone: 0x857d75,
  slate: 0xaaa198,
  wood: 0xa66e38,
  paleWood: 0xd9a876,
  glass: 0x7fa6ad,
  iron: 0x43394a,
}
type Point = [number, number, number]

export function woodMaps(plaster = false): { color: THREE.DataTexture; height: THREE.DataTexture } {
  const size = 128
  const color = new Uint8Array(size * size * 4)
  const height = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const seam = !plaster && y % 8 === 0
      const grain = Math.sin(y * 9 + Math.sin(x * 0.045) * 1.5) * 3
      const value = plaster
        ? 235 + Math.sin(x * 17 + y * 31) * 5
        : seam
          ? 174
          : 207 + ((Math.floor(y / 8) * 17) % 18) + grain
      const bump = seam ? 85 : 170 + grain
      const offset = (y * size + x) * 4
      color.set([value + 12, value + 7, value - 5, 255], offset)
      height.set([bump, bump, bump, 255], offset)
    }
  }
  const maps = {
    color: new THREE.DataTexture(color, size, size),
    height: new THREE.DataTexture(height, size, size),
  }
  maps.color.colorSpace = THREE.SRGBColorSpace
  for (const texture of Object.values(maps)) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
  }
  return maps
}

function slateTexture(): THREE.DataTexture {
  const size = 64
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 4)
      const col = Math.floor((x + (row % 2) * 4) / 8)
      const seam = y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0
      const value = seam ? 110 : 154 + ((row * 17 + col * 31) % 24)
      const offset = (y * size + x) * 4
      pixels.set([value, value - 3, value - 8, 255], offset)
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

export function structureKey(s: Structure, config: SimConfig): string {
  const recipe = config.structures.recipes[s.kind]
  return `${s.kind}:${s.owner ?? ''}:${s.x}:${s.y}:${s.w}:${s.h}:${s.facing}:${s.stage}:${Math.floor(s.progressTicks / 120)}:${recipe?.roofed}:${recipe?.durationTicks}`
}

export function buildStructure(s: Structure, config: SimConfig): THREE.Group {
  const home = ['house', 'cottage', 'cabin', 'farmhouse'].includes(s.kind)
    ? PERSONAL_HOMES[s.owner ?? '']
    : undefined
  const colors = home ? { ...C, cream: home.wall, slate: home.roof, trim: home.trim } : C
  const root = new THREE.Group()
  root.name = s.name ?? s.kind
  root.position.set(s.x, 0, s.y)
  root.userData.pick = { kind: 'structure', id: s.id }
  const windows: THREE.MeshStandardMaterial[] = []
  const roofs: THREE.Group[] = []
  root.userData.windows = windows
  root.userData.roofs = roofs
  const body = new THREE.Group()
  body.position.set(s.w / 2, 0, s.h / 2)
  const turned = s.facing === 'se'
  // State dimensions already include facing; turn a canonical local footprint exactly once.
  const w = turned ? s.h : s.w
  const d = turned ? s.w : s.h
  if (turned) body.rotation.y = Math.PI / 2
  root.add(body)
  let wood: ReturnType<typeof woodMaps> | undefined
  const materials = new Map<number, THREE.MeshStandardMaterial>()
  const material = (color: number): THREE.MeshStandardMaterial => {
    let result = materials.get(color)
    if (!result) {
      result = new THREE.MeshStandardMaterial({ color, roughness: 0.86 })
      if (color === colors.cream) {
        wood ??= woodMaps(home?.plaster)
        result.map = wood.color
        result.bumpMap = wood.height
        result.bumpScale = 0.035
        if (home) result.userData.baseColorTint = home.wall
      }
      materials.set(color, result)
    }
    return result
  }
  const mesh = (
    parent: THREE.Group,
    geometry: THREE.BufferGeometry,
    color: number,
    cast = true,
  ): THREE.Mesh => {
    const result = new THREE.Mesh(geometry, material(color))
    result.castShadow = cast
    result.receiveShadow = true
    parent.add(result)
    return result
  }
  const box = (
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: number,
    cast = true,
  ): THREE.Mesh => {
    const result = mesh(parent, new THREE.BoxGeometry(width, height, depth), color, cast)
    result.position.set(x, y, z)
    return result
  }
  const cylinder = (
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    color: number,
    cast = true,
  ): THREE.Mesh => {
    const result = mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 12), color, cast)
    result.position.set(x, y, z)
    return result
  }
  const surface = (
    parent: THREE.Group,
    points: Point[],
    color: number,
    roof = false,
  ): THREE.Mesh => {
    const geometry = new THREE.BufferGeometry()
    const positions: number[] = []
    const uv: number[] = []
    for (let i = 1; i < points.length - 1; i++) {
      for (const point of [points[0]!, points[i]!, points[i + 1]!]) {
        positions.push(...point)
        uv.push(point[0] * 0.75, (point[2] + point[1]) * 0.75)
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.computeVertexNormals()
    const result = mesh(parent, geometry, color)
    const mat = material(color).clone()
    mat.side = THREE.DoubleSide
    if (roof) {
      mat.map = roofMap ??= slateTexture()
      mat.color.setHex(home?.roof ?? 0xe9e2da)
      if (home) mat.userData.baseColorTint = home.roof
      result.name = 'roof-slope'
      result.userData.materialSlot = 'roof'
    }
    result.material = mat
    return result
  }
  let roofMap: THREE.DataTexture | undefined
  const glow = (pane: THREE.Mesh): void => {
    const mat = (pane.material as THREE.MeshStandardMaterial).clone()
    mat.emissive.setHex(0xffbf66)
    mat.emissiveIntensity = 0
    pane.material = mat
    windows.push(mat)
  }
  const inset = Math.min(0.06, Math.min(w, d) * 0.06)
  const width = w - inset * 2
  const depth = d - inset * 2
  const left = -width / 2
  const right = width / 2
  const back = -depth / 2
  const front = depth / 2

  if (s.stage === 'construction') {
    const scaffold = new THREE.Group()
    scaffold.name = 'scaffolding'
    body.add(scaffold)
    box(scaffold, 0, 0.1, 0, width, 0.2, depth, C.stone)
    const duration = config.structures.recipes[s.kind]?.durationTicks ?? 1
    const progress = Math.max(0, Math.min(1, s.progressTicks / duration))
    const height = 0.8 + progress * 1.3
    for (const x of [left + 0.05, right - 0.05]) {
      for (const z of [back + 0.05, front - 0.05])
        box(scaffold, x, height / 2, z, 0.08, height, 0.08, C.wood)
      box(scaffold, x, height * 0.7, 0, 0.08, 0.09, depth, C.paleWood)
    }
    for (const z of [back + 0.05, front - 0.05])
      box(scaffold, 0, height, z, width, 0.08, 0.08, C.wood)
    for (let i = 0; i < 4; i++)
      box(scaffold, 0, 0.25 + i * 0.055, back + 0.18, width * 0.65, 0.04, 0.12, C.paleWood)
    return root
  }

  if (s.kind === 'lamp_post' || s.kind === 'lamp') {
    box(body, 0, 0.08, 0, 0.2, 0.16, 0.2, C.stone)
    box(body, 0, 0.94, 0, 0.065, 1.76, 0.065, C.iron)
    const lantern = new THREE.Group()
    lantern.name = 'lantern'
    body.add(lantern)
    box(lantern, 0, 2.08, 0, 0.3, 0.065, 0.3, C.iron, false)
    const pane = box(lantern, 0, 1.91, 0, 0.2, 0.25, 0.2, 0xf2c879, false)
    glow(pane)
    box(lantern, 0, 1.76, 0, 0.26, 0.045, 0.26, C.iron, false)
    for (const x of [-0.115, 0.115])
      for (const z of [-0.115, 0.115]) box(lantern, x, 1.91, z, 0.023, 0.29, 0.023, C.iron, false)
    root.userData.lightHeight = 1.91
    return root
  }

  if (s.kind === 'fire_pit') {
    const radius = Math.min(w, d) * 0.48
    cylinder(body, 0, 0.035, 0, radius, 0.07, 0x3c3129, false)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      const stone = mesh(body, new THREE.DodecahedronGeometry(1, 0), C.stone)
      stone.position.set(Math.cos(angle) * radius * 0.76, 0.14, Math.sin(angle) * radius * 0.76)
      stone.scale.set(radius * 0.24, 0.14, radius * 0.24)
      stone.rotation.y = angle
    }
    for (const angle of [-0.6, 0.6]) {
      const log = box(body, 0, 0.17, 0, radius * 1.25, 0.11, 0.12, 0x3c281b)
      log.rotation.y = angle
    }
    const fire = new THREE.Group()
    fire.name = 'flames'
    fire.visible = false
    body.add(fire)
    for (let i = 0; i < 8; i++) {
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(1, 7, 5),
        new THREE.MeshBasicMaterial({
          color: i % 3 ? 0xff7720 : 0xffdf80,
          transparent: true,
          opacity: 0.83,
          depthWrite: false,
          toneMapped: true,
        }),
      )
      const angle = i * 2.4
      flame.position.set(Math.sin(angle) * radius * 0.32, 0.4, Math.cos(angle) * radius * 0.32)
      flame.scale.set(0.07 + (i % 3) * 0.025, 0.25 + (i % 4) * 0.055, 0.08)
      flame.userData.flameHeight = flame.scale.y
      fire.add(flame)
    }
    for (let i = 0; i < 10; i++) {
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 4, 3),
        new THREE.MeshBasicMaterial({ color: 0xffb949 }),
      )
      ember.name = 'ember'
      ember.position.y = 0.25
      fire.add(ember)
    }
    for (let i = 0; i < 6; i++) {
      const smoke = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x9a9b91,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
        }),
      )
      smoke.name = 'smoke'
      smoke.position.y = 0.7
      smoke.scale.setScalar(0.12)
      fire.add(smoke)
    }
    root.userData.fire = fire
    root.userData.lightHeight = 0.75
    return root
  }

  if (s.kind === 'well') {
    const wall = mesh(body, new THREE.CylinderGeometry(0.35, 0.36, 0.48, 12, 1, true), C.stone)
    wall.position.y = 0.28
    ;(wall.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    cylinder(body, 0, 0.13, 0, 0.29, 0.02, 0x466573, false)
    const rim = mesh(body, new THREE.TorusGeometry(0.325, 0.06, 5, 12), 0xb5aa95)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.55
    for (const x of [-0.3, 0.3]) box(body, x, 0.88, 0, 0.07, 0.88, 0.07, C.wood)
    box(body, 0, 1.27, 0, 0.69, 0.07, 0.1, C.wood)
    cylinder(body, 0, 0.91, 0, 0.015, 0.61, C.iron, false)
    cylinder(body, 0, 0.67, 0, 0.085, 0.12, C.paleWood)
    return root
  }

  if (s.kind === 'bridge') {
    const acrossX = width > depth
    const count = Math.max(3, Math.ceil((acrossX ? width : depth) / 0.2))
    for (let i = 0; i < count; i++) {
      const at = -0.5 + (i + 0.5) / count
      box(
        body,
        acrossX ? at * width : 0,
        0.1,
        acrossX ? 0 : at * depth,
        acrossX ? width / count - 0.015 : width,
        0.14,
        acrossX ? depth : depth / count - 0.015,
        i % 3 ? C.paleWood : C.wood,
      )
    }
    for (const side of [-1, 1]) {
      box(
        body,
        acrossX ? 0 : side * (width / 2 - 0.035),
        0.6,
        acrossX ? side * (depth / 2 - 0.035) : 0,
        acrossX ? width : 0.055,
        0.06,
        acrossX ? 0.055 : depth,
        C.wood,
      )
      for (const end of [-1, 0, 1])
        box(
          body,
          acrossX ? end * (width / 2 - 0.05) : side * (width / 2 - 0.05),
          0.37,
          acrossX ? side * (depth / 2 - 0.05) : end * (depth / 2 - 0.05),
          0.075,
          0.7,
          0.075,
          C.wood,
        )
    }
    return root
  }

  if (s.kind === 'grave') {
    box(body, 0, 0.04, 0.04, width * 0.65, 0.07, depth * 0.85, 0xa19986, false)
    box(body, 0, 0.31, back + 0.16, width * 0.5, 0.57, 0.14, C.stone)
    box(body, 0, 0.4, back + 0.235, 0.045, 0.24, 0.015, C.trim, false)
    box(body, 0, 0.43, back + 0.235, 0.17, 0.04, 0.015, C.trim, false)
    return root
  }

  if (s.kind === 'market' || s.kind === 'civic_market') {
    for (const x of [left + 0.07, right - 0.07])
      for (const z of [back + 0.07, front - 0.07]) box(body, x, 0.72, z, 0.075, 1.44, 0.075, C.wood)
    box(body, 0, 0.58, 0.06, width * 0.88, 0.12, depth * 0.45, C.paleWood)
    for (let i = 0; i < 5; i++) {
      const x0 = left + (width * i) / 5
      const x1 = left + (width * (i + 1)) / 5
      surface(
        body,
        [
          [x0, 1.45, front],
          [x1, 1.45, front],
          [x1, 1.65, back],
          [x0, 1.65, back],
        ],
        i % 2 ? C.trim : 0x84957b,
      )
      box(
        body,
        (x0 + x1) / 2,
        1.4,
        front - 0.02,
        width / 5,
        0.1,
        0.04,
        i % 2 ? C.trim : 0x84957b,
        false,
      )
      cylinder(
        body,
        ((i - 2) * width) / 7,
        0.7,
        0.07,
        Math.min(0.08, width / 16),
        0.1,
        i % 2 ? 0xc08b45 : 0x78946a,
        false,
      )
    }
    return root
  }

  const roofed =
    config.structures.recipes[s.kind]?.roofed ??
    ['civic_hall', 'town_hall', 'church', 'school', 'tavern', 'bakery', 'smithy', 'barn'].includes(
      s.kind,
    )
  if (!roofed) {
    box(body, 0, 0.13, 0, width * 0.85, 0.26, depth * 0.85, C.stone)
    box(body, 0, 0.47, 0, width * 0.6, 0.42, depth * 0.6, C.wood).userData.materialSlot = 'wood'
    box(body, 0, 0.7, 0, width * 0.67, 0.055, depth * 0.67, C.paleWood).userData.materialSlot =
      'roof'
    return root
  }

  const farm = s.kind === 'farmhouse'
  const cabin = s.kind === 'cabin'
  const storage = s.kind === 'storehouse' || s.kind === 'barn'
  const civic = s.kind === 'civic_hall' || s.kind === 'town_hall' || s.kind === 'church'
  const height = farm ? 3.75 : civic ? 2.8 : cabin ? 1.7 : storage ? 2.05 : 2.15
  const porchDepth = farm && d >= 1.5 ? 0.4 : home && d >= 1.5 ? 0.3 : 0
  const facade = front - porchDepth
  const shellDepth = depth - porchDepth
  const shell = new THREE.Group()
  shell.name = 'wall-shell'
  body.add(shell)
  box(body, 0, 0.11, 0, width, 0.22, depth, C.stone)
  const walls = [
    box(shell, 0, height / 2 + 0.18, back + 0.04, width, height, 0.08, colors.cream),
    box(shell, 0, height / 2 + 0.18, facade - 0.04, width, height, 0.08, colors.cream),
    box(
      shell,
      left + 0.04,
      height / 2 + 0.18,
      (back + facade) / 2,
      0.08,
      height,
      shellDepth,
      colors.cream,
    ),
    box(
      shell,
      right - 0.04,
      height / 2 + 0.18,
      (back + facade) / 2,
      0.08,
      height,
      shellDepth,
      colors.cream,
    ),
  ]
  for (const wall of walls) wall.userData.materialSlot = 'wood'
  const seamColor = home ? home.trim : cabin ? 0xcdb48e : 0xe4d5c1
  for (let y = 0.36; !home?.plaster && y < height + 0.1; y += cabin ? 0.17 : 0.24) {
    box(body, 0, y, facade + 0.003, width, 0.012, 0.012, seamColor, false)
    box(body, right + 0.003, y, (back + facade) / 2, 0.012, 0.012, shellDepth, seamColor, false)
    box(body, left - 0.003, y, (back + facade) / 2, 0.012, 0.012, shellDepth, seamColor, false)
  }
  for (const x of [left + 0.045, right - 0.045])
    for (const z of [back + 0.045, facade - 0.045])
      box(body, x, height / 2 + 0.19, z, 0.1, height + 0.04, 0.1, colors.trim, false)
  box(body, 0, 0.3, facade + 0.018, width, 0.07, 0.045, colors.trim, false)
  const doorX = Math.max(
    left + 0.27,
    Math.min(right - 0.27, (turned ? -1 : 1) * (Math.floor(w / 2 - 0.5) + 0.5 - w / 2)),
  )
  const doorWidth = Math.min(storage ? 0.7 : 0.43, width * 0.65)
  const door = box(body, doorX, 0.82, facade + 0.025, doorWidth + 0.08, 1.27, 0.06, colors.trim)
  door.name = 'door'
  box(body, doorX, 0.8, facade + 0.038, doorWidth, 1.17, 0.02, C.wood, false)
  box(body, doorX + doorWidth * 0.3, 0.78, facade + 0.054, 0.035, 0.04, 0.01, C.iron, false)
  const stepWidth = Math.min(0.72, width)
  box(
    body,
    Math.max(left + stepWidth / 2, Math.min(right - stepWidth / 2, doorX)),
    0.14,
    facade + 0.03,
    stepWidth,
    0.12,
    0.06,
    C.stone,
  )

  const window = (x: number, y: number, z: number, side: boolean): void => {
    const group = new THREE.Group()
    group.position.set(x, y, z)
    group.scale.z = 0.55
    if (side) group.rotation.y = Math.PI / 2
    body.add(group)
    box(group, 0, 0, 0, 0.4, 0.57, 0.035, colors.trim, false)
    glow(box(group, 0, 0, 0.024, 0.31, 0.46, 0.015, C.glass, false))
    box(group, 0, 0, 0.039, 0.026, 0.48, 0.016, colors.trim, false)
    box(group, 0, 0, 0.04, 0.34, 0.025, 0.016, colors.trim, false)
    box(group, 0, -0.31, 0.035, 0.44, 0.05, 0.11, colors.trim, false)
  }
  for (const fraction of farm ? [0.15, 0.38, 0.7, 0.88] : [0.22, 0.76]) {
    const x = left + width * fraction
    if (Math.abs(x - doorX) > 0.45 && width > 1) window(x, 1.25, facade + 0.005, false)
    if (farm) window(x, 2.85, facade + 0.005, false)
  }
  if (shellDepth > 0.75)
    for (const fraction of shellDepth > 1.3 ? [0.28, 0.73] : [0.5])
      window(right + 0.005, 1.25, back + shellDepth * fraction, true)
  if (farm) box(body, 0, 2.12, facade + 0.025, width, 0.1, 0.06, colors.trim, false)

  const roof = new THREE.Group()
  roof.name = 'roof'
  body.add(roof)
  roofs.push(roof)
  const x0 = -w / 2 + 0.015
  const x1 = w / 2 - 0.015
  const z0 = -d / 2 + 0.015
  const z1 = facade + 0.045
  const eave = height + 0.24
  const peak = eave + (cabin ? 0.57 : 0.76)
  const midZ = (z0 + z1) / 2
  const hip = farm || home?.detail === 'storage' ? Math.min(0.65, width * 0.2) : 0
  box(roof, 0, eave - 0.03, midZ, x1 - x0, 0.09, z1 - z0, 0x5d5751)
  surface(
    roof,
    [
      [x0, eave, z0],
      [x1, eave, z0],
      [x1 - hip, peak, midZ],
      [x0 + hip, peak, midZ],
    ],
    colors.slate,
    true,
  )
  surface(
    roof,
    [
      [x0 + hip, peak, midZ],
      [x1 - hip, peak, midZ],
      [x1, eave, z1],
      [x0, eave, z1],
    ],
    colors.slate,
    true,
  )
  surface(
    roof,
    [
      [x0, eave, z1],
      [x0, eave, z0],
      [x0 + hip, peak, midZ],
    ],
    hip ? colors.slate : colors.cream,
    hip > 0,
  )
  surface(
    roof,
    [
      [x1, eave, z0],
      [x1, eave, z1],
      [x1 - hip, peak, midZ],
    ],
    hip ? colors.slate : colors.cream,
    hip > 0,
  )
  box(roof, 0, peak + 0.015, midZ, x1 - x0 - hip * 2, 0.055, 0.07, C.stone)
  if (!storage && width > 0.7) {
    for (const chimneyX of farm
      ? [left + width * 0.22, right - width * 0.22]
      : [left + width * 0.22]) {
      box(roof, chimneyX, peak + 0.08, midZ - 0.1, 0.21, 0.55, 0.23, cabin ? C.stone : 0x9c6b47)
      box(roof, chimneyX, peak + 0.37, midZ - 0.1, 0.28, 0.075, 0.3, colors.trim)
      box(roof, chimneyX, peak + 0.412, midZ - 0.1, 0.14, 0.008, 0.16, C.iron, false)
    }
  }
  if (farm) {
    const porch = new THREE.Group()
    porch.name = 'porch'
    body.add(porch)
    box(porch, 0, 0.22, (facade + front) / 2, width, 0.1, porchDepth, C.paleWood)
    for (const x of [left + 0.06, right - 0.06])
      box(porch, x, 0.95, front - 0.04, 0.065, 1.5, 0.065, colors.trim)
    surface(
      roof,
      [
        [left, 1.72, front + 0.03],
        [right, 1.72, front + 0.03],
        [right, 1.91, facade],
        [left, 1.91, facade],
      ],
      C.wood,
    )
  }
  if (home && width > 1.8 && porchDepth > 0) {
    const z = front - 0.12
    const planter = (x: number, y: number, flowers: boolean): void => {
      cylinder(body, x, y + 0.11, z, 0.09, 0.18, 0xa47759)
      for (let i = 0; i < 3; i++) {
        const plant = mesh(body, new THREE.IcosahedronGeometry(0.095, 0), 0x6e8655, false)
        plant.position.set(x + (i - 1) * 0.055, y + 0.26 + (i % 2) * 0.04, z)
        if (flowers)
          box(body, x + (i - 1) * 0.055, y + 0.34, z, 0.035, 0.04, 0.035, 0xaa7689, false)
      }
    }
    for (const x of [left + width * 0.22, left + width * 0.76]) {
      if (Math.abs(x - doorX) <= 0.45) continue
      for (const side of [-1, 1]) {
        const shutter = box(
          body,
          x + side * 0.29,
          1.25,
          facade + 0.028,
          0.13,
          0.55,
          0.04,
          home.trim,
          false,
        )
        shutter.rotation.y = side * 0.1
        for (const y of [1.09, 1.41])
          box(body, x + side * 0.29, y, facade + 0.053, 0.13, 0.023, 0.018, C.wood, false)
      }
    }
    if (home.detail === 'storage') {
      for (const x of [left + 0.48, right - 0.48]) {
        box(body, x, 0.3, z, 0.52, 0.3, 0.22, C.wood)
        box(body, x, 0.47, z, 0.55, 0.045, 0.23, C.paleWood)
        box(body, x, 0.35, z + 0.12, 0.045, 0.12, 0.015, C.iron, false)
      }
      surface(
        body,
        [
          [doorX - 0.4, 1.63, front - 0.01],
          [doorX + 0.4, 1.63, front - 0.01],
          [doorX + 0.4, 1.78, facade],
          [doorX - 0.4, 1.78, facade],
        ],
        home.roof,
      )
    } else if (home.detail === 'workshop' || home.detail === 'smith') {
      const x = right - 0.56
      box(body, x, 0.58, z, 0.8, 0.09, 0.22, C.wood)
      for (const dx of [-0.3, 0.3]) box(body, x + dx, 0.34, z, 0.065, 0.45, 0.16, C.wood)
      if (home.detail === 'workshop') {
        for (let i = 0; i < 3; i++) box(body, x, 0.65 + i * 0.04, z, 0.62, 0.035, 0.12, C.paleWood)
        for (const x of [left + 0.16, right - 0.16]) {
          const brace = box(body, x, height - 0.17, facade + 0.038, 0.075, 0.56, 0.05, home.trim)
          brace.rotation.z = x < 0 ? -0.5 : 0.5
        }
      } else {
        box(body, x, 0.7, z, 0.19, 0.19, 0.14, C.iron)
        box(body, x + 0.025, 0.8, z, 0.32, 0.055, 0.14, C.iron)
      }
    } else if (home.detail === 'forager' || home.detail === 'herbal') {
      for (const x of [left + 0.42, right - 0.42]) planter(x, 0.15, home.detail === 'forager')
      if (home.detail === 'forager') {
        for (let i = 0; i < 6; i++) {
          const vine = mesh(
            body,
            new THREE.IcosahedronGeometry(0.12, 0),
            i % 2 ? 0x7e9566 : 0x677d52,
            false,
          )
          vine.position.set(left + 0.12 + Math.sin(i) * 0.05, 0.55 + i * 0.24, facade + 0.09)
        }
      } else {
        box(body, left + 0.56, 0.8, z, 0.65, 0.055, 0.22, home.trim)
        for (const x of [left + 0.34, left + 0.55, left + 0.77]) planter(x, 0.83, false)
      }
    } else if (home.detail === 'quiet') {
      box(body, right - 0.5, 0.42, z, 0.65, 0.07, 0.22, home.trim)
      for (const x of [right - 0.74, right - 0.26])
        box(body, x, 0.27, z, 0.06, 0.27, 0.18, home.trim)
      planter(left + 0.33, 0.15, false)
    } else if (home.detail === 'tailor') {
      for (const x of [left + width * 0.22, left + width * 0.76]) {
        if (Math.abs(x - doorX) <= 0.45) continue
        box(body, x, 0.83, z, 0.48, 0.18, 0.23, home.trim)
        for (const dx of [-0.12, 0.12]) planter(x + dx, 0.91, true)
      }
    }
  }
  if (civic) {
    box(roof, 0, peak + 0.26, midZ, 0.43, 0.48, 0.43, C.cream)
    const spire = mesh(roof, new THREE.ConeGeometry(0.34, 0.47, 4), C.stone)
    spire.rotation.y = Math.PI / 4
    spire.position.set(0, peak + 0.73, midZ)
  }
  return root
}
