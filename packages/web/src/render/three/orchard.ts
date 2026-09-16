import { ORCHARD_ANCHOR, ORCHARD_GARDENS, orchardContains } from '@sj/shared'
import { authoredOrigin, type WorldState } from '@sj/engine/state'
import * as THREE from 'three'

export function createOrchardGardens(scene: THREE.Scene) {
  const root = new THREE.Group()
  const geometry = new THREE.IcosahedronGeometry(1, 0)
  const foliage = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    flatShading: true,
  })
  const stone = new THREE.MeshStandardMaterial({ color: 0xb6aa88, roughness: 1, flatShading: true })
  const leaves = new THREE.InstancedMesh(geometry, foliage, 500)
  const blooms = new THREE.InstancedMesh(geometry, foliage, 500)
  const edging = new THREE.InstancedMesh(geometry, stone, 500)
  for (const mesh of [leaves, blooms, edging]) {
    mesh.count = 0
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    root.add(mesh)
  }
  scene.add(root)
  const dummy = new THREE.Object3D(),
    color = new THREE.Color()
  let signature = ''
  return {
    sync(state: WorldState) {
      root.visible = state.townLayout === 'orchard'
      if (!root.visible) return
      const origin = authoredOrigin(state),
        ox = ORCHARD_ANCHOR.x - origin.x,
        oy = ORCHARD_ANCHOR.y - origin.y
      const positions: { x: number; y: number; n: number }[] = []
      for (const g of ORCHARD_GARDENS)
        for (let n = 0; n < Math.floor(g.w * 3); n++) {
          positions.push({ x: ox + g.x + 0.22 + n * 0.32, y: oy + g.y + 0.28 + (n % 2) * 0.16, n })
          if (g.h > 2)
            positions.push({
              x: ox + g.x + 0.22 + n * 0.32,
              y: oy + g.y + g.h - 0.35 - (n % 2) * 0.16,
              n: n + 7,
            })
        }
      const buildings = Object.values(state.structures)
      const available = positions.filter(
        (p) =>
          state.terrain[Math.floor(p.y)]?.[Math.floor(p.x)] === 0 &&
          !buildings.some((s) =>
            orchardContains({ x: s.x - 0.4, y: s.y - 0.4, w: s.w + 0.8, h: s.h + 0.8 }, p.x, p.y),
          ),
      )
      const next = available.map((p) => `${p.x},${p.y}`).join('|')
      if (signature === next) return
      signature = next
      leaves.count = blooms.count = edging.count = 0
      for (const p of available) {
        dummy.position.set(p.x, 0.1, p.y)
        dummy.scale.set(0.17, 0.13, 0.16)
        dummy.rotation.set(0, p.n * 0.7, 0)
        dummy.updateMatrix()
        leaves.setMatrixAt(leaves.count, dummy.matrix)
        leaves.setColorAt(leaves.count++, color.set(p.n % 3 === 0 ? 0x6c8448 : 0x829851))
        dummy.position.set(p.x + 0.025, 0.24 + (p.n % 3) * 0.025, p.y)
        dummy.scale.set(0.065, 0.045, 0.065)
        dummy.updateMatrix()
        blooms.setMatrixAt(blooms.count, dummy.matrix)
        blooms.setColorAt(
          blooms.count++,
          color.set([0xf1dfaf, 0xd8a68b, 0xc1b3cc, 0xe9d4a4][p.n % 4]!),
        )
        if (p.n % 2 === 0) {
          dummy.position.set(p.x, 0.035, p.y - 0.23)
          dummy.scale.set(0.11, 0.055, 0.08)
          dummy.updateMatrix()
          edging.setMatrixAt(edging.count++, dummy.matrix)
        }
      }
      for (const mesh of [leaves, blooms, edging]) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },
    destroy() {
      scene.remove(root)
      leaves.dispose()
      blooms.dispose()
      edging.dispose()
      geometry.dispose()
      foliage.dispose()
      stone.dispose()
    },
  }
}
