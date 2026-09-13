import { flamesAt, isRoofedKind, type SimConfig } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PointLight,
  Scene,
  Vector3,
} from 'three'
import { skyToken, sunLight } from '../../ui/skyModel.js'

export function createEnvironment(scene: Scene) {
  const sun = new DirectionalLight(0xffecd0, 3)
  const sky = new HemisphereLight(0xc9e4ee, 0x596443, 1.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.035
  sun.shadow.bias = -0.0002
  sun.shadow.radius = 9
  sun.shadow.intensity = 0.65
  sun.shadow.camera.near = 0.1
  sun.shadow.camera.far = 350
  scene.add(sun, sun.target, sky)
  const lights = Array.from({ length: 8 }, (_, i) => {
    const light = new PointLight(0xffb45e, 0, 9, 2)
    light.castShadow = i < 2
    light.shadow.mapSize.set(512, 512)
    light.shadow.radius = 12
    light.shadow.intensity = 0.5
    light.shadow.normalBias = 0.025
    light.shadow.bias = -0.0007
    light.shadow.camera.near = 0.15
    scene.add(light)
    return { light, id: '', strength: 0 }
  })
  scene.background = new Color(0x99ac98)
  scene.fog = new FogExp2(0x99ac98, 0.0018)
  const warm = new Color(0xffc178)
  const day = new Color(0xffecd0)
  const background = new Color()
  return {
    update(
      state: WorldState,
      config: SimConfig,
      center: Vector3,
      span: number,
      seconds: number,
      dt: number,
      heightOf: (id: string) => number,
    ) {
      const token = skyToken(state.tick)
      const light = sunLight(state.tick)
      const wet = state.weather.kind === 'rain' || state.weather.kind === 'storm'
      const daylight = token.kind === 'sun' ? Math.min(1, light.elevation * 5) : 0
      sun.intensity = daylight * (wet ? 0.5 : 3.1)
      sun.color.copy(day).lerp(warm, light.golden)
      sun.position.set(center.x + light.x * 65 - 20, 28 + light.elevation * 90, center.z + 45)
      sun.target.position.copy(center)
      const extent = Math.min(110, Math.max(24, span * 0.8))
      Object.assign(sun.shadow.camera, {
        left: -extent,
        right: extent,
        top: extent,
        bottom: -extent,
      })
      sun.shadow.camera.updateProjectionMatrix()
      sky.intensity = 0.36 + daylight * (wet ? 0.45 : 1.04)
      sky.color.set(wet ? 0x92acd2 : 0xc9e4ee)
      sky.groundColor.set(daylight > 0.5 ? 0x596443 : 0x343840)
      background.set(0x283649).lerp(new Color(wet ? 0x78868a : 0x99ac98), daylight)
      ;(scene.background as Color).copy(background)
      ;(scene.fog as FogExp2).color.copy(background)
      const flames = flamesAt(state, state.tick, config)
      const active = new Set(flames.map((f) => f.id))
      const nearby = flames
        .filter(
          (f) =>
            f.source !== 'structure' || !isRoofedKind(config, state.structures[f.id]?.kind ?? ''),
        )
        .map((f) => ({
          f,
          distance: Math.hypot(f.x + f.w / 2 - center.x, f.y + f.h / 2 - center.z),
        }))
        .filter((f) => f.distance < span + 12)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, lights.length)
      const wanted = new Map(nearby.map(({ f }) => [f.id, f]))
      const assigned = new Set(lights.map((l) => l.id))
      for (const slot of lights) {
        if (!wanted.has(slot.id) && slot.strength < 0.02) {
          const next = nearby.find(({ f }) => !assigned.has(f.id))?.f
          if (next) {
            assigned.delete(slot.id)
            slot.id = next.id
            assigned.add(next.id)
          }
        }
        const f = wanted.get(slot.id)
        slot.strength += ((f ? 1 : 0) - slot.strength) * Math.min(1, dt * 4)
        if (f) {
          slot.light.position.set(f.x + f.w / 2, heightOf(f.id), f.y + f.h / 2)
          slot.light.distance = f.radius * 2
        }
        slot.light.intensity =
          slot.strength * (8 + Math.sin(seconds * 7 + slot.light.id) * 0.5) * (1 - daylight * 0.8)
      }
      return { active, wet, daylight }
    },
    destroy() {
      sun.shadow.map?.dispose()
      sun.dispose()
      scene.remove(sun, sun.target, sky, ...lights.map((l) => l.light))
      for (const { light } of lights) {
        light.shadow.map?.dispose()
        light.dispose()
      }
    },
  }
}
