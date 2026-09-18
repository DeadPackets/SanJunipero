import type { WorldState } from '@sj/engine/state'
import type { Scene as TownView } from '../scene.js'
import { WORLD_PX } from './projection.js'
import type { WeatherLayer } from '../weatherFx.js'
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Vector3,
} from 'three'

const DROP_COUNT = 1500
const SPLASH_COUNT = 64
const wrap = (n: number, span: number) => ((n % span) + span) % span
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function createThreeWeather(scene: Scene, view: TownView) {
  const root = new Group()
  // Fading buildings share the transparency queue. Draw weather after them, with depth testing.
  root.renderOrder = 10
  scene.add(root)
  const snowPositions = new Float32Array(DROP_COUNT * 3)
  const rainGeometry = new PlaneGeometry(1, 1)
  const snowGeometry = new BufferGeometry()
  snowGeometry.setAttribute('position', new Float32BufferAttribute(snowPositions, 3))
  const rainMaterial = new MeshBasicMaterial({
    color: 0xd7e4ef,
    toneMapped: false,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })
  const snowMaterial = new PointsMaterial({
    color: 0xf0f4fa,
    toneMapped: false,
    size: 0.075,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  })
  snowMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a *= 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5));\n#include <opaque_fragment>',
    )
  }
  snowMaterial.customProgramCacheKey = () => 'town-snow'
  rainMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 vRainUv;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRainUv = uv;',
    )
    shader.fragmentShader = `varying vec2 vRainUv;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a *= smoothstep(0.0, 0.2, vRainUv.y) * (1.0 - smoothstep(0.65, 1.0, vRainUv.y));\n#include <opaque_fragment>',
    )
  }
  rainMaterial.customProgramCacheKey = () => 'town-rain-streaks'
  const rain = new InstancedMesh(rainGeometry, rainMaterial, DROP_COUNT)
  const snow = new Points(snowGeometry, snowMaterial)
  rain.frustumCulled = snow.frustumCulled = false
  root.add(rain, snow)
  const splashGeometry = new RingGeometry(0.055, 0.068, 12)
  const splashAlpha = new InstancedBufferAttribute(new Float32Array(SPLASH_COUNT), 1)
  splashGeometry.setAttribute('splashAlpha', splashAlpha)
  const splashMaterial = new MeshBasicMaterial({
    color: 0xcbdce3,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  })
  splashMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `attribute float splashAlpha;\nvarying float vSplashAlpha;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSplashAlpha = splashAlpha;',
      )
    shader.fragmentShader = `varying float vSplashAlpha;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a *= vSplashAlpha;\n#include <opaque_fragment>',
    )
  }
  splashMaterial.customProgramCacheKey = () => 'town-rain-ripples'
  const splashes = new InstancedMesh(splashGeometry, splashMaterial, SPLASH_COUNT)
  splashes.frustumCulled = false
  root.add(splashes)
  const roofs = new Map<string, number>()
  let kind = 'sunny',
    suppressed = false
  let displayKind = 'rain'
  let amount = 0,
    seconds = 0,
    windDistance = 0,
    fallDistance = 0
  const matrix = new Matrix4()
  const groundAt = (state: WorldState, x: number, z: number): number | null => {
    const tile = state.terrain[Math.floor(z)]?.[Math.floor(x)]
    if (tile === undefined) return null
    return (
      roofs.get(`${Math.floor(x)},${Math.floor(z)}`) ?? (tile === 2 || tile === 10 ? -0.08 : 0.025)
    )
  }
  const controls: WeatherLayer = {
    setKind(value) {
      kind = value
    },
    setSuppressed(value) {
      suppressed = value
    },
    tick: () => undefined,
    destroy: () => undefined,
  }
  return {
    controls,
    sync(groups: Iterable<Group>) {
      roofs.clear()
      for (const group of groups) {
        const bounds = new Box3().setFromObject(group)
        if (bounds.isEmpty()) continue
        for (let z = Math.floor(bounds.min.z); z < Math.ceil(bounds.max.z); z++)
          for (let x = Math.floor(bounds.min.x); x < Math.ceil(bounds.max.x); x++) {
            const key = `${x},${z}`
            roofs.set(key, Math.max(roofs.get(key) ?? 0, bounds.max.y))
          }
      }
    },
    update(state: WorldState, center: Vector3, span: number, dt: number) {
      const falling = kind === 'rain' || kind === 'storm' || kind === 'snow'
      if (falling) displayKind = kind
      const wet = displayKind === 'rain' || displayKind === 'storm'
      const motion = view.wantsMotion()
      if (motion) seconds += dt
      const target = falling && !suppressed ? 1 : 0
      amount = !motion ? target : amount + (target - amount) * Math.min(1, dt * 1.8)
      root.visible = !view.interior?.isActive() && amount > 0.005 && motion
      if (!root.visible) return 0
      rain.visible = wet
      snow.visible = displayKind === 'snow'
      splashes.visible = wet
      const area = Math.min(100, Math.max(24, span * 2.2))
      const count = Math.min(
        DROP_COUNT,
        Math.round(area * area * (displayKind === 'storm' ? 0.85 : 0.5)),
      )
      const gust = Math.sin(seconds * 0.4) * 0.2
      const drift =
        displayKind === 'storm' ? 1.8 + gust : displayKind === 'snow' ? 0.24 : 0.55 + gust
      const speed = displayKind === 'snow' ? 0.6 : displayKind === 'storm' ? 11 : 7
      // Integrate velocity. Elapsed time multiplied by changing wind can reverse the motion.
      windDistance += drift * dt
      fallDistance += speed * dt
      const streakWidth = Math.max(0.018, 1.2 / (view.getZoom() * WORLD_PX))
      for (let i = 0; i < count; i++) {
        const pace = 0.75 + hash(i + 53) * 0.5
        const x =
          center.x + wrap(hash(i + 1) * area + windDistance - center.x + area / 2, area) - area / 2
        const z =
          center.z +
          wrap(hash(i + 1001) * area + windDistance * 0.35 - center.z + area / 2, area) -
          area / 2
        const floor = groundAt(state, x, z)
        let y = wrap(hash(i + 2001) * 12 - fallDistance * pace, 12)
        if (floor === null || y < floor) y = -100
        const length = (displayKind === 'storm' ? 0.48 : 0.34) * pace
        const tail = length / (speed * pace)
        matrix.set(
          streakWidth / Math.SQRT2,
          -drift * tail,
          0,
          x,
          0,
          length,
          0,
          y + length / 2,
          -streakWidth / Math.SQRT2,
          -drift * 0.35 * tail,
          1,
          z,
          0,
          0,
          0,
          1,
        )
        rain.setMatrixAt(i, matrix)
        snowPositions[i * 3] = x + Math.sin(seconds * 0.7 + i) * 0.2
        snowPositions[i * 3 + 1] = y
        snowPositions[i * 3 + 2] = z
      }
      ;(snowGeometry.attributes.position as Float32BufferAttribute).array.set(snowPositions)
      rain.instanceMatrix.needsUpdate = true
      snowGeometry.attributes.position!.needsUpdate = true
      rain.count = count
      snowGeometry.setDrawRange(0, count)
      rainMaterial.opacity = amount * (displayKind === 'storm' ? 0.65 : 0.48)
      snowMaterial.opacity = amount * 0.9
      snowMaterial.size = Math.max(2.2, Math.min(5, view.getZoom() * WORLD_PX * 0.07))
      for (let i = 0; i < SPLASH_COUNT; i++) {
        const age = wrap(seconds * 1.5 + hash(i + 4001), 1)
        const cycle = Math.floor(seconds * 1.5 + hash(i + 4001))
        const x = center.x + (hash(i + cycle * 71 + 5001) - 0.5) * area * 0.7
        const z = center.z + (hash(i + cycle * 71 + 6001) - 0.5) * area * 0.7
        const y = groundAt(state, x, z)
        const valid = y !== null && y < 0.1
        const scale = 0.5 + age * 2.4
        matrix
          .makeRotationX(-Math.PI / 2)
          .scale(new Vector3(scale, scale, scale))
          .setPosition(x, valid ? y + 0.015 : -100, z)
        splashes.setMatrixAt(i, matrix)
        splashAlpha.setX(i, valid ? Math.sin(age * Math.PI) * (1 - age) * amount : 0)
      }
      splashes.instanceMatrix.needsUpdate = true
      splashAlpha.needsUpdate = true
      const strike = wrap(seconds, 6.5)
      const flash = strike < 0.65 ? Math.sin((strike / 0.65) * Math.PI) ** 2 : 0
      return kind === 'storm' && !suppressed ? flash * 2.4 : 0
    },
    destroy() {
      root.removeFromParent()
      for (const geometry of [rainGeometry, snowGeometry, splashGeometry]) geometry.dispose()
      for (const material of [rainMaterial, snowMaterial, splashMaterial]) material.dispose()
    },
  }
}
