import type { WorldState } from '@sj/engine/state'
import { parseMaterialSetManifest, type AssetRecord } from '@sj/shared'
import * as THREE from 'three'

export const TERRAIN_CHUNK_SIZE = 16
export const TERRAIN_PIXELS_PER_TILE = 24
const COLORS = [
  0x87945c, 0x9d8767, 0x658b8b, 0x768951, 0x979486, 0xc4b48c, 0x806546, 0xb3a38a, 0xa58f6f,
  0x84945b, 0x658b8b,
]
const KINDS = [
  'grass',
  'earth',
  'water',
  'grass',
  'rock',
  'sand',
  'farmland',
  'road-calm',
  'earth',
  'grass',
  'water',
]
const rgb = COLORS.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255])
const wetTile = (tile: number): boolean => tile === 2 || tile === 10
const vegetated = (tile: number): boolean => tile === 0 || tile === 3 || tile === 9
const noise = (x: number, y: number, seed = 0): number => {
  let n = Math.imul(x + seed * 131, 374761393) ^ Math.imul(y + seed * 173, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
type Sample = { id: string; pixels: Uint8ClampedArray; size: number }
const MAP_NAMES = ['baseColor', 'normal', 'roughness'] as const
type MapName = (typeof MAP_NAMES)[number]
type Chunk = {
  signature: string
  assets: string
  root: THREE.Group
  trees: THREE.Group
  ground: THREE.Mesh
  textures: THREE.DataTexture[]
}

export function terrainFootprints(state: WorldState): Set<string> {
  const occupied = new Set<string>()
  for (const s of Object.values(state.structures)) {
    for (let y = s.y; y < s.y + s.h; y++) {
      for (let x = s.x; x < s.x + s.w; x++) occupied.add(`${x},${y}`)
    }
  }
  return occupied
}

export function terrainChunkSignature(
  state: WorldState,
  x0: number,
  y0: number,
  occupied: Set<string>,
): string {
  let signature = ''
  // A one-tile halo invalidates the feather on both sides of a changed chunk edge.
  for (let y = y0 - 1; y <= y0 + TERRAIN_CHUNK_SIZE; y++) {
    for (let x = x0 - 1; x <= x0 + TERRAIN_CHUNK_SIZE; x++) {
      signature += String.fromCharCode(
        65 + (state.terrain[y]?.[x] ?? 15) + (occupied.has(`${x},${y}`) ? 16 : 0),
      )
    }
  }
  return signature
}

export function createTerrain(scene: THREE.Scene): {
  sync(state: WorldState, records: AssetRecord[]): void
  tick(seconds: number, wet: boolean, motion: boolean): void
  destroy(): void
  occluders(): THREE.Group[]
} {
  const chunks = new Map<string, Chunk>()
  const samples: Record<MapName, Map<string, Sample>> = {
    baseColor: new Map(),
    normal: new Map(),
    roughness: new Map(),
  }
  const activeSources = new Map<string, string>()
  const requested = new Set<string>()
  const pending = new Set<HTMLImageElement>()
  const wind = { value: 0 }
  const windStrength = { value: 0 }
  const cloudCover = { value: 0 }
  const trunkGeo = new THREE.CylinderGeometry(0.038, 0.075, 1, 6)
  const leafGeo = new THREE.IcosahedronGeometry(1, 1)
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const grassGeo = new THREE.BufferGeometry()
  grassGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -0.024, 0, 0, 0.024, 0, 0, 0.012, 0.19, 0.018, 0, 0, -0.023, 0, 0, 0.023, -0.018, 0.14,
        0.012,
      ],
      3,
    ),
  )
  grassGeo.computeVertexNormals()
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x71543c, roughness: 0.95 })
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    flatShading: true,
  })
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x939080,
    roughness: 0.95,
    flatShading: true,
  })
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    side: THREE.DoubleSide,
  })
  for (const [mat, foliage] of [
    [grassMat, false],
    [leafMat, true],
  ] as const) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.terrainWind = wind
      shader.uniforms.terrainWindStrength = windStrength
      shader.vertexShader = `uniform float terrainWind;\nuniform float terrainWindStrength;\n${shader.vertexShader}`
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x += sin(terrainWind * 1.15 + instanceMatrix[3].x * 2.0 + instanceMatrix[3].z) * ${foliage ? '0.016' : 'position.y * 0.13'} * terrainWindStrength;`,
      )
    }
    mat.customProgramCacheKey = () => `town-terrain-wind-${foliage}`
  }
  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()
  let alive = true
  let latest: WorldState | null = null
  let latestRecords: AssetRecord[] = []
  let raining = false

  function loadSamples(records: AssetRecord[]): void {
    if (typeof Image === 'undefined') return
    const selected = new Map<string, AssetRecord>()
    const ready = new Set(
      records.filter((record) => record.status === 'ready').map((record) => record.id),
    )
    for (const rec of records) {
      if (rec.class !== 'terrain' || rec.status !== 'ready') continue
      const manifest = parseMaterialSetManifest(rec.meta)
      if (!manifest && !rec.kind?.startsWith('material:')) continue
      const kind = (manifest?.kind ?? rec.kind ?? '').replace(/^material:/, '')
      if (!KINDS.includes(kind) && kind !== 'road') continue
      if ((selected.get(kind)?.seq ?? -1) < rec.seq) selected.set(kind, rec)
    }
    const desired = new Map<string, { kind: string; map: MapName; assetId: string }>()
    for (const [kind, rec] of selected) {
      const manifest = parseMaterialSetManifest(rec.meta)
      for (const map of MAP_NAMES) {
        const assetId =
          manifest?.maps[map]?.assetId ?? (map === 'baseColor' && !manifest ? rec.id : undefined)
        if (assetId && ready.has(assetId)) desired.set(`${kind}:${map}`, { kind, map, assetId })
      }
    }
    activeSources.clear()
    for (const [key, source] of desired) activeSources.set(key, source.assetId)
    for (const map of MAP_NAMES) {
      for (const kind of samples[map].keys())
        if (!desired.has(`${kind}:${map}`)) samples[map].delete(kind)
    }
    const settle = (): void => {
      if (alive && latest && pending.size === 0) sync(latest, latestRecords)
    }
    for (const [key, { kind, map, assetId }] of desired) {
      const requestKey = `${key}:${assetId}`
      if (requested.has(requestKey)) continue
      requested.add(requestKey)
      const image = new Image()
      pending.add(image)
      image.onload = () => {
        pending.delete(image)
        if (!alive || activeSources.get(key) !== assetId) {
          settle()
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 192
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) {
          settle()
          return
        }
        context.drawImage(image, 0, 0, 192, 192)
        samples[map].set(kind, {
          id: assetId,
          pixels: context.getImageData(0, 0, 192, 192).data,
          size: 192,
        })
        settle()
      }
      image.onerror = () => {
        pending.delete(image)
        if (activeSources.get(key) === assetId) samples[map].delete(kind)
        settle()
      }
      image.src = `/assets/${encodeURIComponent(assetId)}.png`
    }
  }

  function sampleFor(kind: string, map: MapName): Sample | undefined {
    return samples[map].get(kind) ?? (kind === 'road-calm' ? samples[map].get('road') : undefined)
  }

  function textureFor(
    state: WorldState,
    x0: number,
    y0: number,
    w: number,
    h: number,
    map: MapName = 'baseColor',
  ): THREE.DataTexture {
    const pp = TERRAIN_PIXELS_PER_TILE,
      width = w * pp,
      height = h * pp
    const pixels = new Uint8Array(width * height * 4)
    function color(tile: number, px: number, py: number, channel: number): number {
      const kind = KINDS[tile] ?? 'grass'
      const sample = sampleFor(kind, map)
      const grain = map === 'baseColor' ? (noise(px, py) - 0.5) * (tile === 7 ? 15 : 23) : 0
      if (sample) {
        const sx = ((px % sample.size) + sample.size) % sample.size
        const sy = ((py % sample.size) + sample.size) % sample.size
        return sample.pixels[(sy * sample.size + sx) * 4 + channel]! + grain * 0.25
      }
      if (map === 'normal') return channel === 2 ? 255 : 128
      if (map === 'roughness') return 255
      const broad = Math.sin(px * 0.026) * Math.cos(py * 0.033) * 6
      let detail = grain + broad
      if (tile === 6) detail += Math.sin((py / pp) * Math.PI * 10) * 13
      if (wetTile(tile)) detail += Math.sin(px * 0.14 + Math.sin(py * 0.035) * 2) * 3
      return (rgb[tile] ?? rgb[0])![channel]! + detail
    }
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const gx = x0 * pp + px,
          gy = y0 * pp + py
        const x = Math.floor(gx / pp),
          y = Math.floor(gy / pp)
        const tile = state.terrain[y]?.[x] ?? 0
        const fx = ((px % pp) + 0.5) / pp,
          fy = ((py % pp) + 0.5) / pp
        const edge = 0.16 + noise(gx, gy, 9) * 0.07
        const neighbors = [
          [x - 1, y, Math.max(0, 1 - fx / edge)],
          [x + 1, y, Math.max(0, 1 - (1 - fx) / edge)],
          [x, y - 1, Math.max(0, 1 - fy / edge)],
          [x, y + 1, Math.max(0, 1 - (1 - fy) / edge)],
        ]
        const offset = (py * width + px) * 4
        for (let c = 0; c < 3; c++) {
          let value = color(tile, gx, gy, c),
            weight = 1
          for (const [nx, ny, mix] of neighbors) {
            if (!mix) continue
            const neighbor = state.terrain[ny!]?.[nx!] ?? tile
            if (neighbor === tile) continue
            value += color(neighbor, gx, gy, c) * mix
            weight += mix
          }
          pixels[offset + c] = Math.max(0, Math.min(255, value / weight))
        }
        pixels[offset + 3] = 255
      }
    }
    const texture = new THREE.DataTexture(pixels, width, height)
    texture.colorSpace = map === 'baseColor' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 4
    texture.needsUpdate = true
    return texture
  }

  function applyMaps(
    state: WorldState,
    x: number,
    y: number,
    w: number,
    h: number,
    kinds: Set<string>,
    material: THREE.MeshStandardMaterial,
  ): THREE.DataTexture[] {
    const color = textureFor(state, x, y, w, h)
    const normal = [...kinds].some((kind) => sampleFor(kind, 'normal'))
      ? textureFor(state, x, y, w, h, 'normal')
      : null
    const roughness = [...kinds].some((kind) => sampleFor(kind, 'roughness'))
      ? textureFor(state, x, y, w, h, 'roughness')
      : null
    const variantChanged =
      Boolean(material.normalMap) !== Boolean(normal) ||
      Boolean(material.roughnessMap) !== Boolean(roughness) ||
      !material.map
    material.map = color
    material.normalMap = normal
    material.roughnessMap = roughness
    material.normalScale.set(0.32, 0.32)
    if (variantChanged) material.needsUpdate = true
    return [color, ...(normal ? [normal] : []), ...(roughness ? [roughness] : [])]
  }

  function build(
    state: WorldState,
    x0: number,
    y0: number,
    occupied: Set<string>,
    signature: string,
    assets: string,
    kinds: Set<string>,
  ): Chunk {
    const w = Math.min(TERRAIN_CHUNK_SIZE, (state.terrain[0]?.length ?? 0) - x0)
    const h = Math.min(TERRAIN_CHUNK_SIZE, state.terrain.length - y0)
    const root = new THREE.Group(),
      trees = new THREE.Group()
    root.name = `Terrain ${x0},${y0}`
    trees.name = `Trees ${x0},${y0}`
    root.add(trees)
    const positions: number[] = [],
      uvs: number[] = []
    const treeTiles: [number, number, number][] = [],
      grassTiles: [number, number][] = [],
      rocks: [number, number][] = []
    function quad(a: number[], b: number[], c: number[], d: number[]): void {
      for (const p of [a, b, c, a, c, d]) {
        positions.push(...p)
        uvs.push((p[0]! - x0) / w, (p[2]! - y0) / h)
      }
    }
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const tile = state.terrain[y]?.[x] ?? 0,
          elevation = wetTile(tile) ? -0.065 : 0
        quad(
          [x, elevation, y],
          [x, elevation, y + 1],
          [x + 1, elevation, y + 1],
          [x + 1, elevation, y],
        )
        if (wetTile(tile)) {
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            if (wetTile(state.terrain[y + dy]?.[x + dx] ?? tile)) continue
            if (dx) {
              const xx = x + (dx > 0 ? 1 : 0)
              quad([xx, 0, y], [xx, elevation, y], [xx, elevation, y + 1], [xx, 0, y + 1])
            } else {
              const yy = y + (dy > 0 ? 1 : 0)
              quad([x, 0, yy], [x, elevation, yy], [x + 1, elevation, yy], [x + 1, 0, yy])
            }
          }
        }
        if (occupied.has(`${x},${y}`)) continue
        if (tile === 3 || tile === 9) treeTiles.push([x, y, tile === 9 ? 0.48 : 1])
        if (vegetated(tile)) grassTiles.push([x, y])
        if (tile === 4) rocks.push([x, y])
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute(
      'terrainWater',
      new THREE.Float32BufferAttribute(
        positions.filter((_, i) => i % 3 === 1).map((height) => (height < 0 ? 1 : 0)),
        1,
      ),
    )
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({
      roughness: raining ? 0.74 : 0.96,
      side: THREE.DoubleSide,
    })
    const textures = applyMaps(state, x0, y0, w, h, kinds, material)
    material.onBeforeCompile = (shader) => {
      shader.uniforms.terrainWind = wind
      shader.uniforms.terrainCloudCover = cloudCover
      shader.vertexShader = `attribute float terrainWater;\nvarying float vTerrainWater;\nvarying vec2 vTerrainWorld;\n${shader.vertexShader}`
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrainWater = terrainWater;\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xz;',
      )
      shader.fragmentShader = `varying float vTerrainWater;\nvarying vec2 vTerrainWorld;\nuniform float terrainWind;\nuniform float terrainCloudCover;\n${shader.fragmentShader}`
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.26 / max(roughness, 0.001), vTerrainWater);',
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `vec2 cloudPoint = vTerrainWorld + vec2(terrainWind * 0.10, terrainWind * 0.055);
        float cloudBands = sin(cloudPoint.x * 0.19) * sin(cloudPoint.y * 0.15)
          + sin(cloudPoint.x * 0.075 + 1.3) * sin(cloudPoint.y * 0.095 + 0.7);
        float cloudShade = smoothstep(-0.5, 1.25, cloudBands);
        outgoingLight *= 1.0 - terrainCloudCover * (0.04 + cloudShade * 0.05);
        #include <opaque_fragment>`,
      )
    }
    material.customProgramCacheKey = () => 'town-ground-water'
    const ground = new THREE.Mesh(geometry, material)
    ground.receiveShadow = true
    root.add(ground)
    function instances(
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      count: number,
      group: THREE.Group,
      name: string,
    ): THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material> {
      const mesh = new THREE.InstancedMesh(geo, mat.clone(), count)
      mesh.name = name
      mesh.receiveShadow = true
      mesh.castShadow = name !== 'Grass'
      group.add(mesh)
      return mesh
    }
    function place(
      mesh: THREE.InstancedMesh,
      i: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      angle = 0,
    ): void {
      dummy.position.set(x, y, z)
      dummy.scale.set(sx, sy, sz)
      dummy.rotation.set(0, angle, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    if (treeTiles.length) {
      const trunks = instances(trunkGeo, trunkMat, treeTiles.length, trees, 'Trunks')
      const leaves = instances(leafGeo, leafMat, treeTiles.length * 12, trees, 'Canopies')
      // Material.clone does not retain compile hooks; the chunk owns its fadeable material.
      leaves.material.onBeforeCompile = leafMat.onBeforeCompile.bind(leafMat)
      leaves.material.customProgramCacheKey = leafMat.customProgramCacheKey.bind(leafMat)
      for (const [i, [x, y, scale]] of treeTiles.entries()) {
        const height = (1.6 + noise(x, y, 2) * 0.6) * scale
        place(trunks, i, x + 0.5, height * 0.32, y + 0.5, scale, height * 0.64, scale)
        for (let j = 0; j < 12; j++) {
          const angle = j * 2.4,
            radius = j < 9 ? 0.2 * scale : 0.08 * scale
          const spread = (0.15 + noise(x + j, y, 4) * 0.055) * scale
          place(
            leaves,
            i * 12 + j,
            x + 0.5 + Math.cos(angle) * radius,
            height * (0.68 + noise(x, y + j, 3) * 0.21),
            y + 0.5 + Math.sin(angle) * radius,
            spread,
            spread * 1.45,
            spread,
            angle,
          )
          leaves.setColorAt(
            i * 12 + j,
            tint.setHSL(
              0.215 + noise(x + j, y, 6) * 0.045,
              0.24 + noise(x, y + j, 1) * 0.16,
              0.26 + noise(x, y + j, 5) * 0.1,
            ),
          )
        }
      }
    }
    if (grassTiles.length) {
      const grass = instances(grassGeo, grassMat, grassTiles.length * 5, root, 'Grass')
      grass.material.onBeforeCompile = grassMat.onBeforeCompile.bind(grassMat)
      grass.material.customProgramCacheKey = grassMat.customProgramCacheKey.bind(grassMat)
      for (const [i, [x, y]] of grassTiles.entries()) {
        for (let j = 0; j < 5; j++) {
          const s = 0.48 + noise(x + j, y, 13) * 0.5
          place(
            grass,
            i * 5 + j,
            x + 0.13 + noise(x + j, y, 11) * 0.74,
            0.004,
            y + 0.13 + noise(x, y + j, 12) * 0.74,
            s,
            s,
            s,
            noise(x + j, y, 8) * Math.PI * 2,
          )
          grass.setColorAt(
            i * 5 + j,
            tint.setHSL(0.2 + noise(x + j, y, 7) * 0.06, 0.32, 0.32 + noise(x, y + j, 9) * 0.12),
          )
        }
      }
    }
    if (rocks.length) {
      const mesh = instances(rockGeo, rockMat, rocks.length * 3, root, 'Rocks')
      for (const [i, [x, y]] of rocks.entries()) {
        for (let j = 0; j < 3; j++) {
          const size = 0.16 + noise(x + j, y, 20) * 0.09
          place(
            mesh,
            i * 3 + j,
            x + 0.32 + noise(x + j, y, 21) * 0.36,
            size * 0.5,
            y + 0.32 + noise(x, y + j, 22) * 0.36,
            size,
            size * 0.7,
            size,
            noise(x + j, y, 23) * 6,
          )
        }
      }
    }
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        object.computeBoundingBox()
        object.computeBoundingSphere()
      }
    })
    scene.add(root)
    return { signature, assets, root, trees, ground, textures }
  }

  function dispose(chunk: Chunk): void {
    scene.remove(chunk.root)
    chunk.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const mesh = object as THREE.Mesh
      if (object instanceof THREE.InstancedMesh) object.dispose()
      else mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) material.dispose()
    })
    for (const texture of chunk.textures) texture.dispose()
  }

  function sync(state: WorldState, records: AssetRecord[]): void {
    if (!alive) return
    latest = state
    cloudCover.value = ['cloudy', 'rain', 'storm'].includes(state.weather.kind) ? 1 : 0
    latestRecords = records
    loadSamples(records)
    const occupied = terrainFootprints(state),
      needed = new Set<string>()
    const width = state.terrain[0]?.length ?? 0
    for (let y = 0; y < state.terrain.length; y += TERRAIN_CHUNK_SIZE) {
      for (let x = 0; x < width; x += TERRAIN_CHUNK_SIZE) {
        const key = `${x},${y}`
        needed.add(key)
        const kinds = new Set<string>()
        for (let yy = y - 1; yy <= y + TERRAIN_CHUNK_SIZE; yy++)
          for (let xx = x - 1; xx <= x + TERRAIN_CHUNK_SIZE; xx++)
            kinds.add(KINDS[state.terrain[yy]?.[xx] ?? 0] ?? 'grass')
        const assets = [...kinds]
          .sort()
          .map((kind) => MAP_NAMES.map((map) => sampleFor(kind, map)?.id ?? '').join(':'))
          .join(',')
        const signature = terrainChunkSignature(state, x, y, occupied)
        const existing = chunks.get(key)
        if (existing?.signature === signature) {
          if (existing.assets !== assets) {
            const textures = applyMaps(
              state,
              x,
              y,
              Math.min(TERRAIN_CHUNK_SIZE, width - x),
              Math.min(TERRAIN_CHUNK_SIZE, state.terrain.length - y),
              kinds,
              existing.ground.material as THREE.MeshStandardMaterial,
            )
            for (const texture of existing.textures) texture.dispose()
            existing.textures = textures
            existing.assets = assets
          }
          continue
        }
        if (existing) dispose(existing)
        chunks.set(key, build(state, x, y, occupied, signature, assets, kinds))
      }
    }
    for (const [key, chunk] of chunks)
      if (!needed.has(key)) {
        dispose(chunk)
        chunks.delete(key)
      }
  }
  return {
    sync,
    tick(seconds, wet, motion) {
      if (motion) wind.value = seconds
      windStrength.value = motion ? 1 : 0
      if (raining === wet) return
      raining = wet
      for (const chunk of chunks.values())
        (chunk.ground.material as THREE.MeshStandardMaterial).roughness = wet ? 0.74 : 0.96
    },
    occluders: () =>
      [...chunks.values()]
        .filter((chunk) => chunk.trees.children.length > 0)
        .map((chunk) => chunk.trees),
    destroy() {
      alive = false
      latest = null
      for (const image of pending) {
        image.onload = null
        image.onerror = null
        image.src = ''
      }
      pending.clear()
      for (const chunk of chunks.values()) dispose(chunk)
      chunks.clear()
      for (const map of MAP_NAMES) samples[map].clear()
      activeSources.clear()
      for (const geometry of [trunkGeo, leafGeo, rockGeo, grassGeo]) geometry.dispose()
      for (const material of [trunkMat, leafMat, rockMat, grassMat]) material.dispose()
    },
  }
}
